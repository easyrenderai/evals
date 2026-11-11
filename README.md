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

Runs are **manual only**. A run renders every photo in 3D on the easyrender account behind the API key, so it costs that account 80 credits per photo (about $0.80 each; the provider cost to easyrender is lower). Nothing runs on push or on a schedule.

```bash
bun install
EASYRENDER_API_KEY=er_... bun run run-evals --spend            # every photo
EASYRENDER_API_KEY=er_... bun run run-evals --spend --only=vase  # a subset
```

Or use the **Eval run** workflow (Actions, Run workflow), which needs a repository secret `EASYRENDER_API_KEY` and the word `spend` typed as confirmation. The run stops before building if the account cannot pay for every photo or if the API quotes a different price than the suite expects.

Per photo the runner creates a render through the public REST API, hides it from the public gallery, waits for the angle sheet, pays for the 3D build, downloads the full sheet and the GLB, and runs the two automatic checks:

- `views`: the nine cells of the sheet are all filled and none of the eight turnaround views repeats another (the same test as the product's own guardrail, but strict: the guardrail tolerates three repeats, a score does not).
- `file`: the GLB is a complete binary glTF 2 with at least one mesh.

A render that fails or times out fails every criterion, because that is what a customer got.

Everything lands in `runs/<id>/` (photo, `sheet.png`, `model.glb` per photo, `manifest.json`, and a `review.json` to fill in). Those files are derived from third-party photos and are never committed.

## Review

`shape`, `material` and `finish` are judged by a person. Open each photo next to its `sheet.png` and `model.glb` and set `shape`, `material` and `finish` to `true` or `false` in `review.json`. Scoring refuses a run with any verdict left `null`.

```bash
bun run score <run id>          # print the result without writing anything
bun run publish-run <run id>    # write reports/<id>.json and add the run to results/latest.json
```

Open a pull request with the two files that changed. Publishing warns about any photo whose rights are still `unconfirmed` in `fixtures/manifest.json`.

## Results

Each run is appended to [`results/latest.json`](results/latest.json). The easyrender.ai site copies that file into `apps/web/content/evals/latest.json` and its `/evals` page reads nothing else, so every published number comes from a run. The format is in [`results/SCHEMA.md`](results/SCHEMA.md).

## Fixtures

`fixtures/manifest.json` lists the golden set: six product photos that easyrender.ai already shows on its own site (swivel chair, coffee table, two vases, armchair, bedside table). The photos are **not** stored here. Each is fetched from its `source_url` and checked against its `sha256`. Their `rights` are `unconfirmed`. The set has no stone or marble piece and no tubular-metal piece, so the material-realism rules for stone and metal tube are not exercised yet; add those photos before reading too much into the `material` score.

## License

[MIT](LICENSE)
