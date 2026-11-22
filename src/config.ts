// The models easyrender runs, as /models on the site names them. The API does not report them, so
// they are set here and recorded in each run; update them when the site's models page changes.
// The free preview draws a 1K draft with the first; a paid build redraws the sheet at 2K with the
// second and builds from it. If the redraw fails the product builds from the draft instead, so
// each outcome records the side of the sheet it was checked on (about 1K is a draft, 2K a redraw).
export const SHEET_DRAFT_MODEL = process.env.EVAL_SHEET_DRAFT_MODEL ?? 'google/nano-banana-2-lite';
export const SHEET_FINAL_MODEL = process.env.EVAL_SHEET_FINAL_MODEL ?? 'google/nano-banana-2';
export const SHEET_MODEL = `${SHEET_DRAFT_MODEL} + ${SHEET_FINAL_MODEL}`;
export const BUILD_MODEL = process.env.EVAL_BUILD_MODEL ?? 'firtoz/trellis';

export const DEFAULT_BASE_URL = 'https://easyrender.ai';
export const REPO_URL = 'https://github.com/easyrenderai/evals';

export const POLL_INTERVAL_MS = Number(process.env.EVAL_POLL_MS ?? 5_000);
export const PHASE_TIMEOUT_MS = 10 * 60_000;
export const CONCURRENCY = 3;

// The build price is whatever the API quotes on each render (renderCredits, from the product's own
// pricing), so no number lives here. To make a run stop when the price moves, pin the price the
// run should expect: EVAL_RENDER_CREDITS=<credits>. Unset, the run builds at the live quote and
// records what it spent.
const pinned = process.env.EVAL_RENDER_CREDITS;
export const EXPECTED_RENDER_CREDITS: number | null = pinned ? Number(pinned) : null;
