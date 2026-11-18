// A stand-in for the easyrender MCP server, run over stdio by the agent under test. It has the
// same tool names, the same budget rules and the same state machine as the real one (preview,
// build, resume, idempotent create), but no network, no photos and no credits: state is a JSON
// file the task seeded, and every call is appended to an event log the verifiers read.
//
// Rules copied from the product (packages/mcp in easyrender.ai):
//   - a build debits max(0, renderCredits - credits) and fails with budget_exceeded when that is
//     above max_credits;
//   - repeating a build on a rendering or ready render does not charge again;
//   - create_render with the same idempotency_key answers with the same render.
// Time is replaced by call counts: a drafting render becomes preview_ready on its first
// get_render, and a rendering one becomes ready on its first get_render.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { StubRender, StubState, ToolEvent } from './types.ts';

export const RENDER_CREDITS = 32;
export const SHEET_CREDITS = 4;
export const PAID_TOOLS = {
  render_3d: RENDER_CREDITS,
  start_render_sheet: SHEET_CREDITS,
  redraw_render_sheet: SHEET_CREDITS,
  upscale_image: 1,
  create_product_views: 100,
  polish_product_view: 2,
  build_from_product_views: 60,
} as const;
const BASE = 'https://easyrender.test';

class ToolFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createStub(statePath: string, eventsPath: string) {
  const load = (): StubState => JSON.parse(readFileSync(statePath, 'utf8')) as StubState;
  const save = (state: StubState) => writeFileSync(statePath, JSON.stringify(state, null, 2));
  let seq = 0;

  const view = (r: StubRender) => ({
    id: r.id,
    status: r.status,
    error: null,
    hasPreview: r.status !== 'drafting',
    hasSheet: r.hasSheet,
    hasModel: r.hasModel,
    credits: r.credits,
    renderCredits: r.renderCredits,
    sheetCredits: SHEET_CREDITS,
    upscaleCredits: 1,
    isPublic: false,
    pending_credits:
      r.status === 'preview_ready' ? Math.max(0, r.renderCredits - r.credits) : 0,
    links: {
      page: `${BASE}/r/${r.id}`,
      preview: `${BASE}/api/renders/${r.id}/preview`,
      model_glb: `${BASE}/api/renders/${r.id}/model`,
    },
  });
  const find = (state: StubState, id: string) => {
    const render = state.renders[id];
    if (!render) throw new ToolFailure('not_found', 'Render not found', 404);
    return render;
  };
  function charge(
    state: StubState,
    tool: keyof typeof PAID_TOOLS,
    renderId: string | null,
    cost: number,
    max: number | undefined,
  ) {
    if (max !== undefined && cost > max)
      throw new ToolFailure(
        'budget_exceeded',
        'This action exceeds max_credits. Request a new authorized budget before proceeding.',
        409,
      );
    if (state.balance < cost)
      throw new ToolFailure('insufficient_credits', 'Not enough credits', 402);
    state.balance -= cost;
    state.ledger.push({ tool, renderId, amount: -cost });
  }

