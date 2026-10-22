# Wave 3 — the ledger

**Coordinator:** night shift · **Base:** `ad2a5f3` (the repaired wave-2 tip)
**Wave branch:** `integration/wave-3-shell` · **Code tip:** `5a5262a`
**Ledger tip:** the commit that carries this file, one commit above the code
tip · **Shared checkout `D:/Dev/Paka`: not touched by this wave.**

Every builder had its own worktree, its own branch and its own file
ownership. No builder edited another builder's worktree, and the shared
checkout was never written to.

The worktrees are `D:/Dev/Paka-overnight-worktrees/Axx-...`, one per
builder, each with its **own real `node_modules`** (not a junction), so a
concurrent install elsewhere on the machine cannot break a builder's checks.

---

## 1. The base, and why it is not `origin/main`

`origin/main` (`74023e9`) and `origin/integration/swarm-wave-2` (`8fe02cc`)
have **identical trees**, and both are broken. The wave-2 merge resolved the
`PROJECT_VERSION` conflict by keeping *both* sides, so
`src/core/project/projectFormat.ts` declared the constant twice, and the same
merge duplicated a line in `src/test/projectFormat.test.ts` and left the test
block unbalanced. **The tree did not compile, and the suite did not parse.**

Six builders independently made the same repair, on six branches:
`1f212c2`, `8a2e027`, `0168c52`, `c846821`, `5a11ccb`, `99c0bf0`. Their
trees are byte-identical. The wave base carries **one** copy of that repair,
as `ad2a5f3`, and the other five were not integrated.

The base is therefore:

```
8fe02cc  origin/integration/swarm-wave-2   (the broken merge)
   |
ad2a5f3  fix(project): repair the merged format version constant and its test
   |
9baec0d  feat(shell): the eight shared contracts   <- the spine
8d8ee8b  docs(qa): this ledger
69d2c55  fix(shell): drop the unused import the viewport state no longer uses
d340911  merge(A08) ... 29 merges ...  5e58089  fix(shell): one colour dock
5a5262a  feat(symmetry): the mirror axes             <- A13, integrated by hand
```

`main` was never touched and nothing was pushed.

---

## 2. The shared contracts

Eight modules, one commit (`9baec0d`), 116 tests. They exist so that two
builders never have to edit the same file to add a panel, an option, an
overlay or a preference.

| Module | What it owns |
| --- | --- |
| `src/core/shell/slots.ts` | the closed set of shell slots and the layout rules |
| `src/core/shell/panelRegistry.ts` | the list of panels the shell may show |
| `src/core/shell/viewportState.ts` | the viewport that survives a resize or a restart |
| `src/core/shell/overlayRegistry.ts` | the things drawn over the canvas |
| `src/core/shell/historyModel.ts` | the shell's read-only view of the undo stack |
| `src/core/shell/preferences.ts` | the shell's own preferences |
| `src/core/shell/toolOptions.ts` | the tool-option contract and its per-tool registry |
| `src/core/brushes/dynamics.ts` | speed and taper as a dynamics layer |

**The spine had a defect and the serial type check found it.** `9baec0d` did
not compile: `viewportState.ts` imported `centerOn` and never used it, and
the project's `noUnusedLocals` turns that into an error. Every contract test
passed, because vitest does not type check. The repair is `69d2c55`, and it
was applied to all thirty worktrees so no builder was blocked by it.

---

## 3. The builders

