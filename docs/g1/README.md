# G1 — the stamp (dab) brush engine: slice record

This folder is the record of the **G1 / S1** slice, the stamp (dab) brush
engine, as it was merged. It is the *evidence* behind the code in `src/`, not
a project document: the project documents are
[`ARCHITECTURE.md`](../ARCHITECTURE.md), [`PROJECT_FORMAT.md`](../PROJECT_FORMAT.md),
[`ROADMAP.md`](../ROADMAP.md) and [`SESSION-BRIEF.md`](../SESSION-BRIEF.md).

## What is here

| Document | What it is |
| --- | --- |
| [`implementation-report.md`](implementation-report.md) | What was implemented, which files changed, what was verified, and the deviations from the written plan. Its section 9 holds the complete **32**-criterion acceptance inventory. |
| [`qa-report.md`](qa-report.md) | The independent QA review: the behaviour verified in real Chromium pixels, the mutation testing, and the findings. Its verdict on the slice as merged was **PASS**. |
| [`reuse-decision.md`](reuse-decision.md) | The **License and Provenance Gate** decision: which reuse strategies are approved, which are blocked, and the obligations that follow. |
| [`provenance-record.json`](provenance-record.json) | The machine-readable companion to the gate: the per-file provenance and licence map, the dependency licence inventory, and the clean-room conditions. |
| [`feature-analysis.md`](feature-analysis.md) | The analyst's report on the feature: the invariants, the hazards, the conflicts and the open questions. Its section 8 is the **Paka-authored behaviour specification** the implementation was written from. |
| [`feature-evidence.json`](feature-evidence.json) | The machine-readable companion to the analysis: the symbol index, the data-flow map, the invariants and the acceptance cases. |

The slice's **design** documents stay in `docs/` because they are part of the
project's documentation set:
[`architecture-port-plan.md`](../architecture-port-plan.md) (the approved
design), [`acceptance-criteria.json`](../acceptance-criteria.json) (the 32
acceptance criteria) and [`memory-budget-review.md`](../memory-budget-review.md)
(the resource-bounds review that shaped the implementation).

## What is deliberately not here

| Omitted | Why |
| --- | --- |
| The QA harness under `qa/` | Disposable. It is a browser harness, not a product, and it is not part of the distribution. `qa-report.md` refers to it by path; those references point outside the distribution. |
| `final-audit.md` | It audits the **previous** rendering-performance slice (R1), not G1. |
| The pipeline handoffs (`follow-up-handoff.md`, `follow-up-verification.md`) and `stamp-final-verification.md` | Agent scratch and a superseded closing-evidence report. The durable conclusions are in the two reports above. |

## How to read this slice

1. [`architecture-port-plan.md`](../architecture-port-plan.md) — the design that
   was approved, and the hazards it named.
2. [`implementation-report.md`](implementation-report.md) — what was built, and
   the deviations with their reasons.
3. [`qa-report.md`](qa-report.md) — what was independently verified, in real
   browser pixels, and what was left open.
4. [`reuse-decision.md`](reuse-decision.md) — the legal and provenance position
   the code was written under.

The slice's own status in the project: the format is **version 9**, the stamp
is **off by default**, and a brush with the stamp off renders **byte for byte**
as it did before the slice.
