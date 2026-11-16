// Runs the agent tasks. Each trial starts a fresh headless `claude -p` session wired to the stub
// MCP server, then checks what the stub recorded. It uses the Claude Code login on this machine
// (a subscription); ANTHROPIC_API_KEY is removed from the child's environment so it cannot bill
// the API by accident. Run it on the Studio, never on a laptop. See agent/README.md.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatTable, summarize, type TaskSummary, type TrialResult } from './stats.ts';
import { tasks as allTasks } from './tasks.ts';
import type { StubState, Task, ToolEvent, VerifyContext } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));

export type AgentOutput = { transcript: string; finalText: string; error?: string };
export type Agent = (input: {
  prompt: string;
  system: string;
  mcpConfigPath: string;
  cwd: string;
  model?: string;
}) => Promise<AgentOutput>;

export function readEvents(path: string): ToolEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ToolEvent);
}

export function verify(task: Task, ctx: VerifyContext) {
  return Object.fromEntries(task.verifiers.map((v) => [v.id, v.check(ctx)]));
}

/** What the agent reads about the skill: SKILL.md plus its references, as a client would load them. */
export function loadSkill(dir: string): string {
  const parts = ['SKILL.md', 'references/mcp.md', 'references/workflows.md'].map((file) => {
    const path = join(dir, file);
    if (!existsSync(path)) throw new Error(`Skill file missing: ${path}`);
    return `<!-- ${file} -->\n${readFileSync(path, 'utf8')}`;
  });
  return parts.join('\n\n');
}

export function systemPrompt(skill: string | null): string {
  const base =
    'You are an assistant connected to an easyrender MCP server (tools named mcp__easyrender__*). ' +
    'Use those tools to do what the user asks. Reply to the user in plain text when you are done or blocked.';
  return skill ? `${base}\n\nSkill you have installed:\n\n${skill}` : base;
}

/** The real agent: headless Claude Code with no built-in tools, only the stub MCP server. */
export const claudeAgent: Agent = ({ prompt, system, mcpConfigPath, cwd, model }) =>
  new Promise((resolvePromise) => {
    const args = [
      '-p',
      prompt,
      '--output-format',
      'stream-json',
      '--verbose',
      '--mcp-config',
      mcpConfigPath,
      '--strict-mcp-config',
      '--tools',
      '',
      '--allowedTools',
      'mcp__easyrender',
      '--append-system-prompt',
      system,
      '--no-session-persistence',
      ...(model ? ['--model', model] : []),
    ];
    const env = { ...process.env };
    // Subscription only. An API key in the environment would switch the session to API billing.
    delete env.ANTHROPIC_API_KEY;
    delete env.ANTHROPIC_AUTH_TOKEN;
    const child = spawn(process.env.CLAUDE_BIN ?? 'claude', args, { cwd, env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 6 * 60_000);
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({
        transcript: out,
        finalText: finalTextOf(out),
        ...(code === 0 ? {} : { error: `claude exited ${code}: ${err.slice(0, 500)}` }),
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolvePromise({ transcript: out, finalText: '', error: String(e) });
    });
  });

/** The `result` line of a stream-json transcript, or the last assistant text if there is none. */
export function finalTextOf(transcript: string): string {
  let last = '';
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line) as {
        type?: string;
        result?: string;
        message?: { content?: Array<{ type: string; text?: string }> };
      };
      if (msg.type === 'result' && typeof msg.result === 'string') return msg.result;
      if (msg.type === 'assistant') {
        const text = (msg.message?.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join('\n');
        if (text) last = text;
      }
    } catch {
      // A partial line is not a message.
    }
  }
  return last;
}

