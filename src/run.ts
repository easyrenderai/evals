import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { checkGlb, checkViews } from './checks.ts';
import { type Client, type RenderView } from './client.ts';
import {
  BUILD_MODEL,
  CONCURRENCY,
  PHASE_TIMEOUT_MS,
  POLL_INTERVAL_MS,
  RENDER_CREDITS,
  SHEET_MODEL,
} from './config.ts';
import { photoBytes } from './fixtures.ts';
import type { CheckResult, Photo, PhotoOutcome, Review, RunManifest } from './types.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls a render until `done` accepts its status, it fails, or the phase times out. */
async function waitFor(
  client: Client,
  id: string,
  done: (status: RenderView['status']) => boolean,
): Promise<RenderView | 'timeout'> {
  const deadline = Date.now() + PHASE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const view = await client.get(id);
    if (view.status === 'failed' || done(view.status)) return view;
    await sleep(POLL_INTERVAL_MS);
  }
  return 'timeout';
}

const none: CheckResult = { views: null, file: null };

async function runPhoto(
  client: Client,
  root: string,
  dir: string,
  photo: Photo,
): Promise<PhotoOutcome> {
  const outcome = (partial: Partial<PhotoOutcome> & Pick<PhotoOutcome, 'status'>): PhotoOutcome => ({
    slug: photo.slug,
    renderId: null,
    creditsSpent: null,
    checks: none,
    ...partial,
  });
  let renderId: string | null = null;
  try {
    const bytes = await photoBytes(root, photo);
    await mkdir(join(dir, photo.slug), { recursive: true });
    await writeFile(join(dir, photo.slug, 'photo.jpg'), bytes);

    const created = await client.create(bytes, 'image/jpeg', photo.prompt);
    renderId = created.id;
    await client.makePrivate(renderId);
    if (created.renderCredits !== RENDER_CREDITS) {
      throw new Error(
        `the API quotes ${created.renderCredits} credits for a render, the suite expects ${RENDER_CREDITS}; not building`,
      );
    }

    const preview = await waitFor(client, renderId, (s) => s === 'preview_ready');
    if (preview === 'timeout') return outcome({ renderId, status: 'timeout' });
    if (preview.status === 'failed') return outcome({ renderId, status: 'failed' });

    await client.build(renderId);
    const built = await waitFor(client, renderId, (s) => s === 'ready');
    if (built === 'timeout') return outcome({ renderId, status: 'timeout' });
    if (built.status === 'failed') {
      return outcome({ renderId, status: 'failed', creditsSpent: built.credits });
    }

    // Once the build is paid for, the preview endpoint serves the full-resolution sheet.
    const [sheet, model] = await Promise.all([client.sheet(renderId), client.model(renderId)]);
    await writeFile(join(dir, photo.slug, 'sheet.png'), sheet);
    await writeFile(join(dir, photo.slug, 'model.glb'), model);
    const { width = 0, height = 0 } = await sharp(sheet).metadata();
    return outcome({
      renderId,
      status: 'ready',
      creditsSpent: built.credits,
      sheetSide: Math.min(width, height),
      checks: { views: await checkViews(sheet), file: checkGlb(model) },
    });
  } catch (error) {
    return outcome({
      renderId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export type RunOptions = {
  root: string;
  client: Client;
  baseUrl: string;
  photos: Photo[];
};

/** Renders every photo through the live product and writes runs/<id>/ for review. Spends credits. */
export async function runEvals({ root, client, baseUrl, photos }: RunOptions): Promise<RunManifest> {
  const stamp = new Date().toISOString();
  const id = `run-${stamp.slice(0, 10)}-${stamp.slice(11, 16).replace(':', '')}`;
  const dir = join(root, 'runs', id);
  await mkdir(dir, { recursive: true });

  const outcomes: PhotoOutcome[] = new Array(photos.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, photos.length) }, async () => {
      while (next < photos.length) {
        const index = next++;
        const photo = photos[index] as Photo;
        outcomes[index] = await runPhoto(client, root, dir, photo);
        console.log(`${photo.slug}: ${outcomes[index]?.status}`);
      }
    }),
  );

  const manifest: RunManifest = {
    id,
    date: stamp.slice(0, 10),
    baseUrl,
    sheetModel: SHEET_MODEL,
    buildModel: BUILD_MODEL,
    outcomes,
  };
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  // The reviewer fills this in against photo.jpg, sheet.png and model.glb of each photo.
  const review: Review = Object.fromEntries(
    outcomes
      .filter((o) => o.status === 'ready')
      .map((o) => [o.slug, { shape: null, material: null, finish: null }]),
  );
  await writeFile(join(dir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
  return manifest;
}
