# Feature factory state

**Verified:** 2026-10-21 · **Coordinator:** session 9 (integration coordinator) ·
**Repository:** `C:\Users\aissa\Desktop\Paka` · **Remote:** `https://github.com/aissaadib/Paka.git`

This is the **state report**, not a plan. Every number here was measured in
the real worktrees; nothing is carried over from a previous report without
being re-checked. It replaces the per-session handoffs, which described
intent rather than state.

---

## 1. The branches and where they are

| Branch | HEAD | Upstream | Worktree | Notes |
| --- | --- | --- | --- | --- |
| `main` | `ad2ef11` | `origin/main` = `ad2ef11` | `Desktop/Paka` (not checked out here) | **untouched**; never merged into, never pushed to |
| `feat/stamp-brush-engine` | `3575020` | `origin/feat/stamp-brush-engine` = `650194e` (**3 ahead, not pushed**) | `Desktop/Paka` | the development branch |
| `feat/visual-regression-harness` | `c659079` | none | `Paka-feature-factory/worktrees/t01-visual-regression` | T-01 visual harness; **merged** into the development branch, branch kept |
| `feat/t10-hsv-color-wheel` | `dbcb446` | none | `Paka-feature-factory/worktrees/t10-hsv-color-wheel` | T-10 colour wheel; **merged**, branch kept |
| `feat/t13-contrast-dee` | `3575020` (uncommitted work) | none | `Paka-feature-factory/worktrees/t13-contrast-dee` | T-13 contrast/ΔE; **implemented, reviewed PASS, not yet committed** |
| `chore/release-readiness` | `a9c67cb` | none | `Desktop/Paka-release-readiness` | **intact and clean**; merged, branch and worktree kept |
| `chore/t06-discovery` | `43e8a57` | none | `Paka-feature-factory/worktrees/t06-settings-autosave` | discovery only |
| `docs/t11-guides-discovery` | `283777b` | none | `~/.local/share/opencode/worktree/252257/t11-guides-discovery` | report, committed |
| `docs/t13-contrast-dee-plan` | `23d9992` | none | `~/.local/share/opencode/worktree/252257/t13-contrast-dee` | plan, committed |
| `docs/t14-polygon-star-discovery` | `4a08df9` | none | `%TEMP%/opencode/paka-t14-discovery` | report, committed |
| `integration/t10-hsv-color-wheel` | `944ef4e` | none | `Paka-feature-factory/worktrees/integration-t10` | the reviewed T-10 integration; **merged**, branch kept |

**Eight worktrees** are registered. None is a Paka source checkout that another
agent owns an uncommitted change in.

### Ancestry of the development branch

```
3575020  Merge the T-10 HSV colour wheel into the development branch
944ef4e  fix: repair the review findings on the HSV colour wheel
bc062c7  Merge branch 'feat/t10-hsv-color-wheel' into the development branch
dbcb446  feat: add the HSV colour wheel          <- the T-10 feature commit
108046f  docs: add the R6 patent-licensing analysis and the R9/R3 plan
3c2df3f  chore: record the Playwright packages in the dependency inventory
9b0a885  Merge branch 'feat/visual-regression-harness' into feat/stamp-brush-engine
47e309f  chore: make docs/g1/ the canonical provenance record, and cross-link it
a897b76  Merge branch 'chore/release-readiness' into feat/stamp-brush-engine
650194e  docs: retract the audit's timing claims, which measured the read-back sync
9b2aceb  feat: add the stamp (dab) brush engine behind the stroke interface
ad2ef11  docs: clarify how to measure frames in the packaged app
```

Both source branches (`dbcb446`, `c659079`, `a9c67cb`) are ancestors of the
development tip. **No history was rewritten, no rebase was used, and nothing
was force-pushed.**

---

## 2. The working-tree state, worktree by worktree

| Worktree | staged | unstaged | untracked | owner |
| --- | --- | --- | --- | --- |
| `Desktop/Paka` | 0 | **1** (`skills-lock.json`) | 13 | the user's own files and the pipeline scratch |
| `Paka-feature-factory/worktrees/t13-contrast-dee` | 0 | 10 | 6 | the T-13 implementer |
| `Paka-feature-factory/worktrees/integration-t10` | 0 | 0 | 0 | clean |
| `Paka-feature-factory/worktrees/t10-hsv-color-wheel` | 0 | 0 | 0 | clean |
| `Paka-feature-factory/worktrees/t01-visual-regression` | 0 | 0 | 0 | clean |
| `Paka-feature-factory/worktrees/t06-settings-autosave` | 0 | 0 | 0 | clean |
| `Desktop/Paka-release-readiness` | 0 | 0 | 0 | clean |
| the three `docs/*-discovery` worktrees | 0 | 0 | 0 | clean |

**Protected and preserved in `Desktop/Paka`:** `skills-lock.json` (the user's
own modification, still unstaged), `.agents/skills/**` (9 directories),
`.opencode/**` (agent definitions, including `paka-coordinator.md`), `qa/`
(the disposable QA harness), and the four pipeline scratch files
(`final-audit.md`, `follow-up-handoff.md`, `follow-up-verification.md`,
`stamp-final-verification.md`). **None of these is in any commit.**

**Deliverables that existed only as untracked files have been committed**, so
they can no longer be lost:

| Deliverable | Now at |
| --- | --- |
| `docs/t11-guides-discovery.md` | `docs/t11-guides-discovery` @ `283777b` |
| `docs/t13-contrast-dee-plan.md` | `docs/t13-contrast-dee-plan` @ `23d9992` |
| `docs/T-14-polygon-star-discovery.md` | `docs/t14-polygon-star-discovery` @ `4a08df9` |
| `docs/R6-PATENT-LICENSING-ANALYSIS.md` | `feat/stamp-brush-engine` @ `108046f` |
| `docs/RELEASE-READINESS-R9-R3-PLAN.md` | `feat/stamp-brush-engine` @ `108046f` |