export async function runTrial(
  task: Task,
  trial: number,
  opts: { agent: Agent; skill: string | null; model?: string; outDir: string },
): Promise<TrialResult> {
  const work = await mkdtemp(join(tmpdir(), `agent-eval-${task.id}-`));
  const statePath = join(work, 'state.json');
  const eventsPath = join(work, 'events.jsonl');
  const mcpConfigPath = join(work, 'mcp.json');
  const seeded: StubState = {
    balance: task.seed.balance,
    renders: Object.fromEntries((task.seed.renders ?? []).map((r) => [r.id, r])),
    ledger: [],
  };
  await writeFile(statePath, JSON.stringify(seeded));
  await writeFile(eventsPath, '');
  await writeFile(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        easyrender: {
          command: process.execPath,
          args: [join(here, 'stub-server.ts')],
          env: { EVAL_STATE: statePath, EVAL_EVENTS: eventsPath },
        },
      },
    }),
  );
  const started = Date.now();
  const output = await opts.agent({
    prompt: task.prompt,
    system: systemPrompt(opts.skill),
    mcpConfigPath,
    cwd: work,
    model: opts.model,
  });
  const events = readEvents(eventsPath);
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as StubState;
  const verdicts = verify(task, { events, state, finalText: output.finalText });
  const result: TrialResult = {
    trial,
    // A trial that crashed or never answered cannot pass, whatever the verifiers say.
    pass:
      !output.error && output.finalText.length > 0 && Object.values(verdicts).every((v) => v.pass),
    verdicts,
    tools: events.map((e) => e.tool),
    spent: -state.ledger.reduce((s, r) => s + r.amount, 0),
    seconds: Math.round((Date.now() - started) / 1000),
    ...(output.error ? { error: output.error } : {}),
  };
  const dir = join(opts.outDir, task.id, `trial-${trial}`);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'transcript.jsonl'), output.transcript);
  await writeFile(join(dir, 'events.jsonl'), readFileSync(eventsPath));
  await writeFile(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  await writeFile(join(dir, 'final.txt'), output.finalText);
  await writeFile(join(dir, 'result.json'), JSON.stringify(result, null, 2));
  await rm(work, { recursive: true, force: true });
  return result;
}

export async function runAgentEvals(opts: {
  agent: Agent;
  tasks: Task[];
  trials: number;
  skill: string | null;
  model?: string;
  outDir: string;
}): Promise<TaskSummary[]> {
  const summaries: TaskSummary[] = [];
  for (const task of opts.tasks) {
    const results: TrialResult[] = [];
    for (let trial = 1; trial <= opts.trials; trial += 1) {
      const result = await runTrial(task, trial, opts);
      results.push(result);
      console.error(`${task.id} trial ${trial}/${opts.trials}: ${result.pass ? 'pass' : 'FAIL'}`);
    }
    summaries.push(summarize(task.id, results));
  }
  await mkdir(opts.outDir, { recursive: true });
  await writeFile(
    join(opts.outDir, 'summary.json'),
    JSON.stringify(
      { trials: opts.trials, skill: opts.skill !== null, model: opts.model ?? null, tasks: summaries },
      null,
      2,
    ),
  );
  return summaries;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const flag = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const only = flag('tasks')?.split(',');
  const selected = only ? allTasks.filter((t) => only.includes(t.id)) : allTasks;
  if (selected.length === 0) throw new Error('No tasks selected.');
  const trials = Number(flag('trials') ?? 3);
  const baseline = argv.includes('--baseline');
  const skillDir = resolve(
    flag('skill') ??
      process.env.EASYRENDER_SKILL_DIR ??
      join(here, '../../easyrender.ai/skills/easyrender-image-to-3d'),
  );
  const skill = baseline ? null : loadSkill(skillDir);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = resolve(
    flag('out') ?? join(here, '../runs/agent', `${stamp}${baseline ? '-baseline' : ''}`),
  );
  const summaries = await runAgentEvals({
    agent: claudeAgent,
    tasks: selected,
    trials,
    skill,
    model: flag('model'),
    outDir,
  });
  console.log(formatTable(summaries));
  console.log(`\nTranscripts and per-trial results: ${outDir}`);
  process.exit(summaries.every((s) => s.passed === s.trials) ? 0 : 1);
}
