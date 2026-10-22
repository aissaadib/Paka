/**
 * The reference images panel.
 *
 * The panel is the whole user interface of the references: it imports them,
 * lists them, shows and hides them, removes them, and places the selected one
 * - where it is, how large it is and how opaque it is drawn.
 *
 * Two things the panel deliberately does **not** do:
 *
 *  - it never touches the document. A reference is a picture beside the
 *    canvas, so adding one, moving one or removing one changes no stroke, no
 *    layer and no history entry, and the drawing stays exactly as clean as it
 *    was;
 *  - it never decodes an image twice. The store keeps one decoded copy per
 *    reference, and the thumbnail below is a *scaled draw* of that copy, not a
 *    second decode of the file.
 *
 * The transform is in **workspace pixels** - the canvas' own CSS pixels - so a
 * reference placed here is placed on the screen, not in the drawing. The
 * numbers are therefore the ones the artist sees next to the image, and they
 * do not change when the artwork is zoomed.
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Panel } from "../../components/panels/Panel";
import { IconButton } from "../../components/toolbar/IconButton";
import { SliderField } from "../../components/toolbar/SliderField";
import { IconEye, IconEyeOff, IconPlus, IconTrash } from "../../components/icons";
import { parseNumericInput } from "../../core/brushes/numericInput";
import { referenceScale } from "../../core/reference/geometry";
import type { ReferenceImage } from "../../core/reference/types";
import { registerPanel } from "../../core/shell/panelRegistry";
import { useReferenceState, useReferenceStore } from "../../hooks/useReferences";
import "./reference.css";

/** The smallest and largest scale the size slider offers, in percent. */
const MIN_SCALE_PERCENT = 10;
const MAX_SCALE_PERCENT = 400;

/** The size of a thumbnail, in CSS pixels. */
const THUMBNAIL_SIZE = 34;

