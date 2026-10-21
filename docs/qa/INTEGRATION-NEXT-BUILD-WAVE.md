# Integration — the next build wave (N1, N2/N3, N4, N6)

**Branch:** `integration/next-build-wave`
**Base:** `38efc1f` — the phase-1 integration tip (`integration/phase1-settings-texture-transforms`)
**Integrated tip:** filled in by the final commit of this report (see `git log` on the branch)
**Ownership:** the four feature branches and this integration branch are local to
`C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\`. Nothing was pushed,
`main` was not touched, and the shared checkout
`C:\Users\aissa\Desktop\Paka` was not modified.

## 1. What this wave is

Four feature lanes, each in its own worktree, each cut from `38efc1f`:

| Lane | Branch | Worktree | Tip | Commits |
| --- | --- | --- | --- | --- |
| N1 brush presets | `feat/n1-brush-presets` | `worktrees/n1-brush-presets` | `d436ecf` | `3afd1ce`, `d436ecf` |
| N2/N3 colour workflow | `feat/n2-n3-colour-workflow` | `worktrees/n2-colour-workflow` | `b0cbee6` | `7fb1b7f` (merge of the pre-existing T-13 branch `b6337cb`), `490c0dc`, `b0cbee6` |
| N4 grid and snapping | `feat/n4-grid-snapping` | `worktrees/n4-grid-snapping` | `6d9ee5b` | `2d90c7d`, `9681014`, `6d9ee5b` |
| N6 blend modes | `feat/n6-blend-modes` | `worktrees/n6-blend-modes` | `6a0cae8` | `aef3fde`, `6a0cae8` |

**N2 was not built twice.** The contrast / colour-difference feature already
existed as `feat/t13-contrast-dee` (`b6337cb`, 40 tests including the published
CIEDE2000 verification table) on a stale base. The colour lane merged that
branch onto the wave base and then built N3 on top, rather than reimplementing
it. `b6337cb` is preserved on its original branch; the merge is `7fb1b7f`.

## 2. Integration

Merged one at a time into `worktrees/integration-next-build-wave`, `--no-ff`,
never rebased or forced:

| Order | Merge | Feature |
| --- | --- | --- |
| 1 | `032fddd` | N1 brush presets |
| 2 | `030aa1b` | N4 grid and snapping |
| 3 | `8a92950` | N6 blend modes, project format 11 |
| 4 | `fdba3eb` | N2/N3 colour workflow |

**Conflicts: one.** `src/core/settings/appSettings.ts` on the N4 merge, where
N1 added the preset imports and N4 added the grid imports to the same block.
Resolved by keeping **both** import groups; both features' fields are present in
the settings document and both round-trip in the settings tests. Every other
file auto-merged, including `AGENTS.md`, `README.md`, `docs/ARCHITECTURE.md`,
`docs/ROADMAP.md` and `docs/SESSION-BRIEF.md`, which several lanes edited.

### A note on authorship in the wave worktrees

While the builders ran, commits authored as `aissaadib
<145858710+aissaadib@users.noreply.github.com>` appeared in the same four
worktrees, interleaved with the builders' commits (for example `aef3fde` added
the eight blend modes; `2d90c7d` added the grid; `d436ecf` hardened the settings
readers; `b0cbee6` added the two-colour comparison). They are **additive
continuations of the same features, not competing rewrites**, so they were
treated as part of the wave, inspected, and integrated. Nothing from either
author was reverted or discarded. Two builders stopped and reported the
collision instead of overwriting; that is the correct behaviour and it is why
this section exists.

## 3. What landed

**N1 — brush presets.** Save the current brush under a name, switch between
presets, rename and delete, all persisted in the per-user settings file
(`presets` is additive; a file without it loads as an empty list). Applying a
preset goes through the normal brush setter and is **not an edit** — no history
step, no dirty flag. The regression guard is table-driven over
`Object.keys(DEFAULT_BRUSH)`: every field is set to a non-default value,
round-tripped through the settings reader, and asserted, so a field the reader
forgets fails a test instead of being silently lost (the `stampTexture` bug
class).

**N2/N3 — colour.** WCAG 2.2 relative luminance and contrast ratio, sRGB to
CIELAB, CIEDE2000 against the published verification data, the nearest palette
swatch by ΔE, a two-colour comparison, and a read-only readout in the colour
panel. Wider input: 8-digit hex, `hsl()`/`hsla()`, `oklch()`, with an
out-of-gamut `oklch()` clamped into sRGB, garbage input reverting to the last
valid colour, and translucent input reported as **not a solid colour** rather
than silently measured. The stored colour stays a hex string — no format change.

**N4 — grid and snapping.** A grid lattice in document space (spacing 2–500
document pixels) and a snap magnet within 6 **screen** pixels of a guide or grid
line, applied in the engine's single pointer entry point. Both are view state:
no pixels, no history step, no dirty flag, nothing in an export, remembered in
the settings file. No project-format change.

**N6 — blend modes.** `overlay`, `soft-light`, `hard-light`, `color-dodge`,
`color-burn`, `darken`, `lighten`, `difference`, `exclusion` join `normal` /
`multiply` / `screen`. `normal`, `multiply` and `screen` are pixel-identical to
before. Expected-pixel tests per mode, alpha cases, and save/reopen coverage.

## 4. The one escalation: project format 11

N6 changes what a stored file may contain, so the project's own versioning rule
(`docs/PROJECT_FORMAT.md`) requires a bump. `PROJECT_VERSION` moved **10 → 11**.
The compatibility contract, each pinned by a test:

- a v10 file still opens, with every previous mode intact;
- a v11 file round-trips all eleven modes;
- a v10 reader **refuses** a v11 file rather than rendering an unknown mode as
  `normal`.

This is the only change in the wave that alters a persisted contract, and it is
isolated in the N6 branch's own commits. It needs the owner's acknowledgement
before this branch is merged anywhere that ships.

## 5. Verification — measured on the integrated tip

Run serially, one command at a time, against the exact integrated HEAD:

| Check | Command | Result |
| --- | --- | --- |
| Unit + integration | `pnpm test` | **967 tests in 44 files, all pass** |
| Types | `pnpm typecheck` | exit 0 |
| Production build | `pnpm build` | succeeded, 114 modules, `index-*.js` 389.84 kB |
| Visual regression | `pnpm test:visual` | **30 passed** |
| Rust | `cargo check --lib` | exit 0 (the Rust tree is unchanged by this wave) |
| Packaged Tauri | `pnpm tauri build --no-bundle` | see §6 |

Baseline before the wave, measured the same way on `38efc1f`: 791 tests in 37
files, 25 visual tests. The wave adds **176 tests in 7 files** and **5 visual
scenes**.

No test was run concurrently with the Rust build.

## 6. Packaged desktop

The packaged section is completed after the build slot; see the closure note at
the end of this file.

## 7. Bounded, unverified

- **Physical-desktop interaction** is only as good as the harness. Page-level
  interaction through the WebView2 debug protocol is not the same as an OS mouse
  click; window geometry and screenshots are OS-level.
- **Rust unit tests** (`cargo test --lib`) cannot run on this machine: the test
  binary fails to load with `0xC0000139` (`STATUS_ENTRYPOINT_NOT_FOUND`) while a
  minimal crate on the same toolchain runs. The geometry tests compile but have
  never executed here. This predates the wave and the wave adds no Rust code.
- **The format bump is not owner-approved.** See §4.
- Autosave and recovery-file writing remain **disabled** by owner decision; the
  wave did not change that. No broad filesystem-deletion capability was added.

## 8. Untouched, confirmed

- Shared checkout `C:\Users\aissa\Desktop\Paka`: not modified by this wave; it
  remains on `feat/stamp-brush-engine` with its pre-existing untracked `qa/`.
- `main` and `origin/main`: untouched. Nothing was pushed from any wave branch.
- Existing worktrees: inspected, never removed or reset.
- Dependencies, lockfiles, licences, notices, Cargo manifests and the
  wry/Tauri DPI path: unchanged.

## 9. Next queue

1. **N5 taper and pressure easing** — the brush data/engine lane is now free
   (N1 landed); it is the last remaining Phase 3 item short of the brush tip.
2. **N7 window geometry persistence** — now that the work-area clamp is shipped
   and protected, remembering the last window rectangle is a small, isolated
   change.
3. **Brush tip and image-based stamp textures** — the remaining Phase 3 slice,
   still the product's stated next step in `docs/ROADMAP.md`.
4. **Owner decisions still open:** the v11 acknowledgement, the T-06 autosave
   gates, R3 countersignature, R6 patent position, R9 CI licence allow-list,
   and the D-1 font-identity policy.
