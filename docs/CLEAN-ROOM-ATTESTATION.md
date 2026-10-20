# Clean-room attestation — `PHASE3-STAMP-ENGINE`

This records the provenance of the stamp (dab) brush engine: that it is Paka's
own implementation, written from Paka's own written specification, and not
derived from any third-party brush engine.

It is required by the licence gate (`reuse-decision.md` §2.5, condition **C2**)
and by the acceptance criteria the slice was planned against.

| Field | Value |
| --- | --- |
| Feature | `PHASE3-STAMP-ENGINE` — stamp-based brush engine behind the existing stroke interface |
| Base commit | `ad2ef11bb4fac508f0dda375a3eba5d7a9b7d7c9` |
| Implementation branch | `feat/stamp-brush-engine` |
| Implementation files | `src/core/rendering/stampCoverage.ts`, `src/test/stampCoverage.test.ts`, and the changes to `src/types/brush.ts`, `src/core/brushes/defaults.ts`, `src/core/rendering/Canvas2DRenderer.ts`, `src/core/engine/DrawingEngine.ts`, `src/core/project/projectFormat.ts`, `src/features/brushes/BrushControls.tsx`, `src/test/brushSettings.test.ts`, `src/test/canvas2dRenderer.test.ts` |
| Specification written from | `docs/ROADMAP.md` "Next slice"; `docs/SESSION-BRIEF.md` §9; `docs/ARCHITECTURE.md` (rendering pipeline, brush hardness, grain texture); `docs/PROJECT_FORMAT.md`; `feature-analysis.md` §8 ("Essential to the feature's behaviour", nine items) |
| Licence of the result | MIT, the same as the rest of Paka |

## The rule

A strategy counts as an independent reimplementation only if **either** the
implementer has not read the source implementation being referenced, **or** the
implementation was written from a Paka-authored behaviour specification that
does not reproduce the source's expression, structure, constants, comments,
identifier names or code layout.

Renaming symbols, changing language, reformatting or rewriting syntax does
**not** change the status of copied implementation. A faithful translation of a
GPL implementation is a derivative work of it and must be distributed under the
same licence.

If an implementer has read GPL brush-engine source in order to produce the
implementation, that implementer's output must be discarded and re-written by
someone who has not read the source, from the Paka-authored specification.

## What is attested

**No third-party brush-engine source was consulted in the production of this
implementation.** Specifically, none of the following was read, opened,
copied, paraphrased or consulted while writing it:

| Source | Licence | Consulted? |
| --- | --- | --- |
| GIMP brush engine (`GNOME/gimp`) | GPL-3.0 | **No** |
| Krita brush engine (`KDE/krita`) | GPL-3.0 | **No** |
| MyPaint brush engine (`mypaint/mypaint`) | GPL-2.0 | **No** |
| SAI, Clip Studio, Procreate, Corel Painter, ArtRage, Rebelle | proprietary | **No** |
| Any other brush engine, tutorial, book chapter or reference implementation | — | **No** |

The implementation was written from the Paka-authored specification listed
above.

## How that is evidenced

| Evidence | What it shows |
| --- | --- |
| `feature-analysis.md` §2 and §8 | The specification the work was written from, and the statement that the feature exists nowhere in the tree — no vendored upstream code, no third-party implementation, no assets. |
| `docs/architecture-port-plan.md` §2.1, §13 | The alternatives that were considered and rejected, and the reason each was rejected. |
| `src/core/rendering/stampCoverage.ts` | The implementation imports only Paka's own modules (`../../types/brush`, `../../utils/color`, `../../utils/math`, `./canvas2dStroke`). No third-party import of any kind. |
| The same file's header comment | Describes the union rule, the absence of a max-alpha composite in Canvas 2D, and the determinism requirement — each of which is a Paka-specific constraint documented in `docs/ARCHITECTURE.md` and `feature-analysis.md` §5.3, not a description that appears in the GPL sources. |
| `package.json`, `src-tauri/Cargo.toml` | Unchanged. The slice adds **no** dependency, so no third-party code entered the tree by the dependency route either. |
| `src-tauri/icons/**`, `licenses/**` | The slice adds no asset. |
| `grep -i "gimp\|krita\|mypaint\|procreate\|clip studio\|perfect-freehand\|fabric\|konva\|paper.js\|p5"` over `src/` | No hits. No attribution, no reference, no copied constant. |

## What this attestation is not

* It is **not** a claim that the gate can verify the implementer's reading
  history. A gate can only record what the implementing agents state and what
  the tree shows. The tree is consistent with the attestation; the attestation
  is the agents' own statement.
* It does **not** cover anything the **human owner** read. If the owner read
  a GPL brush engine, or worked from a tutorial derived from one, while
  directing or reviewing this work, the owner must say so, and the
  implementation must be re-written by someone who has not read that source.
* It does **not** cover other features. It is scoped to `PHASE3-STAMP-ENGINE`
  at the commits named above.
* It is **not** a waiver. The licence gate's outcomes stand: copying or
  adapting GPL code into Paka remains **BLOCKED**, and porting a GPL
  implementation remains **BLOCKED** regardless of this attestation.

## Outstanding

The **repository owner** must countersign the statement below before the slice
is merged. The gate cannot do this on their behalf.

```
I confirm that, while directing or reviewing the PHASE3-STAMP-ENGINE work, I
did not read, copy or consult GIMP, Krita, MyPaint, SAI, Clip Studio,
Procreate, Corel Painter, ArtRage or any other third-party brush-engine
source, and that no part of this implementation is derived from one.

Name:      ______________________
Date:      ______________________
Signature: ______________________
```

If any part of that statement cannot be made truthfully, the implementation
must be re-written by someone who has not read the source named in the table
above, from the specification named above.

---

_See `reuse-decision.md` §2.5 and `provenance-record.json` →
`cleanroom.implementerAttestation` for the gate's side of this record._