| # | Task | Branch | Builder's commit | Status |
| --- | --- | --- | --- | --- |
| A01 | the shell's composition | `feat/wave3/A01-workspace-shell` | `162c61e` | integrated, `6f77812` |
| A02 | the options bar | `feat/wave3/A02-tool-options-bar` | `9b89ab9` | integrated, `c999779` |
| A03 | the toolbox | `feat/wave3/A03-toolbox` | `4f0ca52` | integrated, `166afa4` |
| A04 | the brush properties | `feat/wave3/A04-brush-properties` | `4a3e89b` | integrated, `0656d5b` |
| A05 | the brush size gesture | `feat/wave3/A05-brush-size-gesture` | `59c4df4` | integrated, `0360b3d` |
| A06 | the preset browser | `feat/wave3/A06-preset-browser` | `4579ef2` | integrated, `350e460` |
| A07 | the colour dock | `feat/wave3/A07-color-dock` | `37586cc` | integrated, `8412d67` |
| A08 | the layers panel | `feat/wave3/A08-layer-panel` | `b79dbd8` | integrated, `d340911` + `ee69449` |
| A09 | the view navigation | `feat/wave3/A09-view-navigation` | `d406091` | integrated, `26aba0e` |
| A10 | the brush cursor and the preview | `feat/wave3/A10-brush-cursor` | `7bea38e` | integrated, `7dc73b1` |
| A11 | the panel manager | `feat/wave3/A11-panel-manager` | `427382b` | integrated, `c1faad2` |
| A12 | the pressure dynamics | `feat/wave3/A12-pressure-dynamics` | `6770399` | integrated, `f6a3500` |
| A13 | the symmetry | `feat/wave3/A13-symmetry` | `d55cbbd` | **integrated by the coordinator**, `5a5262a` + `e7a1e2c` |
| A14 | the brush tips | `feat/wave3/A14-brush-tips` | `e908861` | integrated, `6788535` |
| A15 | the shape tools | `feat/wave3/A15-shape-tools` | `6e01fe3` | integrated, `3970692` |
| A16 | the selection modes | `feat/wave3/A16-selection-modes` | `281a9b1` | integrated, `ab2e144` |
| A17 | the transform handles | `feat/wave3/A17-transform-handles` | `5a7a9b9` | integrated, `340803f` |
| A18 | the reference images | `feat/wave3/A18-reference-images` | `0e0ccbd` | integrated, `03a46e8` |
| A19 | the rulers | `feat/wave3/A19-rulers` | `0ee3665` | integrated, `224d09a` |
| A20 | the bucket's options | `feat/wave3/A20-fill-options` | `78fb26c` | integrated, `66b2ffc` |
| A21 | the gradient editing | `feat/wave3/A21-gradient-editing` | `c144267` | integrated, `b1c7b14` |
| A22 | the settings document's sections | `feat/wave3/A22-settings-sections` | `00e156e` | integrated, `efe7901` |
| A23 | the shortcut editor | `feat/wave3/A23-shortcut-editor` | `e04ca07` | integrated, `4d0b6c5` |
| A24 | the workspace profiles | `feat/wave3/A24-workspace-profiles` | `9379489` | integrated, `0f37930` |
| A25 | the menu bar's keyboard rules | `feat/wave3/A25-menu-navigation` | `34681a3` | integrated, `3fa8d1f` |
| A26 | the layer groups | `feat/wave3/A26-layer-groups` | `a28ca6a` | integrated, `b379565` |
| A27 | the bundled presets | `feat/wave3/A27-bundled-presets` | `1283a56` | integrated, `f6a24c4` |
| A28 | the panel layout's persisted state | `feat/wave3/A28-panel-layout-state` | `9ea1753` | integrated, `aaca09b` |
| A29 | the pointer ownership | `feat/wave3/A29-pointer-ownership` | `d552088` | integrated, `3ba5f7a` |

**A13** is the one that did not report in time: its worktree held three
complete, tested files that were never committed, so the coordinator took
them over, verified them and committed them as `5a5262a`. A13 then
committed its own slice, `d55cbbd`. Two of the three files are **identical**
to what the coordinator integrated; the third, the overlay, differs by one
paragraph of documentation, and A13's final version is the one now in the
tree (`e7a1e2c`). A13's own branch is kept.

Every builder's branch is kept. Nothing was rebased, reset or force-pushed,
and `main` was never merged into.

---

## 4. The conflicts the integration had to settle

Every one of these was found by the integration, not by a builder.

