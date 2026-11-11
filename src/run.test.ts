import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { Client } from './client.ts';
import { sha256 } from './fixtures.ts';
import { publish } from './publish.ts';
import { runEvals } from './run.ts';
import type { EvalResults, Photo, Review } from './types.ts';

// The whole flow against a stand-in for the easyrender API: create, make private, preview, build,
// download, check, review, publish. No network and no credits.

process.env.EVAL_POLL_MS = '1';

const CELL = 200;
async function fakeSheet(): Promise<Uint8Array> {
  const cells = await Promise.all(
    Array.from({ length: 9 }, async (_, i) => ({
      input: await sharp(
        Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}"><rect width="100%" height="100%" fill="white"/><rect x="${20 + i * 9}" y="${30 + ((i * 17) % 60)}" width="${30 + i * 11}" height="${40 + ((i * 23) % 70)}" fill="#222"/></svg>`,
        ),
      )
        .png()
        .toBuffer(),
      left: (i % 3) * CELL,
      top: Math.floor(i / 3) * CELL,
    })),
  );
  return new Uint8Array(
    await sharp({ create: { width: CELL * 3, height: CELL * 3, channels: 3, background: 'white' } })
      .composite(cells)
      .png()
      .toBuffer(),
  );
}

function fakeGlb(): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ meshes: [{}] }).padEnd(24, ' '));
  const out = new Uint8Array(30_000);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, out.length, true);
  view.setUint32(12, json.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(json, 20);
  return out;
}

let server: ReturnType<typeof Bun.serve>;
const calls: string[] = [];
let status: 'drafting' | 'preview_ready' | 'rendering' | 'ready' = 'drafting';

beforeAll(async () => {
  const sheet = await fakeSheet();
  const glb = fakeGlb();
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      calls.push(`${request.method} ${pathname}`);
      if (request.headers.get('authorization') !== 'Bearer er_test') {
        return new Response('no', { status: 401 });
      }
      const view = () => Response.json({ id: 'r1', status, credits: status === 'ready' ? 64 : 0, renderCredits: 64 });
      if (pathname === '/api/renders' && request.method === 'GET') return Response.json({ renders: [], balance: 500 });
      if (pathname === '/api/renders' && request.method === 'POST') return view();
      if (pathname === '/api/renders/r1' && request.method === 'PATCH') return view();
      if (pathname === '/api/renders/r1') {
        // preview after the first poll, then ready after the build.
        if (status === 'drafting') status = 'preview_ready';
        return view();
      }
      if (pathname === '/api/renders/r1/render') {
        status = 'ready';
        return view();
      }
      if (pathname === '/api/renders/r1/preview') return new Response(sheet as BodyInit);
      if (pathname === '/api/renders/r1/model') return new Response(glb as BodyInit);
      return new Response('not found', { status: 404 });
    },
  });
});
afterAll(() => server.stop(true));

describe('a full run against a stand-in API', () => {
  test('renders, checks, reviews and publishes one photo', async () => {
    const root = await mkdtemp(join(tmpdir(), 'evals-'));
    const photoBytes = new TextEncoder().encode('not really a jpeg');
    const photo: Photo = {
      slug: 'chair',
      title: 'Chair',
      prompt: 'A chair',
      materials: ['wood'],
      source_url: 'https://example.invalid/chair.jpg',
      sha256: sha256(photoBytes),
      rights: 'unconfirmed',
    };
    await mkdir(join(root, 'fixtures/photos'), { recursive: true });
    await writeFile(join(root, 'fixtures/photos/chair.jpg'), photoBytes);
    await writeFile(join(root, 'fixtures/manifest.json'), JSON.stringify({ photos: [photo] }));
    await mkdir(join(root, 'results'), { recursive: true });
    await writeFile(join(root, 'results/latest.json'), '{"runs": []}');

    const baseUrl = `http://localhost:${server.port}`;
    const manifest = await runEvals({ root, client: new Client(baseUrl, 'er_test'), baseUrl, photos: [photo] });

    expect(manifest.outcomes[0]).toMatchObject({ slug: 'chair', status: 'ready', creditsSpent: 64, sheetSide: 600 });
    expect(manifest.outcomes[0]?.checks.views?.passed).toBe(true);
    expect(manifest.outcomes[0]?.checks.file?.passed).toBe(true);
    // The eval render is hidden from the public gallery before anything is built.
    expect(calls.indexOf('PATCH /api/renders/r1')).toBeLessThan(calls.indexOf('POST /api/renders/r1/render'));

    // Publishing before the review is done is refused.
    await expect(publish(root, manifest.id)).rejects.toThrow('review.json is incomplete');

    const review: Review = { chair: { shape: true, material: true, finish: false } };
    await writeFile(join(root, 'runs', manifest.id, 'review.json'), JSON.stringify(review));
    const { unconfirmed } = await publish(root, manifest.id);
    expect(unconfirmed).toEqual(['chair']);

    const results = JSON.parse(await readFile(join(root, 'results/latest.json'), 'utf8')) as EvalResults;
    expect(results.runs).toHaveLength(1);
    expect(results.runs[0]?.criteria).toEqual({
      shape: { passed: 1, total: 1 },
      views: { passed: 1, total: 1 },
      material: { passed: 1, total: 1 },
      finish: { passed: 0, total: 1 },
      file: { passed: 1, total: 1 },
    });
    expect(results.runs[0]?.reportUrl).toContain(`reports/${manifest.id}.json`);
    await expect(publish(root, manifest.id)).rejects.toThrow('already published');
  });
});
