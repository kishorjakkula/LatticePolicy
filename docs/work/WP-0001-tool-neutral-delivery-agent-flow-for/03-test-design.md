# Test design — WP-0001

| Criterion | Case | Layer | Data | Expected |
| --- | --- | --- | --- | --- |
| REQ-1–3 / order | Contracts load in stage order with valid headers | Node unit | real `agents/` | 13 agents, ordered |
| REQ-1–3 / tracks | Quick, standard, major plans and gate placement | Node unit | real `agents/` | quick: C after reviewer; standard: A, C, D; major: A–D |
| REQ-1–3 / handoffs | Start, prompt, placeholder refusal, wrong-stage refusal, run to release | Node unit, temp repo | synthetic request | stops at each gate; released at end |
| Human control | Approval needs a name, only at the next gate | Node unit | synthetic | errors otherwise |
| Human control | Returns re-run later stages; third return stops for a person | Node unit | synthetic | `needs-human` |
| Human control | CI catches stages done past a pending gate and leftover placeholders | Node unit | synthetic | problems reported |
| Human control | PR body rules: missing, quick with reason, WP with gate pending, bot exempt | Node unit | synthetic | as specified |
| REQ-4 | Adapters generated for every agent and tool; regeneration stable; drift detected | Node unit, temp repo | real contracts | no drift; edit detected |
| REQ-4 | Committed adapters match contracts | Node unit | repository | no drift |
| REQ-5 | Knowledge report: due, current, missing, ADRs exempt | Node unit | synthetic | as specified |
| REQ-5 | Real knowledge base has metadata | Node unit | repository | none missing |

## Negative, authorization and tenant-isolation cases

Covered above (approval without name, wrong gate, wrong stage, placeholders,
missing work package). No tenant data is involved.

## Regression cases

All existing CI jobs must stay green; the new CI step runs before the
application tests.