| # | Conflict | How it was settled |
| --- | --- | --- |
| 1 | **`AGENTS.md`** — A02, A17 and others edited the repository map | both sides' rows kept; the map is an index, not a document with one author |
| 2 | **`core/panels/panelLayoutSection.ts`** — A11 and A28 both wrote it | A28's kept: it carries the full persisted layout (shown, ordered, slotted, folded). A11's live layout was kept beside it, and a new module, `core/panels/panelLayoutBridge.ts`, is the meeting point between the two shapes. A11's test was rewritten against the reconciled API. |
| 3 | **`core/brushes/defaults.ts`** — A04 and A14 both edited the import block | both imports kept |
| 4 | **`features/brushes/BrushControls.tsx`** — A04 and A10 | both imports kept; the property model and the preview swatch |
| 5 | **`projectFormat.ts`, `projectFormat.test.ts`, `PROJECT_FORMAT.md`** — A14 and A26 both bumped the format to 13 | both rationales kept. Version 13 carries two changes now: the brush's `tip` and the layer `kind`/`children`. The version table row was rewritten to cover both. |
| 6 | **`test/presetBrowser.test.ts`** — A06's brush literal, A14's new `tip` field | the literal gained `tip: "chisel"` |
| 7 | **`test/navigator.test.ts`** — A09's layer literal, A26's `Layer.kind`/`children` | the literal gained `kind` and `children` |
| 8 | **`test/pressureCurve.test.ts`** — pinned the format at 12 | the version pin lives once, in `projectFormat.test.ts`; this test now follows `PROJECT_VERSION` and asserts the curve survives the round trip |
| 9 | **the colour dock was rendered twice** | found by the visual suite, not by a builder. The dock registered itself as `"colour"` while the shell registered it as `"color"`, so the side column held two of them. The id is now `"color"` — one id, one spelling, the one the panel manager's catalogue already used — and the shell's registrations became fallbacks, so a panel that registers itself keeps its own registration. |

---

## 5. The verification, measured on the integrated tip

Run **serially**, one command at a time, against `5a5262a`:

| Check | Command | Result |
| --- | --- | --- |
| Types | `pnpm exec tsc -p tsconfig.json --noEmit` | **exit 0, clean** |
| Unit + integration | `pnpm test` | **2169 tests in 85 files, all pass** (5.0 s) |
| Production build | `pnpm build` | **succeeded** — 176 modules, `index-COzz_taS.js` 460.03 kB (gzip 139.09 kB) |
| Visual regression | `pnpm test:visual` | **45 passed** (26.8 s) |

The visual suite's dev server runs on a fixed port, 1422, which the
concurrent swarm had a dev server on. The run above used a private config
on port 1699 for that reason, and it is the same suite with the same
harness; the port is the only difference, and the port is not the
configuration.

The baseline on the repaired base, before the wave, was **1158 tests in 56
files**. The wave adds **1011 tests in 29 files** and **182 files changed
(+38,757 / −1,066)**.

No test was run concurrently with the Rust build. The Rust tree is unchanged
by this wave, so `cargo check --lib` was not re-run; it was clean on the base.

---

## 6. The concurrent swarm in the shared checkout

This is the most important thing in the ledger, because it is **not** this
wave's work and it must not be lost.

While this wave was running, a **second swarm** was working in the shared
checkout `D:/Dev/Paka`. It is visible in the reflog: the checkout moved
between `feat/agent01-workspace-shell`, `feat/agent02-tool-options-bar`,
`feat/agent03-toolbox`, `feat/agent04-panel-manager`,
`feat/agent06-preset-browser`, `feat/agent07-color-dock`,
`feat/agent08-layer-panel`, `feat/agent09-view-navigation` and
`feat/agent09-status-zoom-view`, and sixteen of those branches now carry
commits.

What is true about it, measured:

