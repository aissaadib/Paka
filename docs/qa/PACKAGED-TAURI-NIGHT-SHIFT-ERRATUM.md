# Erratum — packaged Tauri desktop verification

**Corrects:** `docs/qa/PACKAGED-TAURI-NIGHT-SHIFT.md` (commit `d11073c`),
**"Defect 1 (severe) — on a scaled display the app loses 20 % of its interface"**.
**Date:** 2026-10-21
**Status of the original report:** preserved unchanged. This file is the
correction, not a rewrite.

---

## 1. What is withdrawn

The original report concluded that on a 125 % display the packaged app renders a
layout viewport one DPI step too large, so the right-hand fifth of the interface
is drawn outside the window. It attributed this to `wry 0.57.0` passing
**physical** pixels to `ICoreWebView2Controller::SetBounds`, which it assumed
takes **device-independent pixels**.

**That conclusion is wrong.** The app renders correctly at 125 %. There is no
clipping defect, no double-scaling, and nothing to patch in `wry`, Tauri or
Paka. The assumption about `SetBounds` was never verified, and the geometry that
appeared to support it was measured in the wrong units (§2).

Do not reopen the upstream dependency question without new evidence. No
dependency, lockfile, licence inventory or notice change is justified by this
finding, because the finding is not real.

## 2. Why the measurement was wrong

The harness read `GetClientRect` (window client area) and
`[System.Windows.Forms.Screen]::Bounds` from **Windows PowerShell 5.1**, which is
**DPI-unaware**. For an unaware caller Windows virtualises these APIs and
returns **DIPs**, not physical pixels.

`window.innerWidth` / `innerHeight` are also DIPs (CSS pixels). Comparing one
DIP value against another made the layout viewport look equal to the "physical"
client area, which reads as a 1.25× over-scale. Every number in the original
report is a DIP figure:

| Reported as physical | Actually | Physical |
| --- | --- | --- |
| screen 1536 × 864 | 1536 × 864 DIP | **1920 × 1080** |
| client 1185 × 722 | 1185 × 722 DIP | 1481 × 902 |
| client 1440 × 844 | 1440 × 844 DIP | **1800 × 1055** |

The pixel-diff check in the original report compared a DIP-sized capture against
a device-pixel render, so its "clipped 5.09 vs scaled 52.95" verdict carried no
information either way.

## 3. Corrected measurement

Taken with the calling thread switched to per-monitor-v2 awareness before any
geometry was read:

```
SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) // -4
GetClientRect(hwnd)      -> 1800 x 1055 physical
GetSystemMetrics(0/1)    -> 1920 x 1080 physical
GetDpiForWindow(hwnd)    -> 120 (125 %)
```

Page truth, read over CDP:

```
innerWidth  = 1440        innerHeight = 844
devicePixelRatio = 1.25
```

1800 ÷ 1.25 = **1440**, and 1055 ÷ 1.25 = **844**. Exact. The layout viewport
matches the client area in DIPs, and the raster is 1440 × 1.25 = 1800 device
pixels into an 1800-pixel host. The viewport is correct.

A window-scoped capture at 125 % (physical resolution, `PrintWindow` with
`PW_RENDERFULLCONTENT`) shows the complete interface — menu bar, toolbar, brush
controls, tool rail, canvas, colour wheel with Hue/Saturation/Value and hex,
layers panel, and the status bar — with nothing clipped.

## 4. What the original report got right

* **"Defect 2" stands.** The default window (1440 × 900 logical) does not fit
  the usable work area at 125 %. On this machine the logical work area is
  1536 × 816, so a 900-logical-tall window cannot fit. Observed window rect:
  **1818 × 1102 physical at (102, 0)** against a **1920 × 1020** work area — the
  bottom 82 px sit past the work area and the last 22 px are off-screen, so the
  status bar is partly covered by the taskbar. This is a **sizing** defect, not
  a scaling defect, and it is fixed at application level by clamping the initial
  size to the work area (see the integration log for the landed fix).

* **"Defect 1" is withdrawn, not minimised.** Everything else in the report —
  startup/shutdown, brush, polygon, star, guides, undo/redo, native save/open/
  export, dirty marker, selection and duplicate, the close guard and its
  dialog — was verified with the packaged executable and is unaffected by this
  correction. Note that the close guard was observed to bypass twice in unusual
  states; its cause is still unproven and should not be treated as settled.

## 5. Method rule for every future packaged run

1. Switch the measuring thread/process to per-monitor-v2 **before** reading any
   geometry.
2. Record whether each number is physical or DIP.
3. Assert the invariant rather than eyeballing it:
   `|innerWidth − clientPhysical / dpr| ≤ 1` and
   `|innerHeight − clientPhysicalH / dpr| ≤ 1`.
4. Never compare a screen capture against a page render without confirming both
   are in the same unit.
