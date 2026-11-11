// Mirrors apps/web/lib/evals.ts in easyrender.ai: the shape the site reads from results/latest.json.

export const CRITERIA = ['shape', 'views', 'material', 'finish', 'file'] as const;
export type Criterion = (typeof CRITERIA)[number];

/** `checks` are decided by code; `review` ones are judged by a person against the photo. */
export const METHOD: Record<Criterion, 'checks' | 'review'> = {
  shape: 'review',
  views: 'checks',
  material: 'review',
  finish: 'review',
  file: 'checks',
};

export const REVIEWED = CRITERIA.filter((c) => METHOD[c] === 'review');

export type Score = { passed: number; total: number };

export type EvalRun = {
  id: string;
  date: string;
  photos: number;
  sheetModel: string;
  buildModel: string;
  criteria: Record<Criterion, Score>;
  reportUrl?: string;
};

export type EvalResults = { runs: EvalRun[] };

export type Photo = {
  slug: string;
  title: string;
  prompt: string;
  materials: string[];
  source_url: string;
  sha256: string;
  rights: 'unconfirmed' | 'confirmed' | 'owned';
};

/** What the automatic checks found for one photo. `null` means the render never got that far. */
export type CheckResult = {
  views: { passed: boolean; emptyCells: number; repeatedViews: number; minDistance: number } | null;
  file: { passed: boolean; reason: string } | null;
};

export type PhotoOutcome = {
  slug: string;
  renderId: string | null;
  status: 'ready' | 'failed' | 'timeout' | 'error';
  creditsSpent: number | null;
  /** Shorter side of the sheet that was checked, in pixels: tells a 1K draft from a 2K redraw. */
  sheetSide?: number;
  checks: CheckResult;
  error?: string;
};

export type RunManifest = {
  id: string;
  date: string;
  baseUrl: string;
  sheetModel: string;
  buildModel: string;
  outcomes: PhotoOutcome[];
};

/** A person's verdict on the three reviewed criteria, per photo. `null` is not reviewed yet. */
export type Review = Record<
  string,
  { shape: boolean | null; material: boolean | null; finish: boolean | null; notes?: string }
>;
