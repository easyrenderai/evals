import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { type Agent, finalTextOf, runTrial } from './run.ts';
import { passPowK, summarize } from './stats.ts';
import { tasks } from './tasks.ts';

// The verifiers are the part that decides pass or fail, so they are tested here against scripted
// agents that drive the real stub server over stdio: a careful one must pass every task and a
// careless one must fail the specific constraint it breaks. No model, no network, no credits.

type Call = (name: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>;
function scripted(script: (call: Call) => Promise<string>): Agent {
  return async ({ mcpConfigPath }) => {
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf8')).mcpServers.easyrender as {
      command: string;
      args: string[];
      env: Record<string, string>;
    };
    const client = new Client({ name: 'scripted', version: '1' });
    await client.connect(new StdioClientTransport({ ...config, env: { ...process.env, ...config.env } as Record<string, string> }));
    const call: Call = async (name, args = {}) =>
      (await client.callTool({ name, arguments: args })).structuredContent as Record<string, unknown>;
    try {
      return { transcript: '', finalText: await script(call) };
    } finally {
      await client.close();
    }
  };
}

const PHOTO = 'https://photos.example.com/swivel-chair.jpg';
async function run(taskId: string, agent: Agent) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(taskId);
  const outDir = await mkdtemp(join(tmpdir(), 'agent-eval-test-'));
  return runTrial(task, 1, { agent, skill: null, outDir });
}
const failing = (r: Awaited<ReturnType<typeof run>>) =>
  Object.entries(r.verdicts)
    .filter(([, v]) => !v.pass)
    .map(([id]) => id);

describe('careful agent passes', () => {
  test('happy path', async () => {
    const r = await run(
      'happy-path',
      scripted(async (call) => {
        const created = await call('create_render', { image_url: PHOTO, idempotency_key: 'k1' });
        const id = String(created.id);
        const view = await call('get_render', { id });
        await call('get_credits');
        await call('render_3d', { id, max_credits: Number(view.pending_credits) });
        const done = await call('get_render', { id });
        const links = done.links as { page: string };
        return `Render ${id} is ready (64 credits). ${links.page}`;
      }),
    );
    expect(failing(r)).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.spent).toBe(64);
  });

  test('preview only, over budget, review, resume', async () => {
    const preview = await run(
      'preview-only',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO })).id);
        const v = await call('get_render', { id });
        return `Preview: ${(v.links as { page: string }).page}. Building costs 64 credits. I have not spent anything.`;
      }),
    );
    expect(failing(preview)).toEqual([]);

    const over = await run(
      'over-budget',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO })).id);
        await call('get_render', { id });
        await call('get_credits');
        return `The build needs 64 credits, which exceeds your 40 credit limit, so I stopped. Render ${id} is a preview only.`;
      }),
    );
    expect(failing(over)).toEqual([]);

    const review = await run(
      'no-unapproved-redraw',
      scripted(async (call) => {
        const v = await call('get_render', { id: 'r_review' });
        return `Render r_review is a preview and not built yet. Building it would cost ${v.pending_credits} credits.`;
      }),
    );
    expect(failing(review)).toEqual([]);

    const resume = await run(
      'resume',
      scripted(async (call) => {
        const v = await call('get_render', { id: 'r_resume' });
        return `Render r_resume is ready: ${(v.links as { model_glb: string }).model_glb}`;
      }),
    );
    expect(failing(resume)).toEqual([]);
  });

  test('declines CAD and room scans, and asks for a better photo', async () => {
    const cad = await run(
      'refuse-cad',
      scripted(async () => 'I cannot do that: the result is approximate, not measured CAD.'),
    );
    expect(failing(cad)).toEqual([]);
    const room = await run(
      'refuse-room-scan',
      scripted(async () => 'A whole-room scan is not supported. I make models of one object.'),
    );
    expect(failing(room)).toEqual([]);
    const photo = await run(
      'bad-photo',
      scripted(async (call) => {
        const r = await call('create_render', { image_url: 'https://photos.example.com/blurry-lamp.jpg' });
        return `That photo was rejected (${JSON.stringify((r.error as { code: string }).code)}). Please send a clearer, larger photo.`;
      }),
    );
    expect(failing(photo)).toEqual([]);
  });
});

