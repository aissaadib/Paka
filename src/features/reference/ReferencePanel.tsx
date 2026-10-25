/**
 * References panel: import reference images and manage the ones on the canvas.
 *
 * The panel is a view of the document, never a second source of truth: the
 * list comes from the engine's snapshot, and every action is an editor intent
 * the engine turns into one undoable step. The panel therefore never keeps a
 * copy of a placement - it would drift from the canvas the moment a drag
 * changed the reference.
 *
 * Importing uses the webview's own file input: the user picks the file, the
 * panel reads its bytes and hands them to the engine, and the engine validates
 * and decodes them before anything touches the document. A refused file leaves
 * the open document exactly as it was.
 */

import { useCallback, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Panel } from "../../components/panels/Panel";
import { registerPanel } from "../../core/shell/panelRegistry";
import { referenceImageExtensions } from "../../core/reference/decode";
import type { ReferenceImage } from "../../core/reference/types";
import { useEditor, useEditorState } from "../../hooks/useEditor";
import "./reference.css";

/** The `accept` list of the file input, built from the decoder's own formats. */
const ACCEPT = referenceImageExtensions()
  .map((extension) => `.${extension}`)
  .join(",");

export function ReferencePanel() {
  const { engine, actions } = useEditor();
  const { document: drawingDocument, selectedReferenceId } = useEditorState();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const references = drawingDocument.references;
  const selected = references.find((reference) => reference.id === selectedReferenceId) ?? null;

  const pickFile = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const importFile = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      // Clearing the value lets the user import the same file twice: an input
      // that kept its value would not fire `change` for the second pick.
      event.target.value = "";
      if (!file) {
        return;
      }
      setBusy(true);
      setMessage(null);
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await actions.importReference({ name: file.name, bytes });
        setMessage(result.ok ? null : result.message);
      } catch (error) {
        setMessage(
          error instanceof Error
            ? `The image could not be read: ${error.message}`
            : "The image could not be read.",
        );
      } finally {
        setBusy(false);
      }
    },
    [actions],
  );

  const select = useCallback(
    (reference: ReferenceImage) => {
      engine.setTool("reference");
      actions.selectReference(reference.id);
    },
    [actions, engine],
  );

  return (
    <Panel title="References">
      <div className="reference-panel">
        <div className="reference-panel__actions">
          <button
            type="button"
            className="reference-panel__import"
            onClick={pickFile}
            disabled={busy}
          >
            {busy ? "Importing…" : "Import image…"}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="reference-panel__input"
            data-testid="reference-file-input"
            aria-label="Import a reference image"
            onChange={importFile}
          />
        </div>

        {message === null ? null : (
          <p className="reference-panel__message" role="status">
            {message}
          </p>
        )}

        {references.length === 0 ? (
          <p className="reference-panel__empty">
            No references yet. Import a picture to keep it beside the drawing.
          </p>
        ) : (
          <ul className="reference-panel__list" aria-label="Reference images">
            {references.map((reference) => {
              const isSelected = reference.id === selectedReferenceId;
              return (
                <li
                  key={reference.id}
                  className={
                    isSelected
                      ? "reference-panel__row is-selected"
                      : "reference-panel__row"
                  }
                >
                  <button
                    type="button"
                    className="reference-panel__visibility"
                    aria-pressed={reference.visible}
                    aria-label={`${reference.visible ? "Hide" : "Show"} ${reference.name}`}
                    title={reference.visible ? "Hide" : "Show"}
                    onClick={() =>
                      actions.setReferenceVisible(reference.id, !reference.visible)
                    }
                  >
                    {reference.visible ? "◉" : "○"}
                  </button>
                  <button
                    type="button"
                    className="reference-panel__pick"
                    aria-pressed={isSelected}
                    onClick={() => select(reference)}
                  >
                    <span className="reference-panel__name">{reference.name}</span>
                    <span className="reference-panel__meta">
                      {reference.behind ? "behind artwork" : "over artwork"} ·{" "}
                      {Math.round(reference.rotation)}°
                    </span>
                  </button>
                  <button
                    type="button"
                    className="reference-panel__remove"
                    aria-label={`Remove ${reference.name}`}
                    title="Remove (undoable)"
                    onClick={() => actions.removeReference(reference.id)}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {selected === null ? null : (
          <div className="reference-panel__controls">
            <label className="reference-panel__field">
              <span>Opacity</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={selected.opacity}
                aria-label="Reference opacity"
                onChange={(event) =>
                  actions.setReferenceOpacity(selected.id, Number(event.target.value))
                }
              />
              <span className="reference-panel__value">
                {Math.round(selected.opacity * 100)}%
              </span>
            </label>
            <label className="reference-panel__field">
              <span>Rotation</span>
              <input
                type="range"
                min={0}
                max={359}
                step={1}
                value={Math.round(selected.rotation)}
                aria-label="Reference rotation"
                onChange={(event) =>
                  actions.setReferenceRotation(selected.id, Number(event.target.value))
                }
              />
              <span className="reference-panel__value">
                {Math.round(selected.rotation)}°
              </span>
            </label>
            <label className="reference-panel__check">
              <input
                type="checkbox"
                checked={selected.behind}
                onChange={(event) =>
                  actions.setReferenceBehind(selected.id, event.target.checked)
                }
              />
              <span>Behind the artwork</span>
            </label>
          </div>
        )}

        <p className="reference-panel__hint">
          Press <kbd>Y</kbd> to move, resize and rotate a reference. Drag a corner to
          scale it, the handle above it to turn it. <kbd>Esc</kbd> cancels a drag.
        </p>
      </div>
    </Panel>
  );
}

registerPanel({
  id: "references",
  title: "References",
  slot: "right",
  order: 15,
  icon: "image",
  // The file input and the last import's message live here, so the panel stays
  // mounted while hidden and cannot lose them.
  mounting: "always",
  collapsible: true,
  grow: false,
  description: "Import reference images and manage the ones on the canvas.",
  render: () => <ReferencePanel />,
});
