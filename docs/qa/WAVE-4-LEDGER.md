# Wave 4 — the follow-up ladder

**Coordinator:** night shift · **Base:** `629e168` (the wave-3 tip)
**Wave branch:** `integration/wave-3-shell`
**Task table:** `D:/Dev/Paka-overnight-worktrees/wave4-tasks.ps1`
**Worktrees:** `D:/Dev/Paka-overnight-worktrees/Bxx-...`, 29 of them, each with
its **own real install** (not a junction), so a concurrent install elsewhere
on the machine cannot break a builder's checks.

Every task is the concrete follow-up its own wave-3 builder named in its
report. The models exist, are tested and have no caller; these slices make
the engine, the renderer or the shell call them.

## The batches

| Batch | Builders | Surface |
| --- | --- | --- |
| 1 | B29, B22, B21, B11, B12, B17, B18, B20 | **no engine method at all** |
| 2 | B10, B27 | the shell's composition, the panel layout's round trip |
| 3 | B01, B02, B13, B16, B25, B23 | the engine lane, first group |
| 4 | B03, B04, B05, B06, B07, B08, B14, B15 | the engine lane, second group |

**The engine lane is merged one builder at a time.** B01, B02, B03, B04, B05,
B06, B07, B08, B13, B14, B15, B16, B23, B25 and B28 all edit
`src/core/engine/DrawingEngine.ts` or `src/core/rendering/Canvas2DRenderer.ts`.
They work in parallel in their own worktrees, and they are merged serially,
in dependency order, so no merge ever has to reconcile two builders' changes
to the same method.

**The first dispatch of 20 builders was cancelled before any of them wrote a
line.** Every Bxx worktree was left clean and every Bxx branch at the base.
Nothing was lost. The wave was resumed in the smaller batches above, which
have run without a cancellation.

## The builders

| # | Task | Owner | Branch | Status |
| --- | --- | --- | --- | --- |
| B01 | the engine's pointer router consults the ownership model | A29 | `feat/wave4/B01-pointer-routing` | queued |
| B02 | the symmetry reaches the engine | A13 | `feat/wave4/B02-symmetry-engine` | queued |
| B03 | the engine delegates the selection's geometry | A16 | `feat/wave4/B03-selection-engine` | queued |
| B04 | the gradient's gesture and overlay | A21 | `feat/wave4/B04-gradient-engine` | queued |
| B05 | the layer groups reach the engine and the renderer | A26 | `feat/wave4/B05-layer-groups-engine` | queued |
| B06 | the pressure dynamics reach the brush and the renderer | A12 | `feat/wave4/B06-dynamics-renderer` | queued |
| B07 | the reference images reach the renderer and the app | A18 | `feat/wave4/B07-reference-renderer` | queued |
| B08 | the renderer paints the registered overlays | A19 | `feat/wave4/B08-overlay-pipeline` | queued |
| B09 | the first real section through the settings mechanism | A22 | `feat/wave4/B09-settings-wiring` | queued |
| B10 | the panel stack is mounted and the fold button exists | A11 | `feat/wave4/B10-panel-stack-mount` | running |
| B11 | the preset browser is mounted and the library's files work | A06 | `feat/wave4/B11-preset-browser-mount` | running |
| B12 | the brush tip has a control | A14 | `feat/wave4/B12-tip-control` | running |
| B13 | the engine seeds the shipped brushes | A27 | `feat/wave4/B13-bundled-presets-engine` | queued |
| B14 | the brush size gesture reaches the engine | A05 | `feat/wave4/B14-brush-size-engine` | queued |
| B15 | the navigator is mounted and the renderer answers the overview | A09 | `feat/wave4/B15-navigator-mount` | queued |
| B16 | the bucket's options reach the engine | A20 | `feat/wave4/B16-fill-options-engine` | queued |
| B17 | the user's chords reach the running app | A23 | `feat/wave4/B17-shortcut-runtime` | running |
| B18 | the named profiles live in the settings file | A24 | `feat/wave4/B18-workspace-profiles-persist` | running |
| B19 | the brush group reads the property model; the bar is mounted | A04 | `feat/wave4/B19-brush-group` | queued |
| B20 | the rail and the options bar draw the same tool | A03 | `feat/wave4/B20-toolbox-adoption` | running |
| B21 | the menu bar's roving tabindex and type-ahead | A25 | `feat/wave4/B21-menu-aria` | running |
| B22 | the folded panels travel with the shell's preferences | A07 | `feat/wave4/B22-colour-fold-state` | **integrated** |
| B23 | the brush cursor is wired to the engine | A10 | `feat/wave4/B23-brush-cursor-engine` | queued |
| B24 | the layers panel shows the tree | A08 | `feat/wave4/B24-layer-tree-panel` | queued |
| B25 | the polygon and the star gain an outer radius | A15 | `feat/wave4/B25-shape-outer-radius` | queued |
| B26 | the shell's arrangement is read from the settings file | A01 | `feat/wave4/B26-workspace-wiring` | queued |
| B27 | the panel layout's owner adapter and its round trip | A28 | `feat/wave4/B27-panel-layout-round-trip` | running |
| B28 | the engine's overlay draws the handles from the module | A17 | `feat/wave4/B28-transform-handles-engine` | queued |
| B29 | the registry notifies; the option kinds are exhausted | A02 | `feat/wave4/B29-registration-order` | running |

