/**
 * File service tests.
 *
 * `ProjectFiles` is the only place that sequences "ask for a path, move bytes,
 * update the engine", so these tests drive it against an in-memory gateway and
 * a real engine: the whole save/open/export workflow runs in Node, without
 * Tauri and without a rasterizer (the canvas is the recording stand-in).
 *
 * The properties being pinned down are the ones a user would notice:
 * a saved drawing comes back, a corrupt file changes nothing, and a failed
 * write does not pretend the work is safe.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import type { StrokeSource } from "../core/document/types";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { ProjectFiles } from "../core/project/projectFiles";
import { parseProject } from "../core/project/projectFormat";
import { Canvas2DRenderer } from "../core/rendering/Canvas2DRenderer";
import { FrameScheduler } from "../core/rendering/frameScheduler";
import type { PointerSample } from "../types/pointer";
import { MemoryProjectGateway } from "./support/memoryGateway";
import { installRecordingDocument, PNG_SIGNATURE, RecordingCanvas, type RecordingDocument } from "./support/recordingCanvas";

const PROJECT_PATH = "C:\\art\\cat.paka";

function sample(x: number, y: number): PointerSample {
  return {
    phase: "move",
    pointerId: 1,
    kind: "pen",
    isPrimary: true,
    button: 0,
    buttons: 1,
    docX: x,
    docY: y,
    screenX: x,
    screenY: y,
    pressure: 0.6,
    hasPressure: true,
    tiltX: 0,
    tiltY: 0,
    timeStamp: 0,
    modifiers: { shift: false, alt: false, ctrl: false, meta: false },
  };
}

/** Paints one four-point stroke, the way the input layer would. */
function paintStroke(engine: DrawingEngine, offset: number): void {
  engine.beginStroke(sample(offset, offset));
  engine.extendStroke(sample(offset + 4, offset + 2));
  engine.extendStroke(sample(offset + 8, offset + 6));
  engine.finishStroke();
}

interface Harness {
  readonly engine: DrawingEngine;
  readonly files: ProjectFiles;
  readonly gateway: MemoryProjectGateway;
  readonly recording: RecordingDocument;
  readonly display: RecordingCanvas;
}

/** Engine + file service, with a recording renderer so export can run. */
function createHarness(options: { readonly withRenderer?: boolean } = {}): Harness {
  const recording = installRecordingDocument();
  const display = new RecordingCanvas();
  // The drawing's own name is deliberately different from the file name, to
  // pin down that the two are independent.
  const drawingDocument = createDocument({ name: "Study", width: 200, height: 120 });

  // The renderer reads strokes through a source that is pointed at the engine
  // once it exists; the renderer only ever calls it lazily.
  const source: { listStrokes: StrokeSource["listStrokes"] } = { listStrokes: () => [] };
  const renderer =
    options.withRenderer === false
      ? undefined
      : new Canvas2DRenderer({
          canvas: display.asElement(),
          strokeSource: source,
          rasterScale: 1,
          scheduler: new FrameScheduler({ requestFrame: () => 1, cancelFrame: () => {} }),
        });

  const engine = new DrawingEngine({ document: drawingDocument, renderer });
  source.listStrokes = (layerId) => engine.listStrokes(layerId);

  const gateway = new MemoryProjectGateway();
  return { engine, files: new ProjectFiles(engine, gateway), gateway, recording, display };
}

let harness: Harness;

beforeEach(() => {
  harness = createHarness();
});

afterEach(() => {
  harness.recording.restore();
});

describe("saving", () => {
  it("asks for a path the first time and appends the project extension", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    gateway.savePath = "C:\\art\\cat";

    const outcome = await files.save();

    expect(outcome).toEqual({ status: "saved", path: PROJECT_PATH });
    expect(gateway.saveSuggestions).toEqual(["Study.paka"]);
    expect([...gateway.files.keys()]).toEqual([PROJECT_PATH]);
    expect(files.path).toBe(PROJECT_PATH);
    expect(files.hasUnsavedChanges).toBe(false);
    // The drawing keeps its own name: the file is named after it, not the other
    // way round, so the name the user typed is what the file records.
    expect(engine.getState().document.name).toBe("Study");
    const written = parseProject(gateway.files.get(PROJECT_PATH) ?? "");
    expect(written.ok && written.project.document.name).toBe("Study");
  });

  it("writes the file it just saved to again, without a dialog", async () => {
    const { files, gateway, engine } = harness;
    gateway.savePath = PROJECT_PATH;
    await files.save();
    paintStroke(engine, 0);

    const outcome = await files.save();

    expect(outcome).toEqual({ status: "saved", path: PROJECT_PATH });
    expect(gateway.saveSuggestions).toHaveLength(1);
    expect(gateway.writes).toEqual([PROJECT_PATH, PROJECT_PATH]);
    expect(files.hasUnsavedChanges).toBe(false);
  });

  it("offers the current file name when saving under a new name", async () => {
    const { files, gateway } = harness;
    gateway.savePath = PROJECT_PATH;
    await files.save();
    gateway.savePath = "C:\\art\\cat-copy.paka";

    await files.saveAs();

    expect(gateway.saveSuggestions).toEqual(["Study.paka", "cat.paka"]);
    expect(files.path).toBe("C:\\art\\cat-copy.paka");
  });

  it("changes nothing when the dialog is dismissed", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    gateway.savePath = null;

    const outcome = await files.saveAs();

    expect(outcome).toEqual({ status: "cancelled" });
    expect(gateway.files.size).toBe(0);
    expect(files.hasUnsavedChanges).toBe(true);
    expect(files.path).toBeNull();
  });

  it("keeps the unsaved marker when the write fails", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    gateway.savePath = PROJECT_PATH;
    gateway.writeFailure = "There is not enough space on the disk.";

    const outcome = await files.saveAs();

    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" ? outcome.message : "").toContain("not enough space");
    expect(outcome.status === "error" ? outcome.message : "").toContain("cat.paka");
    expect(gateway.files.size).toBe(0);
    expect(files.path).toBeNull();
    expect(files.hasUnsavedChanges).toBe(true);

    // Retrying works, and only then is the document considered safe.
    gateway.writeFailure = null;
    expect((await files.saveAs()).status).toBe("saved");
    expect(files.hasUnsavedChanges).toBe(false);
  });
});

