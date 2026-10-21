# Integration — the next build wave (N1, N2/N3, N4, N6)

**Branch:** `integration/next-build-wave`
**Base:** `38efc1f` — the phase-1 integration tip (`integration/phase1-settings-texture-transforms`)
**Integrated tip:** filled in by the final commit of this report (see `git log` on the branch)
**Ownership:** the four feature branches and this integration branch are local to
`C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\`. **No branch was pushed
by the coordinator**, and `main` and the shared checkout
`C:\Users\aissa\Desktop\Paka` were not modified.

**Remote caveat, measured:** the concurrent writer described in §2 pushed two of
the wave branches to `origin` itself — `feat/n2-n3-colour-workflow` at
`b0cbee6` and `feat/n6-blend-modes` at `6a0cae8` (confirmed with
`git ls-remote --heads origin`). That was not the coordinator's action and it
was not undone, because undoing it would mean rewriting remote history. `main`
on the remote is `b5fa8df` and is unrelated to this wave.

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

**N6 - blend modes.** `overlay`, `soft-light`, `hard-light`, `color-dodge`,
`darken`, `lighten`, `difference`, `exclusion` join `normal` /
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

Rebuilt from the integrated source and driven on the real window:

- **Build:** `pnpm tauri build --no-bundle`, 5m40s, `src-tauri/target/release/paka.exe`
  (4,812,800 bytes), from `fdba3eb`; the only later commit is documentation.
- **Window fit:** outer **1818×1020** at (102, 0) on first launch and (64, 0) after
  a restart; work area 1920×1020 at 125 %; bottom/right overhang **0**; client
  1800×973 physical = **1440×778.4 CSS**, matching `innerWidth` 1440. The phase-1
  work-area clamp is intact in this binary.
- **Brush presets, end to end:** the picker read "No saved presets" on a v1
  settings file that has no `presets` key (backward compatibility, observed).
  Saving "Wave Test" from the UI wrote `presets[1]` into
  `%APPDATA%\com.paka.drawing\settings.json` through the real settings command,
  with the full brush (`size 37`, `stampTexture 0`, ...); after closing and
  relaunching, the picker showed **"Wave Test"** and had it selected. The
  pre-wave settings file was restored afterwards.
- **Grid:** toggling **Grid** wrote `gridVisible: true`; after a restart the
  switch was on and the status bar read **"grid 50 px"**. `APP` capture shows the
  lattice drawn over the paper, scaled with it.
- **Colour:** the readout showed `#cc3366` on paper `#ffffff` as **Contrast
  5.0:1**, "Meets AA body text (4.5:1)", **ΔE00 47.28** and the nearest swatch
  `#d946a0` at ΔE 12.45. Typing into the colour field: `oklch(0.7 0.15 30)` →
  `#ed7665`; `hsl(210 50% 40%)` → `#336699`; `#3366cc80` → refused with
  **"Not a solid colour (alpha below 1) - kept #336699"** and `aria-invalid`;
  `nonsense-value` → reverted to the last valid colour. No throw.
- **Blend modes:** the layer blend select in the packaged UI lists the eleven
  modes.

Bounded: this run did **not** save and reopen a v11 project through the native
dialogs, and did not exercise 100 % or 150 % scaling (the machine is configured
at 125 %). Those stay in §7.

## 7. Bounded, unverified

- **Native-dialog save and reopen of a v11 project** was not driven in the
  packaged app; the format contract is covered by unit tests only.
- **Physical-desktop interaction** is only as good as the harness. Page-level
  interaction through the WebView2 debug protocol is not the same as an OS mouse
  click; window geometry and screenshots are OS-level.
- **Scaling other than 125 %** was not exercised: this machine has one monitor
  configuration.
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
- `main` and `origin/main`: untouched by this work. The only remote change
  attributable to the wave is the concurrent writer's push of
  `feat/n2-n3-colour-workflow` and `feat/n6-blend-modes` (see the header
  caveat); the coordinator pushed nothing, and no branch was force-pushed.
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