---

## 3. The clone inventory — eight, and only eight

A filesystem sweep of `Desktop`, `Downloads`, `Documents`, `%TEMP%\opencode`
and `~/.local/share/opencode` found **eight** creative-application
repositories, all under `Paka-feature-factory/sources/`. Each licence below
was read from the clone's own licence file.

| Clone | Project | Revision | Licence | Read from | Worktree form |
| --- | --- | --- | --- | --- | --- |
| `chroma.js` | chroma.js | `14e2b8a` | **BSD-3-Clause** (plus Apache-2.0 for the bundled ColorBrewer data) | `LICENSE` | full |
| `fabric.js` | Fabric.js | `4748495` | MIT | `git show HEAD:LICENSE` | **sparse** - 2 of 10 packages |
| `gifenc` | gifenc | `27db5b9` | MIT | `LICENSE.md` | full |
| `opentype.js` | opentype.js | `5d65b6d` | MIT (code) | `LICENSE` | full |
| `perfect-freehand` | perfect-freehand | `176e00f` | MIT | `LICENSE` | full |
| `react-colorful` | react-colorful | `8506e8c` | MIT | `LICENSE` | full |
| `svg-path-editor` | svg-path-editor | `937d75a` | Apache-2.0 | `LICENSE` | full |
| `tauri-apps-plugins-workspace` | Tauri plugins (31) | `11211c3` | MIT OR Apache-2.0 | `LICENSE_MIT` | **sparse** - 1 of 31 plugins |

Two of these are **sparse-checkout** clones: `fabric.js` holds only
`packages/core` and `packages/node` in its worktree, and the Tauri workspace
holds only `plugins/store`. Both are read from the **git object database**;
the sparse filter was never changed. An earlier reading that reported "no
licence file" for the Tauri workspace was a **sparse artefact**, not a real
absence.

**Excluded, with the reason:** `Desktop/HS-Maths` (a maths exercise repo),
`Desktop/Upward` (a career-guidance web app) and `Desktop/cs50/libcs50`
(a C teaching library) - none is a creative application.

**Not present.** A previous handoff named Krita, GIMP, libmypaint, OpenToonz,
Pencil2D and GEGL as likely clones. **They are not on this machine.** They
are recorded as absent rather than given invented inventory rows.

---

## 4. Dependency inventory

| | count |
| --- | --- |
| npm packages in `pnpm-lock.yaml` | **85** |
| npm packages in `licenses/dependency-inventory.json` | **85** |
| third-party crates in `src-tauri/Cargo.lock` | **421** |
| crates in `licenses/dependency-inventory.json` | **421** |
| licence texts shipped in `licenses/` | 10 |

The inventory **matches both lockfiles**. The three Playwright packages that
the T-01 harness added were added to the inventory and the notices file was
regenerated from it; the generator's Apache-2.0 obligation text was corrected
because Playwright **does** ship a `NOTICE` file, and its content is now
reproduced in the notices file as Apache-2.0 §4(d) requires.

---

## 5. The checks, on the current integration candidate

`feat/stamp-brush-engine` @ `3575020`, in `Desktop/Paka`:

| Check | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm test` | **554 tests / 31 files, all pass** (2.01 s) |
| `pnpm typecheck` | exit 0, clean |
| `pnpm build` | exit 0, 107 modules |
| `pnpm test:visual` | **15 passed** |

`feat/t13-contrast-dee` (uncommitted) measured by the implementer and by the
independent reviewer: **589 tests / 32 files**, typecheck clean, build ok,
**16 visual scenes**.

---

## 6. What is still open

| # | Item | State |
| --- | --- | --- |
| 1 | **R6 - the patent-grant position** | **OPEN, the owner's or counsel's decision.** `docs/R6-PATENT-LICENSING-ANALYSIS.md` is analysis only. Paka's `LICENSE` is unchanged. |
| 2 | **R9 - the CI licence allow-list** | **OPEN.** `docs/RELEASE-READINESS-R9-R3-PLAN.md` is a plan. No `.github/` directory exists. |
| 3 | **R3 - the clean-room countersignature** | **OPEN.** `docs/CLEAN-ROOM-ATTESTATION.md` covers the stamp engine only. **T-13 now needs its own §2.5 attestation, and its review is blocked on that.** No signature has been written, edited or simulated by any agent. |
| 4 | **D-1 - the font-identity policy** | **OPEN.** It blocks the text tool (FF-38/FF-39) and no upstream code settles it. |
| 5 | T-06, T-11, T-14 | **Discovery only.** Each has a committed report; none is implemented. |
| 6 | The T-10 review's **D4-D8** | Open, all Low. They cannot dirty a document or change a committed stroke. |
| 7 | The T-10 integration and the T-13 slice | **Not pushed.** |

**No readiness item has been marked resolved without the evidence for it.**

---

## 7. The state of this work, honestly

- The **development branch is green** and carries the stamp engine, the
  release-readiness work, the visual harness and the colour wheel.
- The colour wheel went through **two independent reviews**: the first
  returned **CHANGES REQUIRED** with a High-severity layout regression that the
  merge had introduced, and the re-review confirmed all three defects fixed.
  The colour wheel's own maths was verified **exactly** over all 16,777,216
  sRGB colours.
- The contrast readout was implemented natively from the **published
  standards**, reviewed **PASS**, and its four low findings fixed.
- What is **not** done: T-06, T-11 and T-14 are still plans, the text tool
  is blocked on a policy, animation is unstarted, and three release-readiness
  decisions belong to the owner.
