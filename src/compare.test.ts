import { describe, expect, test } from 'bun:test';
import { reviewReasons } from './compare.ts';
import type { EvalResults, PhotoOutcome, RunManifest } from './types.ts';

const ok = (slug: string): PhotoOutcome => ({
  slug,
  renderId: slug,
  status: 'ready',
  creditsSpent: 41,
  checks: {
    views: { passed: true, emptyCells: 0, repeatedViews: 0, minDistance: 1 },
    file: { passed: true, reason: 'ok' },
  },
});
const manifest = (outcomes: PhotoOutcome[], over: Partial<RunManifest> = {}): RunManifest => ({
  id: 'run-1',
  date: '2026-11-16',
  baseUrl: 'https://easyrender.ai',
  sheetModel: 'a + b',
  buildModel: 'c',
  outcomes,
  ...over,
});
const published = (views = 2, file = 2): EvalResults => ({
  runs: [
    {
      id: 'old',
      date: '2026-11-09',
      photos: 2,
      sheetModel: 'a + b',
      buildModel: 'c',
      criteria: {
        shape: { passed: 2, total: 2 },
        views: { passed: views, total: 2 },
        material: { passed: 2, total: 2 },
        finish: { passed: 2, total: 2 },
        file: { passed: file, total: 2 },
      },
    },
  ],
});

describe('reviewReasons', () => {
  test('a steady run needs no review', () => {
    expect(reviewReasons(manifest([ok('a'), ok('b')]), published())).toEqual([]);
  });
  test('a failed check, a changed model or a first run needs a person', () => {
    const broken = { ...ok('b'), checks: { ...ok('b').checks, file: { passed: false, reason: 'x' } } };
    expect(reviewReasons(manifest([ok('a'), broken]), published()).join(' ')).toContain('file check: 1/2');
    expect(reviewReasons(manifest([ok('a'), ok('b')], { buildModel: 'd' }), published())[0]).toContain('build model changed');
    expect(reviewReasons(manifest([ok('a'), ok('b')]), { runs: [] })[0]).toContain('baseline');
  });
  test('a render that did not finish is reported once as such', () => {
    const failed: PhotoOutcome = { ...ok('b'), status: 'failed', checks: { views: null, file: null } };
    const reasons = reviewReasons(manifest([ok('a'), failed]), published());
    expect(reasons[0]).toContain('b (failed)');
  });
  test('the preview tier never asks for a review', () => {
    expect(reviewReasons(manifest([ok('a')], { tier: 'preview' }), { runs: [] })).toEqual([]);
  });
});
