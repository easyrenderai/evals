# results/latest.json

```json
{ "runs": [ /* EvalRun, ... */ ] }
```

The file starts as `{"runs": []}`. Until the first run is published the site says so instead of showing a figure.

## EvalRun

Mirrors `EvalRun` in easyrender.ai `apps/web/lib/evals.ts`.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | Unique id of the run. |
| `date` | string | Date of the run, `YYYY-MM-DD`. |
| `photos` | number | Photos in the golden set for this run. |
| `sheetModel` | string | Model that produced the view sheet, as the app names it. |
| `buildModel` | string | Model that built the 3D asset, as the app names it. |
| `criteria` | object | One score per criterion, below. |
| `reportUrl` | string, optional | Public report of the run. |

## criteria

Keys: `shape`, `views`, `material`, `finish`, `file`. Each value is a score:

```json
{ "passed": 0, "total": 0 }
```

`passed` is the number of photos that passed the criterion and `total` the number scored. An empty score (`total: 0`) counts as 0%.

| Criterion | Decided by |
| --- | --- |
| `shape` | review |
| `views` | checks |
| `material` | review |
| `finish` | review |
| `file` | checks |

`checks` are decided by code; `review` ones are judged by a person against the photo.
