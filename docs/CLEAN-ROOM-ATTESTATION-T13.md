# Clean-room attestation — `T-13-CONTRAST-READOUT`

This records the provenance of the contrast and colour-difference readout: that
it is Paka's own implementation, written from published standards and a
Paka-authored specification, and not derived from any third-party colour
library's implementation.

It is required by the licence gate (`docs/g1/reuse-decision.md` §2.5) before
the slice is merged. The gate's own decision for this candidate is recorded
in `wave0/PROVENANCE-GATE.md` §2.1: the implementation is **NO-SOURCE**,
because the metrics are computed from published standards, and `chroma.js` is
**REFERENCE-ONLY**. This document is the process record behind that decision.
It records facts; it decides nothing.

| Field | Value |
| --- | --- |
| Feature | `T-13-CONTRAST-READOUT` — a contrast and colour-difference readout beside the HSV colour wheel |
| Base commit | `35750206ccaecc65535252f7cb80b153269eb3bf` (`feat/stamp-brush-engine`) |
| Implementation branch | `feat/t13-contrast-dee` |
| Implementation commit | `2d52647` |
| Implementer | the T-13 implementation session (an AI coding agent), in its own worktree; the independent review was a separate reviewer session |
| Implementation files | `src/utils/colorMetrics.ts`, `src/test/colorMetrics.test.ts`, `src/features/color/ContrastReadout.tsx`, `src/features/color/palette.ts`, and the changes to `src/features/color/ColorControls.tsx`, `src/features/color/ColorPanel.tsx`, `src/features/color/color.css`, `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`, `docs/HANDOFF.md`, `docs/ROADMAP.md`, `docs/SESSION-BRIEF.md`, `tests/visual/README.md`, `tests/visual/scenes/contrast-readout.json`, `tests/visual/visual.spec.ts-snapshots/contrast-readout-win32.png` |
| Specification written from | the T-13 discovery plan `docs/t13-contrast-dee-plan.md` (a Paka-side document, committed on the Paka branch `docs/t13-contrast-dee-plan` in the discovery worktree); `docs/ARCHITECTURE.md` (colour sampling, the colour wheel); `docs/SESSION-BRIEF.md`; the published standards listed below |
| Standards implemented from | WCAG 2.2 (relative luminance, contrast ratio); CIE 142-2001 / ISO 11664-6 (CIELAB, CIEDE2000); Sharma, Wu & Dalal (2005) — the published CIEDE2000 verification data |
| Third-party implementation consulted | **None** |
| Licence of the result | MIT, the same as the rest of Paka |

## The rule

A strategy counts as an independent reimplementation only if **either**
(a) the implementer has not read the source implementation being referenced,
**or** (b) the implementation was written from a **Paka-authored** behaviour
specification that does not reproduce the source's expression, structure,
constants, comments, identifier names or code layout.

Renaming symbols, changing language, reformatting or rewriting syntax does
**not** change the status of copied implementation. A faithful translation of a
GPL implementation is a derivative work of it and must be distributed under the
same licence.

For this slice both limbs are claimed, and the second is evidenced by the
independent review's mechanical comparison of the artefact (below).

## What is attested

**No third-party colour implementation was consulted in the production of this
implementation.** Specifically, none of the following was read, opened, copied,
paraphrased or consulted while writing it:

| Source | Licence | Consulted? |
| --- | --- | --- |
| `chroma.js` — `gka/chroma.js` @ `14e2b8adc753b018718bdfce53cc0dcc1ebb8d91` (chroma-js 3.2.0), in particular `src/utils/contrast.js`, `src/utils/contrastAPCA.js`, `src/utils/delta-e.js` | BSD-3-Clause | **No** |
| `colorjs.io` | MIT | **No** |
| `culori` | ISC | **No** |
| `colour-science`, `colormine`, `tinycolor`, any other colour library | various | **No** |
| Any tutorial, blog post, book chapter, talk or reference implementation of WCAG contrast or CIEDE2000 | — | **No** |

**`chroma.js` was not opened at any point.** The slice's brief permitted
reading it to check arithmetic and forbade copying its expression; no file of
it was opened, because checking the arithmetic against the published
verification data was sufficient. It was not present in the worktree, and it
is not present in the tree now. (At the revision named above there is no
`src/contrast/` directory; the contrast files live under `src/utils/`, and
neither was opened.)