- It worked **in the shared checkout**, switching branches under itself. At
  one point it had 149 changed entries in one working tree, mixing every
  agent's work. That work was preserved twice, as byte-exact copies, in
  `D:/Dev/Paka-overnight-worktrees/preserve/shared-checkout-0123/src` (246
  files) and `.../shared-checkout-0132/src` (271 files).
- It **self-repaired** the broken base: its branches carry the same repair
  commit the wave-2 merge needed (`8a2e027`, `5a11ccb`, `65f96d9`, …).
- It **adopted two of this wave's contract modules byte-identically**:
  `src/core/shell/slots.ts` and `src/core/shell/panelRegistry.ts`, together
  with their two test files. The other six were not adopted.
- It built **many of the same features**, on its own branches and with its
  own designs: the panel manager, the brush tips, the layer groups, the
  toolbox, the shortcut editor, the pointer ownership, the colour dock, the
  brush cursor. It also built things this wave did not: a stroke taper, a
  fill rewrite, a per-dab texture profile, layer locking, folders, and
  multi-document tabs.
- Its `src/core/workspace/workspaceProfiles.ts` is a **different concept at
  the same path** as A24's: its preset profiles (theme, ui scale, brush
  density) rather than a user-saved named shell layout. A24 flagged this and
  it is a real collision to settle.
- Its `src/core/document/symmetry.ts` is a **different API at the same
  path** as A13's: centre-based, with a "radial" mode and the symbols
  `symmetryTransforms`, `createSymmetryCopies`, `symmetryAxes` and
  `isOnSymmetryCenter`. A13's model is axis-based - each axis carries its
  own position and the mirror is about the axis, not about the document's
  centre - and A13 flagged the difference itself. A13's brief was the
  axis-based model, and the axis-based model is the one that matches the
  composition guides' "one number, not a point" rule; the reconciliation
  still has to be deliberate.
- `src/core/brushes/stabilizer.ts` exists in both. A05 wrote a faithful
  description of the code as it is; the captured reference in the shared
  checkout is a **redesign** (three modes, an adaptive filter, a four-point
  catch-up curve) that disagrees with `strokeBuilder.ts` in four places.
  A05 kept the model matching the code. That is the right call, and the
  redesign needs a format bump and is not merged.

**Nothing from the concurrent swarm was integrated into this wave**, and
nothing from this wave was pushed. The two sets of work are both real and
they overlap; reconciling them is a decision for whoever owns the shared
checkout, and the reconciliation has to be deliberate: same path, different
concept, in at least two places.

### Two incidents worth recording

1. **`git stash` is shared by every worktree of a repository.** A01's
   `git stash pop` popped **A15's** stash, not its own, and dropped A15's
   files into A01's worktree. A15 recovered them by rewriting the slice, and
   A01 removed them from its own commit. A15's stash objects are
   `ce5ffb8d` (the stash), `4236d4c` (its untracked files) and `e11a970`
   (its index). **Nobody should use `git stash` in a worktree here.**
2. **The shared `node_modules` is a single point of failure.** A concurrent
   `pnpm install` in the shared checkout emptied its `.bin`, and every one of
   the thirty worktrees failed to find `tsc` and `vitest` for several
   minutes. All thirty now have their **own real install** (2.4 s each from
   the warm store), so the wave does not depend on the shared one.

---

## 6a. The concurrent swarm, measured

The section above records what the concurrent swarm *was*. This section
records what it *is*, measured.

**It stopped.** Its last commit is `3f9072b` at 02:48 and its last write to
`src/` is 02:53. It has been idle since. It left the shared checkout on
`feat/agent04-panel-manager` with **75 changed entries uncommitted**.

**Its committed integration branch does not compile.**
`feat/agent04-panel-manager` at `3f9072b` is the swarm's integration branch:
61 new files, absorbing every agent's work, including **two of this wave's
contract modules byte-identically** (`src/core/shell/slots.ts` and
`src/core/shell/panelRegistry.ts`).