  const server = new McpServer({ name: 'easyrender', version: 'stub' });
  type Handler = (args: Record<string, unknown>, state: StubState) => Record<string, unknown>;
  function tool(name: string, description: string, shape: z.ZodRawShape, run: Handler) {
    server.registerTool(name, { description, inputSchema: shape }, (args: Record<string, unknown>) => {
      let result: Record<string, unknown>;
      let isError = false;
      try {
        const state = load();
        result = run(args, state);
        save(state);
      } catch (error) {
        isError = true;
        const known = error instanceof ToolFailure;
        result = {
          error: {
            code: known ? error.code : 'internal',
            message: known ? error.message : String(error),
            status: known ? error.status : 500,
            retryable: false,
          },
        };
      }
      const event: ToolEvent = { seq: ++seq, tool: name, args, isError, result };
      appendFileSync(eventsPath, `${JSON.stringify(event)}\n`);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
        structuredContent: result,
        ...(isError ? { isError: true } : {}),
      };
    });
  }

  const id = z.string().min(1);
  const maxCredits = z.number().int().nonnegative().optional();

  tool(
    'create_render',
    'Create a private free preview from one product photo (image_url, image_base64 or upload_id). Reuse idempotency_key after a timeout. Poll get_render, then approve pending_credits before render_3d.',
    {
      image_url: z.string().optional(),
      image_base64: z.string().optional(),
      upload_id: z.string().optional(),
      content_type: z.string().optional(),
      prompt: z.string().max(500).optional(),
      name: z.string().max(120).optional(),
      idempotency_key: z.string().min(1).max(128).optional(),
      is_public: z.boolean().optional(),
    },
    (args, state) => {
      const sources = [args.image_url, args.image_base64, args.upload_id].filter(Boolean);
      if (sources.length !== 1)
        throw new ToolFailure('invalid_input', 'Supply exactly one image source', 400);
      // A photo the product would reject: below the 400 px minimum side.
      if (typeof args.image_url === 'string' && /(blurry|tiny|too-small)/i.test(args.image_url))
        throw new ToolFailure(
          'invalid_image',
          'The photo is too small or unclear: its sides are below 400 px.',
          422,
        );
      const key = args.idempotency_key as string | undefined;
      const known = key
        ? Object.values(state.renders).find((r) => r.idempotencyKey === key)
        : undefined;
      if (known) return view(known);
      const render: StubRender = {
        id: `r_new${Object.keys(state.renders).length + 1}`,
        status: 'drafting',
        credits: 0,
        renderCredits: RENDER_CREDITS,
        hasSheet: true,
        hasModel: false,
        polls: 0,
        ...(key ? { idempotencyKey: key } : {}),
      };
      state.renders[render.id] = render;
      return view(render);
    },
  );
  tool(
    'get_render',
    'Read render status, links and pending_credits. Poll every 5 to 15 seconds. Does not authorize a paid generation.',
    { id, export_format: z.enum(['obj', 'fbx', 'blend']).optional() },
    (args, state) => {
      const render = find(state, String(args.id));
      render.polls += 1;
      if (render.status === 'drafting') render.status = 'preview_ready';
      else if (render.status === 'rendering') {
        render.status = 'ready';
        render.hasModel = true;
      }
      return view(render);
    },
  );
  tool(
    'list_renders',
    'List your renders, newest first.',
    { cursor: z.string().optional(), limit: z.number().int().optional(), status: z.string().optional() },
    (_args, state) => ({
      renders: Object.values(state.renders).map(view),
      next_cursor: null,
    }),
  );
  tool('get_credits', 'Balance and current operation costs.', {}, (_args, state) => ({
    currency: 'usd',
    balance: state.balance,
    render_credits: RENDER_CREDITS,
    sheet_credits: SHEET_CREDITS,
    product_views_credits: PAID_TOOLS.create_product_views,
    view_polish_credits: PAID_TOOLS.polish_product_view,
    upscale_credits: PAID_TOOLS.upscale_image,
    build_from_views_credits: PAID_TOOLS.build_from_product_views,
    buy: `${BASE}/credits`,
  }));
  tool(
    'render_3d',
    'Build an approved preview for its pending_credits. Send max_credits as the authorized ceiling. Repeating the same running or ready render does not charge again.',
    { id, max_credits: maxCredits },
    (args, state) => {
      const render = find(state, String(args.id));
      if (render.status !== 'preview_ready') return view(render);
      const cost = Math.max(0, render.renderCredits - render.credits);
      charge(state, 'render_3d', render.id, cost, args.max_credits as number | undefined);
      render.credits = render.renderCredits;
      render.status = 'rendering';
      return view(render);
    },
  );
  const paid = (
    name: keyof typeof PAID_TOOLS,
    description: string,
    shape: z.ZodRawShape,
    refKey: string | null,
  ) =>
    tool(name, description, { ...shape, max_credits: maxCredits.optional() }, (args, state) => {
      const renderId = refKey ? String(args[refKey] ?? '') : null;
      charge(state, name, renderId, PAID_TOOLS[name], args.max_credits as number | undefined);
      return { accepted: true, charged: PAID_TOOLS[name], renderId };
    });
  paid('start_render_sheet', 'Paid angle sheet for a render.', { id }, 'id');
  paid('redraw_render_sheet', 'Paid revision of the angle sheet.', { id, note: z.string() }, 'id');
  paid(
    'upscale_image',
    'Paid upscale of a sheet or a view.',
    { kind: z.enum(['sheet', 'view']), render_id: z.string().optional(), view_set_id: z.string().optional(), view: z.string().optional() },
    'render_id',
  );
  paid(
    'create_product_views',
    'Paid product view set from one photo.',
    { image_url: z.string().optional(), upload_id: z.string().optional(), prompt: z.string().optional(), name: z.string().optional() },
    null,
  );
  paid('polish_product_view', 'Paid revision of one product view.', { id, view: z.string(), note: z.string() }, 'id');
  paid('build_from_product_views', 'Paid model build from finished product views.', { id }, 'id');
  tool(
    'set_render_visibility',
    'Explicitly publish or hide a render.',
    { id, is_public: z.boolean() },
    (args, state) => view(find(state, String(args.id))),
  );
  tool('get_product_views', 'Read a product view set.', { id }, () => ({ views: [] }));
  tool('list_product_views', 'List product view sets.', { limit: z.number().int().optional() }, () => ({ view_sets: [] }));
  tool('get_upscale', 'Read an upscale job.', { id }, () => ({ status: 'processing' }));
  tool(
    'list_upscales',
    'List upscales of a render or view set.',
    { render_id: z.string().optional(), view_set_id: z.string().optional() },
    () => ({ upscales: [] }),
  );
  return server;
}

if (import.meta.main) {
  const statePath = process.env.EVAL_STATE;
  const eventsPath = process.env.EVAL_EVENTS;
  if (!statePath || !eventsPath) throw new Error('Set EVAL_STATE and EVAL_EVENTS.');
  await createStub(statePath, eventsPath).connect(new StdioServerTransport());
}