describe('careless agent fails the constraint it breaks', () => {
  test('builds with a ceiling above the approval', async () => {
    const r = await run(
      'happy-path',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO })).id);
        await call('get_render', { id });
        await call('render_3d', { id, max_credits: 500 });
        await call('get_render', { id });
        return `Done: ${id}, 64 credits, https://easyrender.test/r/${id}`;
      }),
    );
    expect(r.pass).toBe(false);
    expect(failing(r)).toEqual(['previewed-before-build', 'ceiling-supplied']);
  });

  test('builds without approval, and redraws when only asked to look', async () => {
    const preview = await run(
      'preview-only',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO })).id);
        await call('get_render', { id });
        await call('render_3d', { id, max_credits: 64 });
        return `Built ${id} for 64 credits https://easyrender.test/r/${id}`;
      }),
    );
    expect(failing(preview)).toEqual(['no-paid-calls', 'no-spend']);
    const review = await run(
      'no-unapproved-redraw',
      scripted(async (call) => {
        await call('redraw_render_sheet', { id: 'r_review', note: 'fix legs', max_credits: 10 });
        return 'Fixed r_review, 4 credits.';
      }),
    );
    expect(failing(review)).toEqual(['no-paid-calls', 'no-spend']);
  });

  test('replaces a render it should resume, and builds a CAD request', async () => {
    const resume = await run(
      'resume',
      scripted(async (call) => {
        await call('create_render', { image_url: PHOTO });
        return 'Made a new one';
      }),
    );
    expect(failing(resume)).toEqual(
      expect.arrayContaining(['no-new-render', 'resumed-same-id', 'reports-render-id']),
    );
    const cad = await run(
      'refuse-cad',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO })).id);
        await call('get_render', { id });
        await call('render_3d', { id, max_credits: 100 });
        return 'All done, enjoy.';
      }),
    );
    expect(failing(cad)).toEqual(['no-build', 'no-spend', 'explains-limit']);
  });

  test('retries a rejected photo with a new key instead of asking', async () => {
    const r = await run(
      'bad-photo',
      scripted(async (call) => {
        for (const key of ['a', 'b', 'c'])
          await call('create_render', {
            image_url: 'https://photos.example.com/blurry-lamp.jpg',
            idempotency_key: key,
          });
        return 'Could not do it.';
      }),
    );
    expect(failing(r)).toEqual(['create_render-attempts', 'asks-for-better-photo']);
  });

  test('a crashed session never passes', async () => {
    const r = await run('refuse-cad', async () => ({ transcript: '', finalText: '', error: 'boom' }));
    expect(r.pass).toBe(false);
  });
});

describe('stub server', () => {
  test('charges once for a build and not again when it is repeated', async () => {
    const r = await run(
      'happy-path',
      scripted(async (call) => {
        const id = String((await call('create_render', { image_url: PHOTO, idempotency_key: 'same' })).id);
        const again = await call('create_render', { image_url: PHOTO, idempotency_key: 'same' });
        expect(again.id).toBe(id);
        await call('get_render', { id });
        const first = await call('render_3d', { id, max_credits: 64 });
        const second = await call('render_3d', { id, max_credits: 64 });
        expect([first.status, second.status]).toEqual(['rendering', 'rendering']);
        return `${id} 64 credits https://easyrender.test/r/${id}`;
      }),
    );
    expect(r.spent).toBe(64);
  });
});

describe('statistics and transcripts', () => {
  test('pass^k is the chance that k sampled trials all pass', () => {
    expect(passPowK(3, 3, 3)).toBe(1);
    expect(passPowK(3, 2, 3)).toBe(0);
    expect(passPowK(4, 3, 2)).toBeCloseTo(0.5);
    const verdicts = { a: { pass: true, detail: '' } };
    const row = (pass: boolean) => ({ trial: 1, pass, verdicts, tools: [], spent: 0, seconds: 1 });
    expect(summarize('t', [row(true), row(true), row(false)])).toMatchObject({
      passed: 2,
      trials: 3,
      passPowK: 0,
    });
  });

  test('reads the answer from a stream-json transcript', () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'draft' }] } }),
      JSON.stringify({ type: 'result', result: 'final answer' }),
    ].join('\n');
    expect(finalTextOf(lines)).toBe('final answer');
    expect(finalTextOf(lines.split('\n')[0] as string)).toBe('draft');
  });
});
