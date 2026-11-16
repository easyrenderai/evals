# easyrender.ai evals

Public eval suite for [easyrender.ai](https://easyrender.ai) renders: golden-set fixtures, scorer and published results.

The suite runs the product **black-box**, through its public API and MCP server, exactly as a customer would. It has no access to the product's internals, so a score reflects what a user gets.

## Criteria

Every photo in the golden set is scored on five criteria:

1. **Shape and proportions**: the render matches the product in the photo.
2. **Eight different views**: the sheet has eight views and no two are the same.
3. **Material realism**: surfaces read as the real materials.
4. **Colour and finish**: colours and finish match the photo.
5. **Valid GLB**: the 3D file is well-formed and opens.

`views` and `file` are decided by code; `shape`, `material` and `finish` are judged by a person against the photo.

## Running

There are two tiers, because only one of them costs credits.

| Tier | What it does | Cost | Checks |
| --- | --- | --- | --- |
| preview | Creates each render, waits for the free draft sheet, stops. | No credits. Provider cost about $0.03 per photo. | `views` |
| full | Pays for the 3D build and downloads the sheet and GLB. | 64 credits per photo (384 for the six; provider cost about $0.19 each). | `views`, `file`, then a person judges `shape`, `material`, `finish` |

**Schedule.** The Eval run workflow runs both tiers every Monday at 05:23 UTC (preview first; a failed preview skips the build), and by hand from Actions, Run workflow (choose `tier`; `full` needs the word `spend`). Nothing runs on push, and nothing runs when the harness, a skill or a model changes: that would spend credits on every change. After such a change, dispatch the full tier once. At six photos a week the full tier is about $5 a month of provider cost and the preview tier under $1.

The workflow needs the repository secret `EASYRENDER_API_KEY` (an API key with the spend scope for a dedicated eval account) and fails with a clear message when it is missing. The run stops before building if the account cannot pay for every photo or if the API quotes a different price than the suite expects.

**Review only when something moved.** After the full tier, `compare` checks the automatic results against the last published run. The job fails, and the run summary says why, when a render did not finish, a check failed or fell, a model changed, or there is no published run yet. When the job is green, the judged criteria do not need a person that week. When it is red, download the `eval-run` artifact and review (below).

```bash
bun install
EASYRENDER_API_KEY=er_... bun run run-evals --preview             # free tier, every photo
EASYRENDER_API_KEY=er_... bun run run-evals --spend               # full tier, every photo
EASYRENDER_API_KEY=er_... bun run run-evals --spend --only=vase   # a subset
bun run compare <run id>                                          # does this run need a person?
```

Per photo the runner creates a render through the public REST API, hides it from the public gallery, waits for the angle sheet, (full tier) pays for the 3D build, downloads the sheet and the GLB, and runs the automatic checks. A paid build redraws the sheet at 2K with a second model, and falls back to the 1K draft if the redraw fails, so each outcome records the side of the sheet it was checked on:

- `views`: the nine cells of the sheet are all filled and none of the eight turnaround views repeats another (the same test as the product's own guardrail, but strict: the guardrail tolerates three repeats, a score does not). The preview tier checks the 1K draft.
- `file`: the GLB is a complete binary glTF 2 with at least one mesh.

A render that fails or times out fails every criterion, because that is what a customer got. A preview run builds nothing, so it is never scored or published.

Everything lands in `runs/<id>/` (photo, `sheet.png`, `model.glb` per photo, `manifest.json`, and for the full tier a `review.json` to fill in). Those files are derived from third-party photos and are never committed.

## Agent evals

The suite above checks what the product renders. `agent/` checks what an AI agent does with the easyrender MCP server and its skill: whether it shows the preview and the cost first, stays inside the budget, resumes by render id and never builds or redraws without approval. It uses a stub MCP server, so it costs no credits, and a headless `claude -p` on a Claude subscription, so it has no API bill. See [agent/README.md](agent/README.md).

## Review

`shape`, `material` and `finish` are judged by a person. Open each photo next to its `sheet.png` and `model.glb` and set `shape`, `material` and `finish` to `true` or `false` in `review.json`. Scoring refuses a run with any verdict left `null`.

```bash
bun run score <run id>          # print the result without writing anything
bun run publish-run <run id>    # write reports/<id>.json and add the run to results/latest.json
```

Open a pull request here with the two files that changed. Once it is merged, in easyrender.ai run `bun run evals:sync` and open a PR with the one file it changes (`apps/web/content/evals/latest.json`). The script validates the results first and refuses a malformed file. Publishing warns about any photo whose rights are still `unconfirmed` in `fixtures/manifest.json`.

## Results

Each run is appended to [`results/latest.json`](results/latest.json). The easyrender.ai site copies that file into `apps/web/content/evals/latest.json` and its `/evals` page reads nothing else, so every published number comes from a run. The format is in [`results/SCHEMA.md`](results/SCHEMA.md).

## Fixtures

`fixtures/manifest.json` lists the golden set: six product photos that easyrender.ai already shows on its own site (swivel chair, coffee table, two vases, armchair, bedside table). The photos are **not** stored here. Each is fetched from its `source_url` and checked against its `sha256`. Their `rights` are `unconfirmed`. The set has no stone or marble piece and no tubular-metal piece, so the material-realism rules for stone and metal tube are not exercised yet; add those photos before reading too much into the `material` score.

## License

[MIT](LICENSE)
