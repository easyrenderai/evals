// The models easyrender runs, as /models on the site names them. The API does not report them, so
// they are set here and recorded in each run; update them when the site's models page changes.
export const SHEET_MODEL = process.env.EVAL_SHEET_MODEL ?? 'google/nano-banana-2-lite';
export const BUILD_MODEL = process.env.EVAL_BUILD_MODEL ?? 'firtoz/trellis';

export const DEFAULT_BASE_URL = 'https://easyrender.ai';
export const REPO_URL = 'https://github.com/easyrenderai/evals';

export const POLL_INTERVAL_MS = Number(process.env.EVAL_POLL_MS ?? 5_000);
export const PHASE_TIMEOUT_MS = 10 * 60_000;
export const CONCURRENCY = 3;

// What a full 3D render costs, as the pricing on /models and /credits says. A run stops before it
// spends anything if the API quotes a different price, so a price change is noticed, not absorbed.
export const RENDER_CREDITS = Number(process.env.EVAL_RENDER_CREDITS ?? 42);
