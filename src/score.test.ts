import { describe, expect, test } from 'bun:test';
import { score } from './score.ts';
import type { PhotoOutcome, Review, RunManifest } from './types.ts';

const ready = (slug: string, views = true, file = true): PhotoOutcome => ({
  slug,
  renderId: slug,
  status: 'ready',
  creditsSpent: 80,
  checks: {
    views: { passed: views, emptyCells: 0, repeatedViews: 0, minDistance: 0.05 },
    file: { passed: file, reason: 'ok' },
  },
});

const manifest = (outcomes: PhotoOutcome[]): RunManifest => ({
  id: 'run-1',
  date: '2026-11-12',
  baseUrl: 'https://easyrender.ai',
  sheetModel: 'google/nano-banana-pro',
  buildModel: 'firtoz/trellis',
  outcomes,
});

const yes = { shape: true, material: true, finish: true };

describe('score', () => {
  test('counts checks and reviews per criterion', () => {
    const run = score(manifest([ready('a'), ready('b', false)]), {
      a: yes,
      b: { shape: true, material: false, finish: true },
    });
    expect(run.photos).toBe(2);
    expect(run.criteria).toEqual({
      shape: { passed: 2, total: 2 },
      views: { passed: 1, total: 2 },
      material: { passed: 1, total: 2 },
      finish: { passed: 2, total: 2 },
      file: { passed: 2, total: 2 },
    });
  });

  test('a failed or timed-out render fails every criterion and needs no review', () => {
    const failed: PhotoOutcome = {
      slug: 'c',
      renderId: 'c',
      status: 'failed',
      creditsSpent: 0,
      checks: { views: null, file: null },
    };
    const run = score(manifest([ready('a'), failed]), { a: yes });
    expect(run.criteria.shape).toEqual({ passed: 1, total: 2 });
    expect(run.criteria.file).toEqual({ passed: 1, total: 2 });
  });

  test('refuses an unreviewed photo instead of counting it as a pass', () => {
    const review: Review = { a: { shape: true, material: null, finish: true } };
    expect(() => score(manifest([ready('a')]), review)).toThrow('a/material');
    expect(() => score(manifest([ready('a')]), {})).toThrow('a/shape, a/material, a/finish');
  });
});
