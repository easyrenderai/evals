import { Client } from './client.ts';
import { DEFAULT_BASE_URL, RENDER_CREDITS } from './config.ts';
import { loadManifest } from './fixtures.ts';
import { reviewReasons } from './compare.ts';
import { publish } from './publish.ts';
import { runEvals } from './run.ts';
import { score } from './score.ts';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Review, RunManifest } from './types.ts';

const root = process.cwd();
const [command, ...args] = process.argv.slice(2);

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main() {
  if (command === 'run') {
    // Spending credits is opt-in twice: the flag and the key. Nothing runs on import or by default.
    // --preview is the cheap tier: the free draft sheet and the views check, no build, no credits.
    const isPreview = args.includes('--preview');
    if (!isPreview && !args.includes('--spend')) {
      fail('This renders every photo in 3D and spends credits on the key\'s account. Pass --spend to go ahead, or --preview to stop at the free preview.');
    }
    const apiKey = process.env.EASYRENDER_API_KEY ?? fail('Set EASYRENDER_API_KEY.');
    const baseUrl = process.env.EASYRENDER_URL ?? DEFAULT_BASE_URL;
    const only = args.find((a) => a.startsWith('--only='))?.slice(7).split(',');
    const all = await loadManifest(root);
    const photos = only ? all.filter((p) => only.includes(p.slug)) : all;
    if (photos.length === 0) fail('No photos selected.');

    const client = new Client(baseUrl, apiKey);
    const balance = await client.balance();
    // A run that cannot pay for every build would give a misleading score, so stop first.
    const needed = isPreview ? 0 : photos.length * RENDER_CREDITS;
    if (balance < needed) fail(`The account has ${balance} credits; ${needed} are needed for ${photos.length} photos.`);

    const manifest = await runEvals({ root, client, baseUrl, photos, tier: isPreview ? 'preview' : 'full' });
    if (isPreview) {
      const good = manifest.outcomes.filter((o) => o.status === 'preview' && o.checks.views?.passed).length;
      console.log(`${manifest.id}: views check passed on ${good}/${photos.length} previews. Nothing was built.`);
      if (good < photos.length) process.exit(1);
      return;
    }
    const ready = manifest.outcomes.filter((o) => o.status === 'ready').length;
    console.log(`${manifest.id}: ${ready}/${photos.length} renders finished. Review runs/${manifest.id}/review.json next.`);
    return;
  }

  const id = args[0] ?? fail(`Usage: ${command} <run id>`);
  if (command === 'score') {
    const dir = join(root, 'runs', id);
    const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as RunManifest;
    const review = JSON.parse(await readFile(join(dir, 'review.json'), 'utf8')) as Review;
    console.log(JSON.stringify(score(manifest, review), null, 2));
    return;
  }
  if (command === 'compare') {
    // Exit 3 when a person has to review the run before it counts; the reasons go to stdout.
    const manifest = JSON.parse(await readFile(join(root, 'runs', id, 'manifest.json'), 'utf8')) as RunManifest;
    const published = JSON.parse(await readFile(join(root, 'results', 'latest.json'), 'utf8'));
    const reasons = reviewReasons(manifest, published);
    if (reasons.length === 0) {
      console.log('Automatic checks match the last published run: no review needed.');
      return;
    }
    console.log(`Review needed:\n${reasons.map((r) => `- ${r}`).join('\n')}`);
    process.exit(3);
  }
  if (command === 'publish') {
    const { unconfirmed } = await publish(root, id);
    console.log(`Published ${id} to results/latest.json and reports/${id}.json.`);
    if (unconfirmed.length > 0) console.warn(`Photo rights still unconfirmed for: ${unconfirmed.join(', ')}`);
    return;
  }
  fail('Commands: run (--spend | --preview) [--only=a,b] | score <run id> | compare <run id> | publish <run id>');
}

await main();