describe("opening", () => {
  it("restores the saved drawing, its size, its name and its strokes", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    paintStroke(engine, 20);
    gateway.savePath = PROJECT_PATH;
    await files.save();

    // Throw the drawing away, then read it back from the "disk".
    files.newDocument({ name: "Untitled", width: 100, height: 100 });
    expect(engine.getState().document.width).toBe(100);
    expect(engine.listStrokes(engine.getState().document.layers[0].id)).toHaveLength(0);

    gateway.openPath = PROJECT_PATH;
    const outcome = await files.open();

    expect(outcome).toEqual({ status: "opened", path: PROJECT_PATH, warnings: [] });
    const { document, file } = engine.getState();
    expect(document.width).toBe(200);
    expect(document.height).toBe(120);
    // The drawing's name came from the file, not from the file name.
    expect(document.name).toBe("Study");
    expect(engine.listStrokes(document.layers[0].id)).toHaveLength(2);
    expect(file).toEqual({ path: PROJECT_PATH, dirty: false });
  });

  it("reports how many strokes were loaded as undoable history", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    paintStroke(engine, 20);
    gateway.savePath = PROJECT_PATH;
    await files.save();
    gateway.openPath = PROJECT_PATH;
    await files.open();

    // Both strokes can still be undone one at a time: a reopened project stays
    // editable instead of arriving as one flat image.
    expect(engine.getState().history.depth).toBe(2);
    engine.undo();
    expect(engine.listStrokes(engine.getState().document.layers[0].id)).toHaveLength(1);
  });

  it("leaves the current drawing untouched when the file is corrupt", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    const before = engine.getState();
    const beforeStrokes = engine.listStrokes(before.document.layers[0].id).length;
    gateway.files.set(PROJECT_PATH, "{\"format\":\"paka-project\",\"version\":1,\"layers\":\"nope\"}");
    gateway.openPath = PROJECT_PATH;

    const outcome = await files.open();

    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" ? outcome.message : "").toContain("cat.paka could not be opened");
    const after = engine.getState();
    expect(after.document).toBe(before.document);
    expect(engine.listStrokes(after.document.layers[0].id)).toHaveLength(beforeStrokes);
    expect(after.file.path).toBeNull();
    expect(after.file.dirty).toBe(true);
  });

  it("refuses a project written by a newer version of Paka", async () => {
    const { files, gateway } = harness;
    gateway.files.set(
      PROJECT_PATH,
      '{"format":"paka-project","version":99,"document":{},"layers":[]}',
    );
    gateway.openPath = PROJECT_PATH;

    const outcome = await files.open();

    expect(outcome.status).toBe("error");
    expect(outcome.status === "error" ? outcome.message : "").toContain("newer version of Paka");
  });

  it("reports a file that cannot be read", async () => {
    const { files, gateway } = harness;
    gateway.openPath = PROJECT_PATH;
    gateway.readFailure = "Access is denied.";

    const outcome = await files.open();

    expect(outcome).toEqual({
      status: "error",
      message: 'Opening "cat.paka" failed: Access is denied.',
    });
  });

  it("does nothing when the open dialog is dismissed", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    gateway.openPath = null;

    expect(await files.open()).toEqual({ status: "cancelled" });
    expect(engine.getState().file.dirty).toBe(true);
  });
});

describe("exporting a PNG", () => {
  it("writes PNG bytes next to the project without touching the drawing", async () => {
    const { files, gateway, engine } = harness;
    paintStroke(engine, 0);
    const before = engine.getState();
    gateway.pngPath = "C:\\art\\cat";

    const outcome = await files.exportPng();

    expect(outcome).toEqual({ status: "exported", path: "C:\\art\\cat.png", bytes: 8 });
    expect(gateway.binaries.get("C:\\art\\cat.png")).toEqual(PNG_SIGNATURE);
    expect(gateway.pngSuggestions).toEqual(["Study.png"]);
    // Export is not a save: the drawing is untouched and still unsaved.
    const after = engine.getState();
    expect(after.document).toBe(before.document);
    expect(after.file).toBe(before.file);
    expect(after.file.dirty).toBe(true);
  });

  it("names the export after the project once it has a file name", async () => {
    const { files, gateway } = harness;
    gateway.savePath = PROJECT_PATH;
    await files.save();
    gateway.pngPath = "C:\\art\\whatever";

    await files.exportPng();

    expect(gateway.pngSuggestions).toEqual(["cat.png"]);
    expect([...gateway.binaries.keys()]).toEqual(["C:\\art\\whatever.png"]);
  });

  it("explains that there is nothing to export without a drawing surface", async () => {
    const bare = createHarness({ withRenderer: false });
    try {
      bare.gateway.pngPath = "C:\\art\\cat.png";

      const outcome = await bare.files.exportPng();

      expect(outcome.status).toBe("error");
      expect(outcome.status === "error" ? outcome.message : "").toContain("could not be encoded");
    } finally {
      bare.recording.restore();
    }
  });

  it("changes nothing when the export dialog is dismissed", async () => {
    const { files, gateway } = harness;
    gateway.pngPath = null;

    expect(await files.exportPng()).toEqual({ status: "cancelled" });
    expect(gateway.binaries.size).toBe(0);
  });
});
