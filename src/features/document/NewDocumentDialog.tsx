/**
 * New document dialog.
 *
 * Validates the size against the document model's supported range before the
 * engine is asked to create anything.
 */

import { useEffect, useState } from "react";
import {
  DEFAULT_DOCUMENT_BACKGROUND,
  MAX_DOCUMENT_PIXELS,
  MAX_DOCUMENT_SIZE,
  MIN_DOCUMENT_SIZE,
  isValidDocumentSize,
} from "../../core/document/document";
import {
  CANVAS_SIZE_PRESETS,
  isCanvasSizePresetSelected,
} from "../../core/document/canvasSizePresets";
import type { NewDocumentOptions } from "../../core/engine/DrawingEngine";

export interface NewDocumentDialogProps {
  readonly onCancel: () => void;
  readonly onCreate: (options: NewDocumentOptions) => void;
}

export function NewDocumentDialog({ onCancel, onCreate }: NewDocumentDialogProps) {
  const [name, setName] = useState("Untitled");
  const [width, setWidth] = useState(1600);
  const [height, setHeight] = useState(1200);

  const valid = isValidDocumentSize(width, height);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const create = () => {
    if (!valid) {
      return;
    }
    onCreate({
      name: name.trim() === "" ? "Untitled" : name.trim(),
      width: Math.round(width),
      height: Math.round(height),
      background: DEFAULT_DOCUMENT_BACKGROUND,
    });
  };

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="new-document-title">
        <h2 className="dialog__title" id="new-document-title">
          New Document
        </h2>
        <label className="dialog__field">
          <span>Name</span>
          <input
            className="text-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                create();
              }
            }}
          />
        </label>
        <div className="dialog__presets" role="group" aria-label="Canvas size presets">
          {CANVAS_SIZE_PRESETS.map((preset) => {
            const selected = isCanvasSizePresetSelected(preset, width, height);
            return (
              <button
                key={preset.id}
                type="button"
                className={selected ? "dialog__preset is-active" : "dialog__preset"}
                aria-pressed={selected}
                title={`${preset.width} x ${preset.height} pixels`}
                onClick={() => {
                  setWidth(preset.width);
                  setHeight(preset.height);
                }}
              >
                <span className="dialog__preset-label">{preset.label}</span>
                <span className="dialog__preset-size">
                  {preset.width} x {preset.height}
                </span>
              </button>
            );
          })}
        </div>
        <div className="dialog__row">
          <label className="dialog__field">
            <span>Width</span>
            <input
              className="text-input"
              type="number"
              min={MIN_DOCUMENT_SIZE}
              max={MAX_DOCUMENT_SIZE}
              value={width}
              onChange={(event) => setWidth(Number(event.target.value))}
            />
          </label>
          <label className="dialog__field">
            <span>Height</span>
            <input
              className="text-input"
              type="number"
              min={MIN_DOCUMENT_SIZE}
              max={MAX_DOCUMENT_SIZE}
              value={height}
              onChange={(event) => setHeight(Number(event.target.value))}
            />
          </label>
        </div>
        <p className={valid ? "dialog__note" : "dialog__error"}>
          {valid
            ? "Pixels. Layer and brush sizes follow the document resolution."
            : `Size must be between ${MIN_DOCUMENT_SIZE} and ${MAX_DOCUMENT_SIZE} px per side, ` +
              `and at most ${MAX_DOCUMENT_PIXELS.toLocaleString("en-US")} px in total, so a ` +
              `large document cannot ask for a multi-gigabyte raster surface.`}
        </p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="button button--primary" disabled={!valid} onClick={create}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
