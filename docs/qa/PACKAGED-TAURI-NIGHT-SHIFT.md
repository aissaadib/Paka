# Packaged Tauri desktop verification — night shift

**Agent:** desktop-runtime QA (Agent 1)
**Date:** 2026-10-21
**Branch / worktree:** `qa/packaged-desktop`, in
`C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\qa-packaged-desktop`
**Base:** `a1c9c1d` (the verified tip of `feat/stamp-brush-engine`)
**Subject:** the *packaged* desktop application — the thing the project has
never run against the current tree.

> **ERRATUM - "Defect 1" is withdrawn.** Section 5 found the app clipped on a
> scaled display and blamed `wry` for passing physical pixels to a DIP API.
> That finding is **invalid**: the geometry was read from a DPI-unaware process,
> which Windows reports in DIPs. The app renders correctly at 125 %. The
> original text is preserved below as the record of what was claimed and why.
> See [`PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md`](PACKAGED-TAURI-NIGHT-SHIFT-ERRATUM.md).
> Section 6 - the default window does not fit the work area - is **not**
> affected and stands as a real defect.

> **How to read the evidence labels.** Every result is tagged with where it
> came from:
> **PACKAGED** = the real desktop executable (`paka.exe`, release build);
> **BROWSER** = the dev server in a browser; **UNIT** = vitest;
> **STATIC** = reading the code. A browser result is never presented as proof
> of desktop behaviour.

---

## 1. Verdict

The packaged application **builds, launches, and works** on this machine. The
native paths that no browser test can reach — the file dialogs, the atomic
save, the PNG export, the Rust native-environment probe — all work, and the
drawing engine behaves the same as in the browser.

**One severe defect was found and reproduced**: on a display with scaling
other than 100% (this machine is 125%), the packaged app draws only the
**top-left 80% of its own interface**. The colour wheel, the layers panel and
the status bar are never painted, the brush toolbar is cut in half, and the
canvas itself is cut off. It is a defect in the Tauri webview runtime
(wry 0.57.0), not in Paka's TypeScript; §5 gives the exact upstream patch.

**One medium defect**: the app's default window (1440×900 logical = 1800×1125
physical) is larger than this display's work area (1536×816), so Windows
clamps it and leaves the bottom of the client area below the screen edge.

**One unreproduced observation** is recorded in §6, with the mechanism that
makes it possible.

---

## 2. Baseline (measured, not assumed)