The implementation was written from the Paka-authored specification and the
published standards listed below.

## What was read, and where it came from

The inputs were **published specifications** and **published reference data**,
not another party's implementation.

| Input | What was taken from it | How it was obtained |
| --- | --- | --- |
| **WCAG 2.2** — relative luminance and the contrast ratio (W3C Recommendation, 12 December 2024) | the definition of relative luminance (the sRGB transfer function and its 0.04045 breakpoint, the 0.2126 / 0.7152 / 0.0722 weighting) and of the contrast ratio | The Recommendation itself was **not fetched** during implementation. The definition was implemented from the published standard as restated in the Paka-side plan (`docs/t13-contrast-dee-plan.md` §5.1–5.2); the module's header cites the W3C URLs. The independent review fetched the Recommendation afterwards and cross-checked the module against it (maximum difference 1e-12 over a 20-colour sweep, both argument orders) |
| **CIE 142-2001 / ISO 11664-6** — CIELAB (D65) and CIEDE2000 | the CIEXYZ-to-LAB transform and the CIEDE2000 difference formula, including the three branch conditions (the neutral hue, `C₁'·C₂' = 0`, and the mean-hue discontinuity) and the rotation term `R_T = −sin(2Δθ)·R_C` | Implemented from the published standard as restated in the Paka-side plan (§5.3–5.4 and §8). The independent review cross-checked the module's intermediates against Table 1 of Sharma, Wu & Dalal for ten pairs spanning every branch — all ten match to the published 4 decimal places |
| **Sharma, Wu & Dalal (2005)** — *The CIEDE2000 color-difference formula: Implementation notes, supplementary test data, and mathematical observations*, Color Research & Application 30(1), 21–30 | the **34 published verification pairs**, used as expected values in `src/test/colorMetrics.test.ts` with a citation | Fetched during implementation as the authors' own plain-text data file, from the University of Rochester host the authors link from their project page: `https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt`. These are published numeric test values, not code and not an asset; they are reproduced with attribution in the test file |
| **Paka's own sources** | `src/utils/color.ts` (`hexToRgb`, the `Rgb` type), the colour panel, the wheel, the toolbar's colour controls, the document model's paper colour | The repository itself |

**Web material actually opened:** the plain-text verification data file above.
A web search was also run to locate it; its result summaries named several
colour libraries and included a snippet from a `colorjs.io` test page. None
of those pages was opened, and no content from any of them entered the
implementation.

## What was not consulted

* `chroma.js`, in whole or in part (see the table above).
* Any other colour library, in whole or in part.
* Any tutorial, article, blog post, book chapter or conference talk about
  WCAG contrast or CIEDE2000. The one journal article consulted is the
  Sharma, Wu & Dalal paper named above, for its published verification data.
* No third-party artwork, font, texture, LUT or other asset.

## How that is evidenced

| Evidence | What it shows |
| --- | --- |
| `src/utils/colorMetrics.ts` | The module imports only Paka's own `src/utils/color.ts` — `hexToRgb` and the `Rgb` type. **No third-party import of any kind.** |
| The same file's header comment | Names the standards it implements and cites them (WCAG 2.2; CIE 142-2001 / ISO 11664-6), and states the module's own rules: it is pure and total, it knows nothing about CSS colour strings, and a colour that is not a hex colour never reaches the arithmetic. |
| `package.json`, `pnpm-lock.yaml` | Unchanged between the base commit and the slice commit. The slice adds **no** dependency, so no third-party code entered the tree by the dependency route either, and **no notice obligation arises**. |
| `licenses/dependency-inventory.json`, `THIRD_PARTY_NOTICES.md` | Unchanged for the same reason: the generated notices file still describes exactly the dependency set it described before the slice. |
| `grep -i "copyright\|SPDX\|adapted from\|ported from\|inspired by"` over the new files | No hits. The only occurrences of the word "chroma" in the new source are the CIELAB sense of *chroma* (colourfulness), not the library. No attribution, no reference, no copied constant. |
| `src/test/colorMetrics.test.ts` | The 34 verification pairs are attributed in the file's own comment to the Sharma, Wu & Dalal paper. The expected values are published data; the code that checks them is Paka's own. |
| The one binary file the slice adds | `tests/visual/visual.spec.ts-snapshots/contrast-readout-win32.png`, a screenshot of Paka's own renderer output (the palette's inks on white paper). It contains no third-party material. |

