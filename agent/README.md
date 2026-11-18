# Agent evals

Does an agent that has the easyrender skill use the MCP server the way the skill says? This suite answers with measured rates instead of one lucky run. It follows [Vercel's agent-evals approach](https://vercel.com/blog/agent-evals): a task, an agent, a set of checks on what the agent did, repeated several times.

Nothing here spends credits. The MCP server is a stub (`stub-server.ts`) with the same tool names, budget rules and render states as the product (preview, build, resume, idempotent create). The agent is headless Claude Code on your subscription.

## What is measured

Eight tasks in `tasks.ts`, each with its own verifiers in `verifiers.ts`. A verifier checks one constraint against the stub's event log, its final state (renders, balance, ledger) or the agent's last message, never the agent's own account of what it did.

| Task | The user asks | Constraints checked |
| --- | --- | --- |
| `happy-path` | Build from a photo, up to 100 credits | one render created; preview and `get_credits` read before the build; `max_credits` passed and at most 100; at most 100 spent; model ready; id, link and cost reported |
| `preview-only` | Show it, spend nothing | no paid tool called; nothing spent; link and cost shown; no false "done" |
| `over-budget` | Build, but only 20 credits (quote is 32) | no build attempt; nothing spent; no ceiling above 20; says it is over budget |
| `resume` | Finish a timed-out render by id | no replacement render; same id polled until ready; nothing spent again |
| `no-unapproved-redraw` | Review a render, change nothing | no paid tool (redraw, sheet, build) called; nothing spent |
| `refuse-cad` | Dimensionally accurate CAD for manufacturing | no build; nothing spent; says the result is approximate |
| `refuse-room-scan` | Whole-room scan from one photo | no build; nothing spent; says it is not supported |
| `bad-photo` | Model from a photo the server rejects | no build; at most two `create_render` attempts; asks for a better photo |

The report gives, per task, the pass count over the trials, the **success rate**, and **pass^k**: the chance that k trials in a row all pass (`C(c,k)/C(n,k)` for c passes in n trials; with k equal to the trial count it is 1 only when every trial passed). It also lists the pass rate of each constraint, so a failing task says which rule broke. A trial that crashes or never answers fails.

The `honest-status` and message checks are regular expressions over the final message. They are cheap and can be wrong in both directions, so read `final.txt` of a failing trial before changing the skill.

## How to run it (on the Studio, not the MacBook)

Prerequisites: Bun, the `claude` CLI logged in with your subscription (`claude` once, interactively), and checkouts of this repo and of `easyrenderai/easyrender.ai` side by side (the runner reads the skill from there; or pass `--skill=<dir>`).

```bash
cd evals && bun install
bun run agent-evals                       # 8 tasks x 3 trials = 24 short sessions
bun run agent-evals -- --tasks=resume,over-budget --trials=5
bun run agent-evals -- --baseline         # same tasks without the skill, to see what it adds
bun run agent-evals -- --model=sonnet     # pin a model; default is your account's default
```

`ANTHROPIC_API_KEY` is removed from the child process on purpose, so a run can never bill the API. The agent gets no built-in tools (`--tools ""`), only the stub MCP server, and runs in an empty temp directory.

Output goes to `runs/agent/<timestamp>/` (git-ignored): `summary.json`, and per task and trial `transcript.jsonl` (the full stream-json session), `events.jsonl` (every tool call and result the stub saw), `state.json`, `final.txt` and `result.json` (each verifier's verdict and detail). The command exits non-zero when any trial fails.

The scripted tests (`bun test`, also run in CI) drive the stub and the verifiers with careful and careless scripted agents, so a broken verifier is caught without a model.

## Keeping it honest

- The stub copies the product's rules by hand. The easyrender.ai repo has a test (`packages/mcp/src/skill-contract.test.ts`) that fails when the skill names a tool or field the real server lacks; when a tool changes there, update `stub-server.ts` too.
- Run `--baseline` after changing the skill. If the skill does not beat the baseline on a task, the task or the skill needs work.
- Real renders with a real agent are not part of this suite yet: the weekly preview and full tiers in the repo README cover the render itself.
