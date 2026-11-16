import type { EvalResults, RunManifest } from './types.ts';

/**
 * Decides whether a person has to look at a full run before it counts. The automatic checks (views,
 * file) run every week; the judged ones (shape, material, finish) only need a person when
 * something moved. Pure: the caller prints the reasons and sets the exit code.
 */
export function reviewReasons(manifest: RunManifest, published: EvalResults): string[] {
  if (manifest.tier === 'preview') return [];
  const reasons: string[] = [];
  const total = manifest.outcomes.length;
  const notReady = manifest.outcomes.filter((o) => o.status !== 'ready');
  if (notReady.length > 0) {
    reasons.push(`${notReady.length}/${total} renders did not finish: ${notReady.map((o) => `${o.slug} (${o.status})`).join(', ')}`);
  }
  const views = manifest.outcomes.filter((o) => o.checks.views?.passed).length;
  const file = manifest.outcomes.filter((o) => o.checks.file?.passed).length;
  if (views < total) reasons.push(`views check: ${views}/${total} passed`);
  if (file < total) reasons.push(`file check: ${file}/${total} passed`);

  const last = published.runs.at(-1);
  if (!last) {
    reasons.push('no published run to compare with: the first run needs a person to set the baseline');
    return reasons;
  }
  if (last.sheetModel !== manifest.sheetModel) {
    reasons.push(`sheet model changed: ${last.sheetModel} -> ${manifest.sheetModel}`);
  }
  if (last.buildModel !== manifest.buildModel) {
    reasons.push(`build model changed: ${last.buildModel} -> ${manifest.buildModel}`);
  }
  // Compare rates, not counts, so a different photo count is not a regression by itself.
  const rate = (passed: number, of: number) => (of === 0 ? 0 : passed / of);
  for (const [name, now] of [
    ['views', rate(views, total)],
    ['file', rate(file, total)],
  ] as const) {
    const before = rate(last.criteria[name].passed, last.criteria[name].total);
    if (now < before) {
      reasons.push(`${name} check fell from ${Math.round(before * 100)}% to ${Math.round(now * 100)}%`);
    }
  }
  return reasons;
}