## The independent review's provenance finding

The independent review of this slice (`wave0/t13-independent-review.md` §6)
compared `src/utils/colorMetrics.ts` mechanically against `chroma.js`'s
`src/utils/contrast.js`, `src/utils/contrastAPCA.js`, `src/utils/delta-e.js`,
`src/ops/luminance.js` and `src/io/lab/rgb2lab.js`, and recorded:

> **Identifier overlap** — the only identifiers the module shares with
> chroma.js are single letters and `Math` members (`a`, `b`, `r`, `g`, `x`,
> `y`, `z`, `L`, `fx`, `fy`, `fz`, `rgb`, `atan2`, `sqrt`, `sin`, `cos`,
> `abs`, `exp`, `PI`). **Every distinctive chroma.js identifier is absent**
> from the module.
>
> **Code layout** — the longest common contiguous run of characters between
> any line of the module and any line of the five chroma.js files is **under
> 28 characters** in every case (measured on whitespace-normalised, comment-
> and string-stripped source). There is no shared function body.

The same section records that the two even **diverge numerically**: the
module's luminance breakpoint is `0.04045` where chroma.js's is `0.03928`;
the module's sRGB→XYZ matrix literals appear nowhere in chroma.js; the module
contains no APCA constants at all; it clamps only at `≥ 0` where chroma.js
clamps to `[0, 100]`; and it has four guards (`toChannel`, `toLabValue`, the
named `(6/29)³` breakpoint constants, and the explicit neutral-hue rule) with
no counterpart in chroma.js.

The review's own conclusion on provenance was:

> **Verdict: no. This is an independent Strategy-A implementation.**

and, on the reading history:

> **What I cannot verify, and must not be read as verified:** the
> implementer's report asserts "chroma.js was not consulted". That is a claim
> about reading history, which the gate itself says it cannot verify (§2.1:
> "the gate *cannot verify the implementer's reading history*, so the §2.5
> attestation is the implementer's obligation"). I verified the **artefact**,
> not the reading history. The §2.5 attestation (with the owner's R3
> countersignature) is **outstanding**.

This document is that implementer's obligation. It records the reading
history as the implementer states it; the review's evidence speaks to the
artefact.

## What this attestation is not

* It is **not** a claim that the gate can verify the implementer's reading
  history. A gate can only record what the implementing agents state and what
  the tree shows. The tree is consistent with the attestation; the attestation
  is the agents' own statement.
* It does **not** cover anything the **human owner** read. If the owner read
  a colour library, or worked from a tutorial derived from one, while
  directing or reviewing this work, the owner must say so in the
  countersignature below, and the implementation must be re-written by someone
  who has not read that source.
* It does **not** cover other features. It is scoped to
  `T-13-CONTRAST-READOUT` at the commits named above.
* It is **not** a waiver. The licence gate's outcomes stand: copying or
  adapting third-party code into Paka remains **BLOCKED**, and porting a
  third-party implementation remains **BLOCKED** regardless of this
  attestation.
* It is **not** a licence determination for the published standards and the
  published verification data the implementation was written from. It records
  what was read; the gate's decision for this candidate stands as recorded in
  `wave0/PROVENANCE-GATE.md` §2.1.

## Outstanding

The **repository owner** must countersign the statement below before the slice
is merged. The gate cannot do this on their behalf.

```
I confirm that, while directing or reviewing the T-13 contrast and
colour-difference readout work, I did not read, copy or consult chroma.js or
any other third-party colour library or reference implementation, and that no
part of this implementation is derived from one.

Name:      ______________________
Date:      ______________________
Signature: ______________________
```

If any part of that statement cannot be made truthfully, the implementation
must be re-written by someone who has not read the source named in the table
above, from the specification named above.

**A note for the owner, not a decision.** The gate's R3 entry
(`wave0/PROVENANCE-GATE.md`, "R3 — the clean-room countersignature") records
as a bookkeeping point that Strategy-A slices might be folded into the
existing `docs/CLEAN-ROOM-ATTESTATION.md` rather than given a second file.
That is the owner's choice. This record was written as a separate file, and
the stamp engine's attestation is **unmodified**.

---

_See `docs/g1/reuse-decision.md` §2.5 and `docs/g1/provenance-record.json` →
`cleanroom.implementerAttestation` for the gate's side of this record._
