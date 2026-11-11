import {
  CRITERIA,
  type Criterion,
  type EvalRun,
  METHOD,
  type Review,
  type RunManifest,
  type Score,
} from './types.ts';

type ReviewedCriterion = 'shape' | 'material' | 'finish';

/**
 * Turns a run and its review into the EvalRun the site reads. A photo whose render failed or timed
 * out fails every criterion, because that is what a customer got. A finished render needs a verdict
 * on each reviewed criterion; a missing one is an error, never a pass.
 */
export function score(manifest: RunManifest, review: Review): Omit<EvalRun, 'reportUrl'> {
  const criteria = Object.fromEntries(
    CRITERIA.map((c) => [c, { passed: 0, total: 0 } satisfies Score]),
  ) as Record<Criterion, Score>;
  const missing: string[] = [];

  for (const outcome of manifest.outcomes) {
    for (const criterion of CRITERIA) {
      criteria[criterion].total++;
      if (outcome.status !== 'ready') continue;
      let isPass: boolean | null;
      if (METHOD[criterion] === 'checks') {
        isPass = outcome.checks[criterion as 'views' | 'file']?.passed ?? false;
      } else {
        isPass = review[outcome.slug]?.[criterion as ReviewedCriterion] ?? null;
        if (isPass === null) missing.push(`${outcome.slug}/${criterion}`);
      }
      if (isPass) criteria[criterion].passed++;
    }
  }
  if (missing.length > 0) throw new Error(`review.json is incomplete: ${missing.join(', ')}`);

  return {
    id: manifest.id,
    date: manifest.date,
    photos: manifest.outcomes.length,
    sheetModel: manifest.sheetModel,
    buildModel: manifest.buildModel,
    criteria,
  };
}