With the broken wave-2 merge repaired, that branch has **101 type errors**,
spread across the engine (23), the preset browser's test (20), the preset
browser (6), the tool-option schema (6), the shell (5), the status bar (5),
the preset row (5) and the renderer (4). It is broken in many places, not in
one.

**Its five repair commits are on individual branches, and none of them is in
its own integration branch**: `8a2e027`, `5a11ccb`, `65f96d9`, `6c4bc3a` and
`a988000` are all *not* ancestors of `3f9072b`. The repair the swarm made
four times over never reached the branch it was making.

**Its working tree typechecks clean — 0 errors.** And the two states are
**incompatible with each other**: restoring the working tree's missing files
into the branch *raised* the error count from 101 to 113, because the tree is
from a later point in time and expects a newer preset model (`favorite`,
`lastUsedAt`, `builtin`) than the branch carries. The swarm never converged:
its branch and its tree are two different designs.

### The working tree is now preserved, without touching the checkout

The converged working tree was taken with a **throwaway index** — a
temporary `GIT_INDEX_FILE`, a `write-tree` and a `commit-tree` — so the
shared checkout's own index, HEAD and files were **not** modified. The
result is a branch:

| | |
| --- | --- |
| `preserve/swarm-working-tree` | `0f47ea6` |
| Content | 84 files, +10,709 / −372 |
| Type check | **0 errors** from a clean checkout |
| `qa/` | **not in the commit** (0 entries) |
| `package-lock.json` | not in the commit |

This is a **preservation record, not a merge**. Nothing in it has been
reviewed or integrated by this wave, and it is not on the wave branch. It
exists so that five hours of eighteen agents' work is recoverable as one
green commit instead of 75 uncommitted entries in a checkout anybody could
clobber.

### What the swarm has that this wave does not

Its unique capability, measured from the preserved tree:

- **Multi-document tabs** — `core/documents/sessionRegistry.ts`,
  `documentWorkspace.ts`, `recentFiles.ts`, `features/tabs/DocumentTabs.tsx`.
  One engine per document, the tab strip, the close decision, the recent
  list. This wave has nothing like it.
- **A colour history and a palette manager** — `core/color/history.ts`,
  `palette.ts`, `PalettePanel`, `RecentColors`.
- **A polyline tool** — `core/tools/polylineTool.ts`, with three visual
  scenes.
- **A stroke taper** — `core/brushes/taper.ts`, `core/rendering/taperStroke.ts`.
- **A layer tree with locking** — `core/document/layerTree.ts`,
  `core/commands/groupCommand.ts`.
- **A per-dab texture profile** (its agent14 branch), **the shortcut bindings
  with suspension** (`core/actions/suspension.ts`, `bindingStore.ts`), and
  **a display scale** (`core/rendering/displayScale.ts`).

So the two waves are **not** in competition: they overlap on the panel
manager, the brush tips, the layer groups, the toolbox, the shortcut editor,
the pointer ownership, the colour dock, the brush cursor and the symmetry, and
they are **complementary** on the tabs, the palettes, the polyline, the taper,
the layer locking and the texture profile.

