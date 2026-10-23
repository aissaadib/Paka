# New Document canvas presets - implementation report

Branch: `feat/bigger-canvas-sizes`

## Objective

Make the larger canvas sizes one click in the New Document dialog instead of
requiring the width and height to be typed by hand, without changing the
document raster policy.

## What changed

- `src/core/document/canvasSizePresets.ts` adds six presets: Full HD, QHD,
  4K UHD, A4 at 300 dpi, Panorama (8192 x 2048), and the largest allowed
  square (4096 x 4096). The list is pure data plus the rounded comparison used
  for the selected state.
- `src/features/document/NewDocumentDialog.tsx` renders the presets as a
  two-column group. Choosing one fills both number fields, and `aria-pressed`
  follows the current values.
- `src/app/app.css` adds the dialog preset grid and the active/focus styling.
- `AGENTS.md` records the new module, task path, symbols, and test map entry.

## Limits

The raster policy is deliberately unchanged. Every preset passes
`isValidDocumentSize`:

- 8 to 8192 px per side;
- at most 16,777,216 px in total;
- 4096 x 4096 is the largest square, and 8192 x 2048 is the widest shape at
  the cap.

The A4 preset is the pixel size at 300 dpi, not a new physical-unit model:
the editor has no dpi concept. There is no project-format change and no new
dependency.

## Verification

Run in `D:/Dev/Paka-overnight-worktrees/integration` on the branch above:

| Command | Result |
| --- | --- |
| `pnpm exec vitest run src/test/canvasSizePresets.test.ts` | 1 file, 4 tests passed |
| `pnpm typecheck` | clean |
| `pnpm test` | 94 files, 2,370 tests passed |
| `pnpm test:visual` | 81 tests passed (includes the new size spec) |
| `pnpm build` | exit 0; only the existing 500 kB chunk-size warning |

The first targeted visual run failed because the assertion expected ASCII
`x` while the status bar prints `×` (`3840 × 2160 px`). The assertion was
corrected; the rerun passed. No test was skipped.

## Files

- `src/core/document/canvasSizePresets.ts`
- `src/features/document/NewDocumentDialog.tsx`
- `src/app/app.css`
- `src/test/canvasSizePresets.test.ts`
- `tests/visual/new-document-sizes.spec.ts`
- `AGENTS.md`

## Follow-up

If "bigger" means a canvas larger than 4096 x 4096, that is a raster-budget
decision rather than a dialog change. The current model keeps three 2x RGBA
surfaces plus a scan buffer inside a 1 GiB budget; a larger document would
need a lower raster scale or a different surface strategy, designed and
verified separately.
