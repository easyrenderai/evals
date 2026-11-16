export type ToolEvent = {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  isError: boolean;
  /** structuredContent of the reply (the render view, or `{ error }` for a failure). */
  result: Record<string, unknown>;
};

export type StubRender = {
  id: string;
  status: 'drafting' | 'preview_ready' | 'rendering' | 'ready' | 'failed';
  /** Credits already paid on this render. */
  credits: number;
  renderCredits: number;
  hasSheet: boolean;
  hasModel: boolean;
  /** get_render calls seen, used to advance drafting and rendering deterministically. */
  polls: number;
  idempotencyKey?: string;
};

export type LedgerRow = { tool: string; renderId: string | null; amount: number };

export type StubState = {
  balance: number;
  renders: Record<string, StubRender>;
  ledger: LedgerRow[];
};

export type Seed = { balance: number; renders?: StubRender[] };

export type Verdict = { pass: boolean; detail: string };

export type VerifyContext = {
  events: ToolEvent[];
  state: StubState;
  /** The agent's last message to the user. */
  finalText: string;
};

/** One constraint, checked on its own so a failing run says exactly which rule broke. */
export type Verifier = {
  id: string;
  description: string;
  check: (ctx: VerifyContext) => Verdict;
};

export type Task = {
  id: string;
  title: string;
  prompt: string;
  seed: Seed;
  verifiers: Verifier[];
};
