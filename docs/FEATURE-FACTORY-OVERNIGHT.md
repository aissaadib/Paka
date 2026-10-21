# Feature factory — overnight work log

**Coordinator:** session 9 · **Started:** 2026-10-21 · **Repository:** `C:\Users\aissa\Desktop\Paka`

A living record of what was actually done, what was actually verified, and what
is still blocked. Branch and commit facts are measured, not carried over.

---

## 1. State at the start of this shift

| | |
| --- | --- |
| `main` | `ad2ef11` — untouched, never merged into, never pushed to |
| `feat/stamp-brush-engine` | `87593bc` — the development branch (12 commits ahead of the remote) |
| `feat/t13-contrast-dee` | `2d52647` — committed, reviewed PASS, **not merged** (blocked on an owner signature) |
| `feat/visual-regression-harness` | `c659079` — merged |
| `feat/t10-hsv-color-wheel` | `dbcb446` — merged |
| `chore/release-readiness` | `a9c67cb` — merged, branch and worktree kept |
| Clones | **8** creative repositories; Krita, GIMP, libmypaint, OpenToonz, Pencil2D and GEGL are **not present** |
| Checks | 554 tests / 31 files, typecheck clean, build ok, 15 visual scenes |

---

## 2. Work completed in this shift

### 2.1 Recovered orphaned work — `3c2df3f`

The licensing and dependency-inventory update had been **staged and
uncommitted** since the previous session; no such commit existed anywhere in
Git. It is now `3c2df3f` (parent `9b0a885`).

- The inventory now matches **both** lockfiles: **85** npm packages, **421**
  third-party crates.
- The three Playwright packages the visual harness added are recorded, with the
  licence and the copyright line read from the licence file each ships.
- The notices generator's Apache-2.0 obligation text was **corrected**: it
  claimed no Apache-2.0 dependency ships a `NOTICE` file, and the Playwright
  packages **do**. Their `NOTICE` content is now reproduced in the notices file
  as Apache-2.0 §4(d) requires.

### 2.2 Preserved four deliverables that existed only as untracked files

The T-11, T-13 and T-14 reports and the R6 / R9-R3 analyses were untracked
and one session from being lost. They are now committed:

| Deliverable | Where |
| --- | --- |
| `docs/t11-guides-discovery.md` | `docs/t11-guides-discovery` @ `283777b` |
| `docs/t13-contrast-dee-plan.md` | `docs/t13-contrast-dee-plan` @ `23d9992` |
| `docs/T-14-polygon-star-discovery.md` | `docs/t14-polygon-star-discovery` @ `4a08df9` |
| `docs/R6-PATENT-LICENSING-ANALYSIS.md`, `docs/RELEASE-READINESS-R9-R3-PLAN.md` | `feat/stamp-brush-engine` @ `108046f` |

### 2.3 T-10 — HSV colour wheel, integrated after a failed first review

The merge was clean, but the **independent review returned CHANGES REQUIRED**:

- **High** — the merge had broken the **Layers panel**. The new flex wrapper
  gave the panel a 271 px basis inside a fixed 216 px column, so the overflow
  clipped 55 px of it: **"Move layer up" and "Move layer down" had zero visible
  width and could not be clicked**.
- **Medium** — the disc's white overlay used `farthest-corner`, so the rim was
  still 29 % opaque and drew a washed colour instead of the pure hue.
- **Medium** — the wheel kept a stale hue when the colour was changed
  elsewhere and set back to the wheel's last written colour.

All three were fixed (`944ef4e`) and the **re-review returned PASS**: the
panel is back to 216 px with all five buttons at 1324–1432, the overlay follows
`alpha = 1 − r/R`, and the stale hue is gone. Merged as `3575020`.

The colour maths was verified **exactly** over all 16,777,216 sRGB colours.

### 2.4 T-13 — contrast and colour-difference readout, implemented natively

`2d52647` on `feat/t13-contrast-dee`. **WCAG 2.2** relative luminance and
**CIEDE2000**, written from the published standards with **no third-party
code** — the provenance gate's `NO-SOURCE` decision. It reproduces all 34 of the
Sharma–Wu–Dalal reference pairs.

- The readout follows the colour from the wheel, the sliders, the toolbar
  input, the swatches and the canvas picker.
- It adds **no** control, **no** state, **no** history entry and **no** dirty
  flag.
- An unreadable colour is reported as **unknown with the reason**, not a number.
- Independent review: **PASS**. Four low findings fixed and **re-confirmed**.

**Not merged, deliberately.** The slice needs a §2.5 clean-room record, which
now exists as `docs/CLEAN-ROOM-ATTESTATION-T13.md` (`b6337cb`, pushed). It
records that the implementer **never opened chroma.js**, so the first limb of the
§2.5 rule is satisfied on the face of the record. The **owner's countersignature
block is empty** and was left empty deliberately: signing is the owner's action
(R3) and no agent may do it.

### 2.5 T-14 — polygon and star shape tools, implemented after a failed first review

The first review returned **CHANGES REQUIRED** with a **major undeclared
defect**: the rotation option was not a rotation. The angle was folded into the
ellipse's *parameter* instead of turning the placed vertices, so on a
non-square box the shape **morphed** — side lengths changed — instead of turning
rigidly. The suite missed it because the rotation test used a **square** box,
where the two formulations coincide.