**Two paths carry a different API on each side**, and that is where a merge
would hurt: `src/core/workspace/workspaceProfiles.ts` (its preset profiles —
theme, ui scale, brush density — against this wave's named shell layouts) and
`src/core/document/symmetry.ts` (its centre-based model with a "radial" mode
against this wave's axis-based model, where the mirror is about the axis and
not about the document's centre).

**The recommendation is a merge, in that order**: take the swarm's unique
capability (the tabs, the palettes, the polyline, the taper) and this wave's
contracts and discipline, and reconcile the two colliding paths by hand. Both
trees are green once their own repair is applied, so neither side has to be
discarded. That is the owner's decision, and this wave has left both sides
whole.

---

## 6b. Wave 4 — the follow-up ladder

Wave 3 is integrated and green, and every wave-3 builder named the next rung
of its own ladder. Those rungs are wave 4: 29 tasks, one per builder, each
the concrete follow-up its builder wrote down.

| | |
| --- | --- |
| Task table | `D:/Dev/Paka-overnight-worktrees/wave4-tasks.ps1` |
| Base | `629e168` — the wave-3 tip |
| Worktrees | `D:/Dev/Paka-overnight-worktrees/Bxx-...`, 29 of them, each with its own real install |
| Branches | `feat/wave4/Bxx-...` |
| Brief | `D:/Dev/Paka-overnight-worktrees/BUILDER-BRIEF.md` |

The first dispatch of 20 builders was **cancelled before any of them wrote a
line** — every Bxx worktree is still clean and every Bxx branch is still at
the base. Nothing was lost. The wave was then resumed in smaller batches,
the first of which is the eight builders whose slices touch no engine method
at all: B29, B22, B21, B11, B12, B17, B18 and B20.

The engine lane (B01, B02, B03, B04, B05, B06, B07, B08, B13, B14, B15, B16,
B23, B25 and B28) all edit `src/core/engine/DrawingEngine.ts` or
`src/core/rendering/Canvas2DRenderer.ts`. They run in parallel in their own
worktrees, and they are **merged one builder at a time**, in the order the
ledger's integration table gives.

---

The mission's hard requirement.

- `qa/` was **never staged, never overwritten, never moved and never
  deleted.** `git ls-files qa/` is empty; `git status --porcelain -- qa/`
  still says `?? qa/`.
- The 27 files are the same 27 files that were there when the shift started,
  and the five whose hashes were recorded at the start are **byte-for-byte
  unchanged**.

---

## 8. What is deferred, and what is not done

Nothing in this wave is a claim about the running app beyond what was
measured. The honest list:

- **The React layer has no test framework**, by the project's own rule. The
  panels, the rail, the menu, the options bar, the workspace and the
  shortcuts are covered by their pure modules and, in three cases, by a
  Playwright scene. The rest are manual-verification items.
- **A11's stack is not mounted.** `Workspace.tsx` still renders the side
  column from the registry itself, which is why the colour dock had to be
  de-duplicated. The fold button in `components/panels/Panel.tsx` is not
  drawn, because that file was not in any slice.
- **A19's rulers, A13's symmetry axes, A18's reference images and A21's
  gradient handles are display-only models with no engine hook yet.** Each
  builder named the hook its next rung needs, and each hook is in a file
  another slice owns.
- **A26's groups are not composited by the renderer.** The renderer still
  iterates `doc.layers`, so a document that *could* contain a group would
  not paint the group's children. Nothing can create one yet, so no
  existing behaviour changes.
- **The project's format is at 13**, with two changes in it: the brush's
  `tip` (A14) and the layer `kind`/`children` (A26). A version-12 reader
  refuses the file.
- **A21 declined the format bump its brief asked for**, on the evidence
  that a gradient has carried its geometry and its stops in the file since
  version 5, so an edited gradient is the same picture in a version-12 build.
  The project's own rule agrees. Its reasoning is in the commit message.
- **A26's `PROJECT_VERSION` bump and A14's were reconciled by hand.** Both
  are 13; the version table row was rewritten to cover both changes.
- **The packaged Tauri app was not rebuilt or driven.** The build, the type
  check, the unit suite and the browser suite were run; the desktop binary
  was not.

---

## 9. The final state

| | |
| --- | --- |
| Wave branch | `integration/wave-3-shell`, at the ledger's own commit |
| Code tip | `5a5262a` (the symmetry) |
| Commits over the base | 79 |
| Files changed | 182 (+38,757 / −1,066) |
| Tests | 2169 in 85 files, all pass |
| Type check | clean |
| Production build | succeeds |
| Visual regression | 45 passed |
| Builder branches | 29, all kept, all pushed to nothing |
| `main` | untouched |
| `origin` | untouched — nothing was pushed |
| `qa/` | preserved exactly |
| Shared checkout | not touched by this wave |
