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

Runs are **manual-dispatch only**. A full run costs about $2.50 of credits, so nothing runs on a schedule or on push.

## Results

Each run is appended to [`results/latest.json`](results/latest.json). The easyrender.ai site copies that file into `apps/web/content/evals/latest.json` and its `/evals` page reads nothing else, so every published number comes from a run. The format is in [`results/SCHEMA.md`](results/SCHEMA.md).

## Fixtures

`fixtures/` is empty on purpose. No photo is committed until its rights are confirmed.

## License

[MIT](LICENSE)