export function ReferencePanel() {
  const store = useReferenceStore();
  const { references, selectedId, busy, notice } = useReferenceState();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const selected = references.find((reference) => reference.id === selectedId) ?? null;

  const handleFiles = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // The input is emptied so that choosing the same file again still fires a
      // change event: the browser does not fire one for an unchanged value.
      event.target.value = "";
      for (const file of files) {
        await store.add({ blob: file, name: file.name });
      }
    },
    [store],
  );

  return (
    <Panel
      title="References"
      actions={
        <>
          <IconButton
            label="Add a reference image"
            size="sm"
            disabled={busy}
            onClick={() => {
              inputRef.current?.click();
            }}
          >
            <IconPlus />
          </IconButton>
          <IconButton
            label="Remove every reference"
            size="sm"
            disabled={references.length === 0}
            onClick={() => {
              store.clear();
            }}
          >
            <IconTrash />
          </IconButton>
        </>
      }
      footer={
        <p className="reference__hint">
          A reference is not part of the drawing: it never reaches an export and never makes the
          document unsaved. The colour picker samples the reference under the pointer, and
          Alt+click samples the background colour.
        </p>
      }
    >
      <input
        ref={inputRef}
        className="reference__file"
        type="file"
        accept="image/*"
        multiple
        onChange={handleFiles}
      />

      {notice ? (
        <div className="reference__notice" role="status">
          <span className="reference__notice-text">{notice}</span>
          <button
            type="button"
            className="reference__notice-dismiss"
            onClick={() => {
              store.dismissNotice();
            }}
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {references.length === 0 ? (
        <p className="reference__empty">
          No reference images yet. Add one to trace from it, or to pick its colours with the
          eyedropper.
        </p>
      ) : (
        <ul className="reference-list">
          {references.map((reference) => (
            <ReferenceRow
              key={reference.id}
              reference={reference}
              selected={reference.id === selectedId}
              onSelect={() => {
                store.select(reference.id);
              }}
              onToggleVisibility={() => {
                store.setVisible(reference.id, !reference.visible);
              }}
              onRemove={() => {
                store.remove(reference.id);
              }}
            />
          ))}
        </ul>
      )}

      {selected ? <ReferenceControls reference={selected} /> : null}
    </Panel>
  );
}

interface ReferenceRowProps {
  readonly reference: ReferenceImage;
  readonly selected: boolean;
  readonly onSelect: () => void;
  readonly onToggleVisibility: () => void;
  readonly onRemove: () => void;
}

function ReferenceRow({
  reference,
  selected,
  onSelect,
  onToggleVisibility,
  onRemove,
}: ReferenceRowProps) {
  const store = useReferenceStore();
  const source = store.sourceFor(reference.id);

  return (
    <li className={selected ? "reference-row is-selected" : "reference-row"}>
      <button
        type="button"
        className="reference-row__select"
        onClick={onSelect}
        aria-pressed={selected}
        title={`Select ${reference.name}`}
      >
        <ReferenceThumbnail source={source} width={reference.width} height={reference.height} />
        <span className="reference-row__name">{reference.name}</span>
      </button>
      <IconButton
        label={reference.visible ? `Hide ${reference.name}` : `Show ${reference.name}`}
        size="sm"
        active={reference.visible}
        onClick={onToggleVisibility}
      >
        {reference.visible ? <IconEye /> : <IconEyeOff />}
      </IconButton>
      <IconButton label={`Remove ${reference.name}`} size="sm" onClick={onRemove}>
        <IconTrash />
      </IconButton>
    </li>
  );
}

interface ReferenceThumbnailProps {
  readonly source: CanvasImageSource | null;
  readonly width: number;
  readonly height: number;
}

/**
 * A small preview of a reference.
 *
 * The preview is a *draw* of the decoded copy, scaled into a square: it costs
 * one small canvas and no extra memory of the image itself.
 */
function ReferenceThumbnail({ source, width, height }: ReferenceThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const pixels = Math.round(THUMBNAIL_SIZE * dpr);
    if (canvas.width !== pixels) {
      canvas.width = pixels;
    }
    if (canvas.height !== pixels) {
      canvas.height = pixels;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, THUMBNAIL_SIZE, THUMBNAIL_SIZE);
    if (!source || width <= 0 || height <= 0) {
      return;
    }
    // The thumbnail keeps the reference's own aspect ratio and is centred in
    // the square, so a wide reference is not cropped.
    const factor = Math.min(THUMBNAIL_SIZE / width, THUMBNAIL_SIZE / height);
    const drawWidth = width * factor;
    const drawHeight = height * factor;
    ctx.drawImage(
      source,
      (THUMBNAIL_SIZE - drawWidth) / 2,
      (THUMBNAIL_SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  }, [source, width, height]);

  return (
    <canvas
      className="reference-row__thumb"
      ref={canvasRef}
      style={{ width: THUMBNAIL_SIZE, height: THUMBNAIL_SIZE }}
      aria-hidden="true"
    />
  );
}

interface ReferenceControlsProps {
  readonly reference: ReferenceImage;
}

/** The placement controls of the selected reference. */
function ReferenceControls({ reference }: ReferenceControlsProps) {
  const store = useReferenceStore();
  const scalePercent = Math.round(referenceScale(reference) * 100);

  return (
    <div className="reference-controls">
      <SliderField
        label="Size"
        min={MIN_SCALE_PERCENT}
        max={MAX_SCALE_PERCENT}
        step={1}
        value={scalePercent}
        format={(value) => `${Math.round(value)}%`}
        title="How large the reference is drawn, relative to its own size"
        onChange={(value) => {
          store.setScale(reference.id, value / 100);
        }}
      />
      <SliderField
        label="Opacity"
        min={0}
        max={100}
        step={1}
        value={Math.round(reference.opacity * 100)}
        format={(value) => `${Math.round(value)}%`}
        title="How opaque the reference is drawn"
        onChange={(value) => {
          store.setOpacity(reference.id, value / 100);
        }}
      />
      <div className="reference-controls__position">
        <NumberField
          label="X"
          value={Math.round(reference.x)}
          onChange={(x) => {
            store.setPosition(reference.id, x, reference.y);
          }}
        />
        <NumberField
          label="Y"
          value={Math.round(reference.y)}
          onChange={(y) => {
            store.setPosition(reference.id, reference.x, y);
          }}
        />
      </div>
      <div className="reference-controls__actions">
        <button
          type="button"
          className="reference-controls__button"
          onClick={() => {
            store.fitToView(reference.id);
          }}
          title="Fit the reference into the canvas"
        >
          Fit
        </button>
        <button
          type="button"
          className="reference-controls__button"
          onClick={() => {
            store.resetSize(reference.id);
          }}
          title="Show the reference at its own size"
        >
          Reset
        </button>
        <button
          type="button"
          className="reference-controls__button"
          onClick={() => {
            store.center(reference.id);
          }}
          title="Move the reference to the middle of the canvas"
        >
          Centre
        </button>
      </div>
    </div>
  );
}

interface NumberFieldProps {
  readonly label: string;
  readonly value: number;
  readonly onChange: (value: number) => void;
}

/**
 * A number box for a workspace coordinate.
 *
 * The box is a text field first: it keeps what was typed until it is a number
 * the field accepts, so clearing it to type a new value does not move the
 * reference to a corner in the meantime.
 */
function NumberField({ label, value, onChange }: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) => {
      if (current === null) {
        return null;
      }
      const parsed = parseNumericInput(current);
      return parsed !== null && parsed !== value ? null : current;
    });
  }, [value]);

  return (
    <label className="reference-controls__field">
      <span className="reference-controls__field-label">{label}</span>
      <input
        className="text-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={`${label} position in workspace pixels`}
        value={draft ?? String(value)}
        onChange={(event) => {
          const text = event.target.value;
          setDraft(text);
          const parsed = parseNumericInput(text);
          if (parsed !== null) {
            onChange(parsed);
          }
        }}
        onBlur={() => {
          setDraft(null);
        }}
      />
    </label>
  );
}

registerPanel({
  id: "references",
  title: "References",
  slot: "right",
  order: 8,
  icon: "image",
  // The panel shows what the reference store holds and keeps no state of its
  // own, so unmounting it costs nothing.
  mounting: "when-visible",
  collapsible: true,
  grow: false,
  description: "Images kept beside the canvas, to trace from and to sample colours.",
  render: () => <ReferencePanel />,
});