| Item | Value |
| --- | --- |
| Repository | `C:\Users\aissa\Desktop\Paka` |
| Branch / HEAD | `feat/stamp-brush-engine` @ **`a1c9c1d`** — *not* `a42e67f`; `a1c9c1d` is a docs commit on top of that merge |
| `main` / `origin/main` | `ad2ef11` — identical and untouched |
| Pre-existing staged / unstaged / untracked | 0 / 1 (`skills-lock.json`, the user's own) / 13 (`.agents/skills/*`, `.opencode/`, `qa/`, 4 scratch files) — **all preserved** |
| Other agents building | none: 0 `cargo`/`rustc` processes, so the build slot was free |
| Pre-existing `paka.exe` | 4,812,800 bytes, built 2026-10-20 20:34 — **stale** (predates the colour wheel, guides, polygon/star and selection transforms) |
| Worktree | `git worktree add … -b qa/packaged-desktop a1c9c1d` — the shared checkout was never cleaned or reset |

---

## 3. The build and launch procedure

### 3.1 Toolchain (measured)

| Item | Value |
| --- | --- |
| `rustc` / toolchain | 1.99.1, `stable-x86_64-pc-windows-gnu` |
| Linker | WinLibs **MSVCRT** MinGW-w64 (`…\WinGet\Packages\BrechtSanders.WinLibs.POSIX.MSVCRT…\mingw64\bin`), present with `dlltool.exe` |
| MSVC | absent — the GNU target is used |
| `~/.cargo/config.toml` | adds `-C link-arg=-Wl,--exclude-all-symbols` (Binutils' `ld` rejects the Tauri cdylib with *"export ordinal too large"*) |
| Stack | Tauri 2.12.4 · tauri-runtime-wry 2.12.2 · **wry 0.57.0** · tao 0.37.1 |
| Display | 1536×864, **125% scaling** (`GetDpiForWindow` = 120), work area 1536×816 |

`~/.cargo/config.toml` warns that *"the UCRT flavour links but produces
load-time failures"*. That is true of the **test harness** (`cargo test --lib`
fails with `0xC0000139`), **not** of the application: the pre-existing
release binary started and stayed alive for the whole session.

### 3.2 The commands

```powershell
cd <worktree>
pnpm install --frozen-lockfile                 # a new worktree has no node_modules
$env:PATH = "<WinLibs mingw64\bin>;$env:PATH"  # rustc calls dlltool.exe by name
$env:CARGO_TARGET_DIR = "C:\Users\aissa\Desktop\Paka\src-tauri\target"
pnpm tauri build --no-bundle
```

Result: `Finished 'release' profile [optimized] target(s) in 6m 48s`,
`Built application at: …\src-tauri\target\release\paka.exe` (4,793,856 bytes).
`CARGO_TARGET_DIR` points at the shared, already-warm target (9.3 GB of cached
dependency artefacts) so only Paka's own crate is recompiled; a worktree-local
target would mean a cold rebuild of the whole Tauri tree. A build writes only
git-ignored paths (`dist/`, `src-tauri/target/`).

**Trap for anyone else building from a fresh worktree:** `pnpm tauri build`
there fails with *"'tauri' is not recognized … Local package.json exists, but
node_modules missing"* — the install must come first.

The linker emits one warning worth recording:
`warning: linker stderr: … ld.exe: .rsrc merge failure: multiple non-default
manifests` — a warning, not an error, and the produced binary runs.

### 3.3 How a native app was observed at all

Three channels, all used together:

1. **Physical screen capture** (`.NET` `CopyFromScreen`) with the app window
   forced topmost, so what the *user* sees is on record.
2. **WebView2 remote debugging** — the app was launched with
   `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` and
   driven over the DevTools protocol. This gives DOM truth, real input events
   (`Input.dispatchMouseEvent`/`dispatchKeyEvent` are trusted events) and the
   page's own render (`Page.captureScreenshot`).
3. **HWND geometry** via `EnumChildWindows` / `GetWindowRect` /
   `GetDpiForWindow` from a separate process.

Helper scripts used (kept outside the repository, in
`Paka-feature-factory\wave0\`): `capture.ps1`, `desk.ps1`, `cdp.ps1`,
`cdpcmd.ps1`, `mkcmd.ps1`, `dlg.ps1`.

---

## 4. Test results

| # | Workflow | Result | Evidence | Notes |
| --- | --- | --- | --- | --- |
| 1 | Application startup | **PASS** | PACKAGED | Launches, stays alive, OS window title `Untitled - Paka` (the native `setTitle` works) |
| 2 | Application shutdown | **PASS** | PACKAGED | Via the close guard → *Discard and close* → the process exits |
| 3 | New document | **NOT TESTED** | — | The File → *New Document.* entry exists (with a confirmation dialog); not exercised |
| 4 | Open an existing project | **PASS** | PACKAGED | Native *Open project* dialog → file loads; status `Opened qa-save.paka`, `1 guide`, title `qa-save.paka - Paka` |
| 5 | Save | **PASS** | PACKAGED | Native *Save project* dialog → 67,672-byte file, `version 9`, 1 layer / 3 elements / 1 guide `vertical@43`; status `Saved qa-save.paka`; the dirty marker cleared |
| 6 | Save → reopen round trip | **PASS** | PACKAGED | The guide is restored at the same document coordinate (drag at page x=250 → document x=43; the mapping `doc = 2·(pageCSS−228)` gives 44 ≈ 43) |
| 7 | Drawing with the brush | **PASS** | PACKAGED | Stroke drawn; status `unsaved … history 1` |
| 8 | Changing brush settings | **NOT REACHABLE** | PACKAGED | The brush toolbar row is cut at *Stabilizer* by defect §5 — the control cannot be reached on this display |
| 9 | HSV colour-wheel interaction | **NOT REACHABLE** | PACKAGED | The COLOUR panel (wheel, Hue/Sat/Value, hex field) is never painted — defect §5. It *exists* in the page render, so the component works, but the user cannot reach it |
| 10 | Layer selection / Move up / Move down | **NOT REACHABLE** | PACKAGED | The LAYERS panel is never painted — defect §5. The `Edit → Duplicate Layer` menu entry is reachable and works |
| 11 | Undo / redo after drawing | **PASS** | PACKAGED | `Ctrl+Z` → history 4→3 and the guide disappears; `Ctrl+Shift+Z` → history 3→4 and the guide returns |
| 12 | Undo / redo after a shape | **PASS** | PACKAGED | Polygon: history 1→2; star: 2→3 |
| 13 | Polygon creation | **PASS** | PACKAGED | Toolbar switches to `Sides 5 · Rotation 0° · Fill shape` |
| 14 | Star creation | **PASS** | PACKAGED | Toolbar switches to `Points 5 · Inner radius 50% · Rotation 0° · Fill shape` |
| 15 | Shift / Alt constraints, shape rotation on a non-square box | **NOT TESTED** | — | The controls are present; the gestures were not exercised |
| 16 | Guides creation | **PASS** | PACKAGED | Status gains `1 guide`; a horizontal drag produces a **vertical** guide (correct axis heuristic) |
| 17 | Guide movement / deletion / cancellation | **NOT TESTED** | — | The Guides tool and the model are covered by the browser/unit suites |
| 18 | Guide persistence in the project file | **PASS** | PACKAGED | `document.guides` = 1 entry in the saved v9 file, restored on reopen |
| 19 | Selection: click without movement | **PASS** | PACKAGED | With the select tool, a click that does not move leaves history and the guide count unchanged |
| 20 | Selection: duplicate / nudge / flip (Selection menu) | **PASS** | PACKAGED | Clicking a stroke → `1 selected`; *Selection → Duplicate* → history 1→2, still `1 selected` |
| 21 | Selection: scale / rotate gesture | **NOT TESTED** | — | The handles are drawn on the canvas, inside the clipped region on this display |
| 22 | Unsaved-change marker | **PASS** | PACKAGED | `● unsaved` appears on the first edit and clears on save |
| 23 | Unsaved-change warning on close | **PASS** (with the caveat in §6) | PACKAGED | The close is vetoed and the in-app dialog appears: *Close Paka? The current drawing has unsaved changes. Closing Paka discards them. [Cancel] [Save first] [Discard and close]*; *Discard and close* closes the app; *Cancel* returns to the drawing |
| 24 | Guard's *Save first* path | **NOT TESTED** | — | The button exists; the path was not exercised |
| 25 | Closing while a gesture is in progress | **NOT TESTED** | — | Every gesture completed in every attempt |
| 26 | Window resizing | **PASS** (with defect §5) | PACKAGED | The page viewport tracks the window exactly (1185×722 CSS for a 1185×722 client) |
| 27 | Panel layout / clipping near panel edges | **FAIL** | PACKAGED | See §5 — the right-hand column and the status bar are clipped away |
| 28 | Export PNG | **PASS** | PACKAGED | Native *Export PNG* dialog → a 1600×1200 PNG (119,313 bytes) with 1.53% of its pixels inked; status `Exported qa-export.png (116.5 kB)`. **This workflow cannot run in a browser at all** — every earlier review had to call it untested |
| 29 | File dialogs | **PASS** | PACKAGED | *Save project*, *Open project* and *Export PNG* all open the Windows common dialog (`#32770`) |
| 30 | Keyboard shortcuts and collisions | **PASS** | PACKAGED | `B/E/M/L/R/O/P/S/I/F/G/H/U` switch tools; `Ctrl+S` saves **and does not** also select the star tool (the modifier branch returns before the tool branch); `Ctrl+O`, `Ctrl+Z`, `Ctrl+Shift+Z` behave |
| 31 | Startup / recovery after an interrupted test | **NOT TESTED** | — | Deliberately not induced: no recovery-file policy exists in the app yet (T-06 is still an owner decision) |
| 32 | Rust native-environment probe | **PASS** | PACKAGED | The status bar reads `native windows/x86_64` — the `native_environment` command answers, where the browser reads *native unavailable* |

---

## 5. Defect 1 (severe) — on a scaled display the app loses 20% of its interface

### 5.1 What the user sees

The packaged app on this 125% display (window 1200×760 physical):

* the **COLOUR panel is absent** — no HSV wheel, no Hue/Saturation/Value
  sliders, no hex field;
* the **LAYERS panel is absent** — no layer list, no *Move up* / *Move down*;
* the **status bar is absent** — no document size, no zoom, no history count,
  no dirty marker, no cursor position;
* the brush toolbar is **cut in half** (it stops at *Sampling*, and the
  *Wheel: scroll · Ctrl+Wheel: zoom* hint is truncated);
* the **canvas is cut off** — the document is only 80% wide on screen.

Evidence: `evidence/01-physical-client-1185.png` (what reaches the screen) vs
`evidence/02-page-render-1483.png` (what the app itself draws).

### 5.2 The measurements that prove it

| Quantity | Value | Source |
| --- | --- | --- |
| Window client area | **1185 × 722 physical px** | `GetClientRect` |
| `window.innerWidth` / `innerHeight` | **1185 / 722** | CDP `Runtime.evaluate` |
| `window.devicePixelRatio` | **1.25** | CDP `Runtime.evaluate` |
| The page's own render | **1483 × 904 device px** | CDP `Page.captureScreenshot` (1440→1800, 844→1055 in the 1440-wide case) |
| WebView2 host HWND | 1440×844 physical = the client area | `EnumChildWindows` |

The page lays itself out in **1185 CSS px** and then paints it at 1.25 device
px per CSS px, i.e. **1483 device px**, into a host that is only **1185 device
px** wide. The surplus 20% is discarded.

To rule out "it is merely scaled", the physical capture was compared with both
candidate renderings of the same page:

| Hypothesis | Mean per-channel difference vs the physical capture |
| --- | --- |
| **A — clipped** (physical == the top-left 1440×844 crop of the page render) | **5.09** |
| B — scaled down (physical == the page render resized to fit) | 52.95 |

⇒ **The page is clipped, not scaled.** The 20% that is missing is drawn off
the edge of the host and never composited.

### 5.3 Root cause (upstream, in the dependency)

`wry 0.57.0`, `src/webview2/mod.rs`:

```rust
pub fn set_bounds_inner(&self, size: PhysicalSize<i32>, position: PhysicalPosition<i32>) -> Result<()> {
    unsafe {
        self.controller.SetBounds(RECT {          // <-- expects DIPs, gets physical px
            top: 0, left: 0, right: size.width, bottom: size.height,
        })?;
        SetWindowPos(self.hwnd, None, position.x, position.y,
                     size.width, size.height, …)?;   // <-- physical: correct
    }
    Ok(())
}
```

`ICoreWebView2Controller::SetBounds` takes **device-independent pixels**;
wry hands it **physical** pixels. The host HWND is sized correctly, but the
controller's viewport is `scale_factor` times too large, so the page renders
`physical × scale` device pixels into a `physical`-sized host.

This is invisible at 100% scaling (the factor is 1) and destroys the UI at
any other scale: 20% lost at 125%, 33% at 150%, 43% at 175%. It is
independent of the window size, so it is not specific to this small display.

**The one-line upstream fix** (to be proposed to the wry project; *not*
applied here, because changing a dependency is an owner decision — see §8):

```rust
let scale_factor = util::dpi_to_scale_factor(unsafe { util::hwnd_dpi(self.hwnd) });
let dip = size.to_logical::<i32>(scale_factor);
self.controller.SetBounds(RECT { top: 0, left: 0, right: dip.width, bottom: dip.height })?;
```

`wry` issue **#1875** (open, Windows, `type: bug`) reports a different
misbehaviour in this very function — the *position* semantics of
`set_bounds` — and confirms the function's behaviour on wry 0.57.0. A search
of the wry issue tracker found **no report of the size/DPI mismatch**, so this
looks unreported. A wry/tauri bump also changes the dependency lockfile and
therefore the licence inventory (`licenses/dependency-inventory.json`, the
generated `THIRD_PARTY_NOTICES.md`), which is why it is not done unilaterally.

### 5.4 Why no browser test could have caught it

Chromium sizes its own viewport correctly, so the browser preview at any
width shows the full interface; and the visual-regression harness renders in
a browser, not in a WebView2 host. The defect only exists in the packaged
runtime.

### 5.5 A workaround that was considered and rejected

The page could be laid out for the *visible* area instead of the layout
viewport (`innerWidth / devicePixelRatio` when the mismatch is detected, which
is detectable because `core:window:allow-inner-size` and
`core:window:allow-scale-factor` are already granted). That would bring the
panels and the status bar back, at the cost of a 20% strip of dead workspace
on the right of a window whose canvas would no longer fill it. It is a
workaround for someone else's bug, it cannot be exercised by the browser
suite, and it should disappear the moment wry is fixed — so it is **reported,
not shipped**. The owner's call.

---

## 6. Defect 2 (medium) — the default window does not fit the work area

`tauri.conf.json` asks for **1440×900 logical**, which at 125% is
**1800×1125 physical**. This display's work area is 1536×816, so Windows
clamps the window to 1454×882 and the **client area's bottom edge ends up
10 px below the bottom of the screen** (client origin y=30, height 844 →
874 > 864). The window is also placed with its top edge hard against the top
of the screen.

⇒ On a 1366×768-class laptop the window would be clamped harder still, and
the status-bar row at the bottom of the grid would be out of reach — a second,
independent way to lose it (on top of defect 1).

Not fixed here: the right behaviour (fit the work area on launch, or
`maximized`) is a product decision, and the effect cannot be separated from
defect 1 on this display.

---

## 7. Observation — the close guard was bypassed twice, and could be again

**Observed, not reproduced.** In two of five close requests the app exited
**with unsaved changes and no warning**. In three later runs, from a clean
launch, the same request was correctly vetoed and the guard dialog appeared
(§4 #23). The two failures are not explained by anything in the app's own
code — the handler is correct, and when it is invoked it vetoes.

**The mechanism that makes it possible** is in Tauri itself
(`tauri-2.12.4/src/manager/window.rs:177-182`):

```rust
WindowEvent::CloseRequested { api } => {
  if window.has_js_listener(WINDOW_CLOSE_REQUESTED_EVENT) {
    api.prevent_close();          // only if the frontend is already listening
  }
  window.emit_to_window(WINDOW_CLOSE_REQUESTED_EVENT, &())?;
}
```

If the frontend has **not yet** registered its `tauri://close-requested`
listener, the Rust side does **not** prevent the close — the OS closes the
window and the frontend's veto never runs. Paka registers that listener
asynchronously (`await import("@tauri-apps/api/window")` then
`await listen(...)`, in `src/features/project/windowControls.ts:42` and
`src/features/project/useCloseGuard.ts:18`), so there is a window in which the
app is unprotected. Measured on a clean launch, the listener was in place
**within 1 s**; one of the two failures happened while a *native* dialog was
open (the app was `working.`), the other in a session that had been
interrupted.

**Proposed patch location (not applied — the trigger was not reproduced):**
make the veto unconditional on the Rust side, in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
  .plugin(tauri_plugin_dialog::init())
  .on_window_event(|window, event| {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
      api.prevent_close();   // the frontend decides; it already calls destroy()
    }
  })
```

The frontend already ends every path correctly — the Tauri JS wrapper calls
`destroy()` when the handler does not veto, and Paka's own *Discard and close*
path calls `getCurrentWindow().destroy()` (`core:window:allow-destroy` is
granted). The trade-off to weigh: if the webview ever fails to load, the
window would become unclosable, so this needs the owner's decision rather
than a quiet patch.

---

## 8. What was changed

**No source change was made.** Two defects were found; neither can be fixed
inside this assignment:

* defect 1 lives in the `wry` dependency — fixing it means a dependency bump
  and a licence-inventory regeneration, which is an owner decision;
* the close-guard race needs a product decision about an unconditional Rust
  veto, and its trigger could not be reproduced.

Shipping a speculative workaround for someone else's bug, or a speculative
behavioural change to the close path, would be worse than reporting them
precisely. The deliverable is therefore this document plus the evidence.

**Regression coverage added: none.** The two defects are not expressible as
a unit test (they live in the Tauri/wry runtime and in the OS window-close
protocol); the packaging-specific facts that *are* expressible — the dialog
titles, the file format version, the guide round trip — are already covered
by `src/test/projectFormat.test.ts` and `src/test/projectLifecycle.test.ts`.

---

## 9. A side effect of the testing, disclosed

While capturing the native-dialog evidence, one **`Ctrl+S` landed on the
dialog's default location**: the *Save project* dialog opens in the Desktop
folder with the suggested name `Untitled.paka`, and a save completed there.
The file was provably this session's test output (two identical 971-point
strokes, brush size 6, colour `#16181c`, geometry `(240.8, 30.1) →
(934.8, 228.4)` — the brush drag and its duplicate, exactly as this session
drew them).

**It was moved, not deleted**, to
`%LOCALAPPDATA%\Temp\paka-nightshift\accidental-Desktop-Untitled.paka`, so the
owner's Desktop is clean and nothing was destroyed. Every other file this
session wrote went to `%LOCALAPPDATA%\Temp\paka-nightshift\`:
`qa-save.paka` (the project), `qa-export.png` (the export) and the
accidental save above.

**The lesson for the next person:** the native save dialog defaults to the
Desktop with the suggested project name, so a `Ctrl+S` that is not followed
by a full path writes into the user's Desktop. The app could pre-fill the
dialog with the document's own name — it already does (`Untitled.paka`) — but
it cannot know that the user wanted the Desktop.

---

## 10. Commands and test summaries

```powershell
# build (6m 48s, release profile)
pnpm install --frozen-lockfile
$env:PATH = "<WinLibs mingw64\bin>;$env:PATH"
$env:CARGO_TARGET_DIR = "C:\Users\aissa\Desktop\Paka\src-tauri\target"
pnpm tauri build --no-bundle
# -> Finished `release` profile [optimized] target(s) in 6m 48s

# run with the webview debug channel
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=9222"
& "C:\Users\aissa\Desktop\Paka\src-tauri\target\release\paka.exe"
```

The repository's own suites were **not** re-run: this branch changes no
source, and the machine's build slot was reserved for the Rust link. The
figures in circulation (711 tests / 34 files / 19 visual scenes) were not
re-verified here and are not restated as current.

---

## 11. Remaining risks and the next recommended action

| Risk | Severity | Next action |
| --- | --- | --- |
| The packaged app loses 20% of its UI on any scaled display (colour wheel, layers panel, status bar, canvas edge) | **high** | Raise the wry issue (or apply the §5.3 patch), then bump `wry`/`tauri` and regenerate the licence inventory. Until then, a scaled display is effectively unsupported. |
| The default window (1800×1125 physical) does not fit a 1536×816 work area | medium | Decide the launch behaviour: fit the work area, or start maximised |
| The close guard depends on an asynchronous listener registration | medium | Consider the unconditional Rust veto (§7) |
| The `Save first` path of the guard dialog, the Shift/Alt shape constraints, the guide move/delete gestures, the scale/rotate gesture and the layers-panel buttons are untested in the packaged runtime | low | Re-run once the display is at 100% scaling, or on a larger screen, so that the right-hand column is reachable |
| The Layers panel is the only place that exposes *Move layer up / down*, and it is unreachable on a scaled display | medium | Same as defect 1; it is the strongest reason to prioritise the wry fix |

**The single most valuable next step** is to get the wry fix merged and take
the dependency bump: it is the difference between a desktop app that shows
its whole interface and one that hides a fifth of it, and it cannot be
reached from the browser suite.

---

## Appendix — evidence files

`docs/qa/evidence/`

| File | What it shows |
| --- | --- |
| `01-physical-client-1185.png` | What the user actually sees: no colour wheel, no layers panel, no status bar, cut toolbar, cut canvas |
| `02-page-render-1483.png` | What the app itself draws at the same moment: the complete interface, 1483×904 device px |
| `03-close-guard-dialog.jpg` | The unsaved-changes guard vetoing the close |
| `04-file-dialog-save.png` | The native *Save project* dialog |