Fixed: the vertices are now placed on the ellipse and then turned rigidly
about the box centre, and the outline is closed after the turn. Three false
documentation statements were corrected (the rotated shape's box, the polygon's
own box for each `n mod 4`, and the star's ellipse rule, which the reader-facing
documents never mentioned). Six tests were added, each verified to fail under
the old behaviour. The **re-review returned PASS**.

### 2.6 T-14 — polygon and star shape tools, implemented after a failed first review

The first review returned **CHANGES REQUIRED** with a **major undeclared
defect**: the rotation option was not a rotation. The angle was folded into the
ellipse's *parameter* instead of turning the placed vertices, so on a
non-square box the shape **morphed** — side lengths changed — instead of turning
rigidly. The suite missed it because the rotation test used a **square** box,
where the two formulations coincide.

Fixed: the vertices are now placed on the ellipse and then turned rigidly
about the box centre, and the outline is closed after the turn. Three false
documentation statements were corrected (the rotated shape's box, the polygon's
own box for each `n mod 4`, and the star's ellipse rule, which the reader-facing
documents never mentioned). Six tests were added, each verified to fail under
the old behaviour — including the rotation test, which was moved to **45°**
because 90° is the one angle the buggy code also satisfied. The **re-review
returned PASS**.

- `958bb96` on `feat/t14-polygon-star`, merged as `0946f2a`, **pushed**.
- A polygon is a regular *n*-gon (3–24) inscribed in the box's **ellipse**; a
  star is the classic **2p-vertex** outline, not a pentagram. Both are ordinary
  strokes: **no new element kind, no new command, no format change**.

### 2.7 T-11 — composition guides, implemented after a failed first review

The first review returned **CHANGES REQUIRED**: the behaviour was correct, but
the repository asserted wrong things about itself — a stale test count, **29
wrong `AGENTS.md` anchors**, and an **undocumented 3 CSS px axis threshold** with
its user-visible consequence (a shorter drag creates nothing at all). Two real
robustness issues also surfaced:

- a guide gesture cancelled by the engine left the **tool** believing a drag was
  still in flight;
- a **save taken during a drag** wrote the preview and then marked the file
  clean, so a later cancel left the file on disk different from the document
  with **no dirty flag** — the same hazard the settings/autosave discovery
  flagged for autosave.

All seven findings and two coverage gaps were fixed, with seven new tests each
**proven to fail without the fix**.

- `286d008` on `feat/t11-guides`, merged as `246ead6`, **pushed**.
- A **Guides** tool (`U`): drag to place, drag to move, click to select,
  `Delete` to remove, `Esc` to cancel. Guides are **document state** but
  **display-only** — never in the exported picture — so the format change is
  **additive** and `PROJECT_VERSION` **stays 9**.

### 2.8 Discovery and gate deliverables, committed to the repository

`87593bc` — `docs/FEATURE-FACTORY-STATE.md` (the state report),
`docs/FEATURE-FACTORY-MATRIX.md` (**60** deduplicated capability rows, each with
source, licence, provenance class, evidence, acceptance criteria and status) and
`docs/FEATURE-FACTORY-PROVENANCE.md` (the per-candidate licence gate).

**ID namespaces** were separated: `FF-nn` for feature rows, `AT-nn` for the
historical analyst test ids, `TASK-nn` for implementation tasks. No historical
artefact was renamed.

---

## 3. Branch and push state

| Branch | Local | Remote | Pushed |
| --- | --- | --- | --- |
| `feat/stamp-brush-engine` | `87593bc` | `87593bc` | **yes** |
| `feat/t13-contrast-dee` | `b6337cb` | `b6337cb` | **yes** |
| `feat/t14-polygon-star` | (uncommitted) | — | no, pending review |
| `main` | `ad2ef11` | `ad2ef11` | untouched |

---

## 4. Blockers — recorded, not worked around

| # | Blocker | Owner | Effect |
| --- | --- | --- | --- |
| 1 | **R3 — the clean-room countersignature** | the owner | T-13 cannot be merged until it is signed. The process record exists; the signature does not, and no agent may create one. |
| 2 | **R6 — the patent-grant position** | the owner or counsel | Paka's `LICENSE` is unchanged. `docs/R6-PATENT-LICENSING-ANALYSIS.md` is analysis only. |
| 3 | **R9 — the CI licence allow-list** | the owner | No `.github/` directory exists. `docs/RELEASE-READINESS-R9-R3-PLAN.md` is a plan. |
| 4 | **D-1 — the font-identity policy** | the owner | Blocks the text tool. No upstream library settles it. |
| 5 | **T-11 decision P1** (are guides exported?) | the coordinator's recommendation is recorded, but it is a product choice | Taken as **display-only, no export, no version bump**, matching the selection overlay. Reversible. |
| 6 | **T-06's autosave policy** | the owner | The discovery identified a real hazard: autosave must not call `markSaved`, or the app would believe the user's chosen project file was saved. |

---

## 5. What is not done

- **T-11 guides** and **T-06 settings/autosave** are **discovery only**.
- The **text tool** is blocked on D-1.
- **Animation** is unstarted; no source in the cloned set provides a timeline.
- The **packaged Tauri app** has still never been run against the current
  tree. Every browser result in this log is a **browser** result, and is
  labelled as one.
- **No React-layer test framework** exists, by the project's own rule.
