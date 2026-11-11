import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_URL } from './config.ts';
import { loadManifest, } from './fixtures.ts';
import { score } from './score.ts';
import type { EvalResults, Review, RunManifest } from './types.ts';

/**
 * Scores runs/<id>, writes reports/<id>.json (pass counts and checks per photo, no images) and
 * adds the run to results/latest.json. Returns the photos whose rights are still unconfirmed.
 */
export async function publish(root: string, id: string): Promise<{ unconfirmed: string[] }> {
  const dir = join(root, 'runs', id);
  const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as RunManifest;
  const review = JSON.parse(await readFile(join(dir, 'review.json'), 'utf8')) as Review;
  const run = score(manifest, review);

  const resultsFile = join(root, 'results/latest.json');
  const results = JSON.parse(await readFile(resultsFile, 'utf8')) as EvalResults;
  if (results.runs.some((r) => r.id === id)) throw new Error(`${id} is already published`);

  const photos = await loadManifest(root);
  const used = photos.filter((p) => manifest.outcomes.some((o) => o.slug === p.slug));

  await mkdir(join(root, 'reports'), { recursive: true });
  await writeFile(
    join(root, 'reports', `${id}.json`),
    `${JSON.stringify(
      {
        run,
        baseUrl: manifest.baseUrl,
        photos: used.map(({ slug, sha256, rights }) => ({ slug, sha256, rights })),
        outcomes: manifest.outcomes,
        review,
      },
      null,
      2,
    )}\n`,
  );

  results.runs.push({ ...run, reportUrl: `${REPO_URL}/blob/main/reports/${id}.json` });
  await writeFile(resultsFile, `${JSON.stringify(results, null, 2)}\n`);
  return { unconfirmed: used.filter((p) => p.rights === 'unconfirmed').map((p) => p.slug) };
}