## The integration log

| Builder | Commit | Merge | Note |
| --- | --- | --- | --- |
| B22 | `f63828d` | `4438305` | The preferences carry `foldedPanels`; the version stays at 1 because the field is additive. The coordinator also fixed the catalogue's colour label, which said "Colour" while the dock said "Color". |
| B12 | `620ec0a` | `34ee58d` | The tip's five shapes as a control, refused outside the closed set, with the tip's own mask as the preview; the preview rides a small registry so the shared contract is not widened. |
| B18 | `16e6f69` | `d8d7cd3` | The named profiles live in the settings file and a switch adopts the completed layout; the live arrangement is reached through a port, not a reach-in. |
| B17 | `40638d6` | `40449bc` | The chords live in a session store, the keyboard hook hands them to the dispatcher, and the editor panel captures a chord and reports the holder of a taken one. |
| B29 | `94cf8c0` | `fa6e00e` | The registry publishes a batched change, `color`/`colour` are one panel, and the option kinds are exhausted in one table. Additive: no export changed meaning. |

B18, B17 and B29 were cut off **after their slices were green** — type
check clean, their own test files passing — but before they could report.
The coordinator reviewed each diff, committed the work in the builder's own
worktree, and merged it. The commit messages say so.

## Where wave 4 actually stopped

**Five of the twenty-nine landed.** The rest were cut off by a **free-usage
limit** that hit every running subagent at once, and the first dispatch of
twenty had already been cancelled before any of them wrote a line.

| Outcome | Builders |
| --- | --- |
| Integrated and verified | B22, B12, B18, B17, B29 |
| **Produced no work of their own** | B10, B27 |
| Mid-edit, does not compile | B20, B21 |
| Cancelled before writing a line | the first dispatch of twenty |
| Cut off by the usage limit | the remainder |

**B10 and B27 are not integrable, and the reason matters.** B10 `cherry-picked`
B22's commit onto its own branch; B27 `fast-forwarded` to it. Neither branch
contains a line of its own slice — no panel stack mount, no fold button, no
layout round trip. Integrating either would add a second copy of B22's work.
Their branches are left in place so the mistake is visible rather than
tidied away.

**B20 and B21 are half-finished and do not compile** — B21 is missing
`menuNavigationKey` and leaves `matchLabel` unused; B20 leaves a scratch test
that imports `node:fs` and a `toolShortcut` that is not exported. They are
unverified drafts, not slices, and they were not merged.

### The drafts are preserved

The interrupted work is not lost and it is not in the history. Each dirty
worktree's `src/` was copied to
`D:/Dev/Paka-overnight-worktrees/preserve/wave4-drafts/<builder>/src`:

| Builder | What it had |
| --- | --- |
| B17 | the chords' section, session, hook, panel and test — **now integrated** |
| B18 | the profiles' port, section, store, context, picker, hook and test — **now integrated** |
| B29 | the registry change, the option table, the panel hook and four test files — **now integrated** |
| B20 | the popover, the rail menu, the icons, the rail, `menuEntries`, `toolIdentity`, and a scratch test |
| B21 | the menu bar, the navigation model and its test, and the stylesheet |

B20's partial work is the one with a real defect in it: `src/test/scratch.test.ts`
imports `node:fs` in a browser-targeted test run. Anyone resuming it should
delete that file rather than repair it.

### What the next shift must do

The ladder is intact: `wave4-tasks.ps1` still names all twenty-nine, the
twenty-nine worktrees still exist with their own installs, and the branches
still stand at the base. The eight that landed are the ones whose slices were
rooted in a model that already existed; the rest need the same treatment, and
the engine lane in particular needs the serial merge order this ledger set out.

---

## Verification at this tip

`fa6e00e`, run serially, on the wave branch:

| Check | Result |
| --- | --- |
| `tsc --noEmit` | clean |
| `pnpm test` | **2263 tests in 88 files**, all pass |
| `pnpm build` | succeeds — 184 modules transformed |
| `pnpm test:visual` (port 1697) | **45 passed** (18.8 s) |

`qa/` in the shared checkout is untouched: **27 files**, 0 tracked,
still `?? qa/`, newest write **2026-10-20 19:19** — two days before this
shift began.

## The two waves

See [WAVE-3-LEDGER.md](WAVE-3-LEDGER.md) §6a. The concurrent swarm's
converged working tree is preserved as `preserve/swarm-working-tree` at
`0f47ea6` — 1500 tests in 69 files, the type check clean, the build
succeeding, 56 visual scenes passing — and the shared checkout was not
modified to take it.
