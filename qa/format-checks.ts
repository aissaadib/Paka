/**
 * QA verification of the project-format criteria (AC-02, AC-10, AC-11).
 *
 * The v9 reader is the working tree's `projectFormat.ts`; the v8 reader is the
 * committed one (qa/head/projectFormat.ts). Both are exercised with crafted
 * files so the acceptance criteria can be checked directly.
 */
import * as v9 from "/src/core/project/projectFormat";
import * as v8 from "/qa/head/projectFormat";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

const results: any[] = [];
const record = (id: string, name: string, data: any): void => {
  results.push({ id, name, ...data });
};

const BASE_STROKE = {
  id: "s1",
  layerId: "l1",
  brush: {
    size: 6,
    opacity: 1,
    color: "#16181c",
    hardness: 1,
    pressureSize: 0.6,
    pressureOpacity: 0,
    minSizeRatio: 0.12,
    spacing: 0.12,
    stabilizer: 0,
    texture: 0,
  },
  xs: [1, 2, 3],
  ys: [1, 2, 3],
  pressures: [1, 1, 1],
  times: [0, 16, 32],
  startTime: 0,
};

function project(version: number, brushPatch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    format: "paka-project",
    version,
    document: {
      id: "d1",
      name: "Test",
      width: 64,
      height: 64,
      background: "#ffffff",
      layers: [{ id: "l1", name: "Layer 1", visible: true, opacity: 1, blendMode: "normal" }],
      activeLayerId: "l1",
    },
    strokes: [
      {
        ...BASE_STROKE,
        brush: { ...BASE_STROKE.brush, ...brushPatch },
      },
    ],
  });
}

/**
 * A real file, produced by the serializer, so the checks exercise the format
 * as it is written and not a hand-made approximation of it.
 */
function serializedProject(stamp = true): string {
  const document = {
    id: "d1",
    name: "Test",
    width: 64,
    height: 64,
    background: "#ffffff",
    layers: [
      {
        id: "l1",
        name: "Layer 1",
        visible: true,
        opacity: 1,
        blendMode: "normal" as const,
      },
    ],
    activeLayerId: "l1",
  };
  const strokes = [
    {
      ...BASE_STROKE,
      brush: {
        ...BASE_STROKE.brush,
        stamp,
        stampSpacing: 0.2,
        stampHardness: 0.5,
      },
    },
  ];
  const source = {
    listStrokes: () => strokes,
    listElements: () => strokes,
  };
  return v9.serializeProject(document as any, source as any);
}

export async function runFormatChecks(): Promise<any> {
  results.length = 0;

  record("AC-10", "the format version is bumped and the stamp fields are required", {
    v9Version: v9.PROJECT_VERSION,
    v8Version: v8.PROJECT_VERSION,
    bumped: v9.PROJECT_VERSION === 9 && v8.PROJECT_VERSION === 8,
  });

  // A real v9 file: written by the serializer, read back by the parser.
  const written = serializedProject(true);
  const withFields = v9.parseProject(written);
  record("AC-10", "a v9 file written by the serializer parses", {
    ok: withFields.ok,
    version: withFields.ok ? (withFields.project as any).document.id : null,
    stamp: withFields.ok ? (withFields.project as any).strokes[0].brush.stamp : null,
    stampSpacing: withFields.ok ? (withFields.project as any).strokes[0].brush.stampSpacing : null,
    stampHardness: withFields.ok ? (withFields.project as any).strokes[0].brush.stampHardness : null,
    error: withFields.ok ? null : withFields.error,
  });

  // The same file with one stamp field removed must be refused.
  const parsedJson = JSON.parse(written);
  const brushPath = parsedJson.layers[0].strokes
    ? parsedJson.layers[0].strokes[0].brush
    : parsedJson.layers[0].elements[0].brush;
  const withoutStamp = { ...parsedJson };
  const layers = JSON.parse(JSON.stringify(parsedJson.layers));
  const target = layers[0].strokes ? layers[0].strokes[0].brush : layers[0].elements[0].brush;
  delete target.stamp;
  withoutStamp.layers = layers;
  const missingStamp = v9.parseProject(JSON.stringify(withoutStamp));
  record("AC-11", "the v9 reader refuses a v9 file that omits the stamp flag", {
    ok: missingStamp.ok,
    error: missingStamp.ok ? null : missingStamp.error,
    refused: missingStamp.ok === false,
  });

  const withoutSpacing = JSON.parse(JSON.stringify(parsedJson));
  const target2 = withoutSpacing.layers[0].strokes
    ? withoutSpacing.layers[0].strokes[0].brush
    : withoutSpacing.layers[0].elements[0].brush;
  delete target2.stampSpacing;
  const missingSpacing = v9.parseProject(JSON.stringify(withoutSpacing));
  record("AC-11", "the v9 reader refuses a v9 file with no stamp spacing", {
    ok: missingSpacing.ok,
    error: missingSpacing.ok ? null : missingSpacing.error,
    refused: missingSpacing.ok === false,
  });

  // The committed v8 reader refuses a v9 file.
  const oldReaderOnNewFile = v8.parseProject(written);
  record("AC-11", "the committed v8 reader refuses a v9 file", {
    ok: oldReaderOnNewFile.ok,
    error: oldReaderOnNewFile.ok ? null : oldReaderOnNewFile.error,
    refused: oldReaderOnNewFile.ok === false,
  });

  // A v8 file (no stamp fields at all) still parses, with the stamp off.
  for (const version of [1, 4, 6, 7, 8]) {
    const legacy = JSON.parse(JSON.stringify(parsedJson));
    legacy.version = version;
    const layer = legacy.layers[0];
    const brush = layer.strokes ? layer.strokes[0].brush : layer.elements[0].brush;
    delete brush.stamp;
    delete brush.stampSpacing;
    delete brush.stampHardness;
    const parsed = v9.parseProject(JSON.stringify(legacy));
    record("AC-02", `a v${version} file still parses with the stamp off`, {
      ok: parsed.ok,
      stamp: parsed.ok ? (parsed.project as any).strokes[0].brush.stamp : null,
      stampSpacing: parsed.ok ? (parsed.project as any).strokes[0].brush.stampSpacing : null,
      error: parsed.ok ? null : parsed.error,
    });
  }

  // The parsed brush of a legacy file is otherwise the old brush.
  const legacy8 = JSON.parse(JSON.stringify(parsedJson));
  legacy8.version = 8;
  const legacyLayer = legacy8.layers[0];
  const legacyBrush = legacyLayer.strokes
    ? legacyLayer.strokes[0].brush
    : legacyLayer.elements[0].brush;
  delete legacyBrush.stamp;
  delete legacyBrush.stampSpacing;
  delete legacyBrush.stampHardness;
  const parsedV8 = v9.parseProject(JSON.stringify(legacy8));
  const brushV8 = parsedV8.ok ? (parsedV8.project as any).strokes[0].brush : null;
  const expected = {
    size: 6,
    opacity: 1,
    color: "#16181c",
    hardness: 1,
    pressureSize: 0.6,
    pressureOpacity: 0,
    minSizeRatio: 0.12,
    spacing: 0.12,
    stabilizer: 0,
    texture: 0,
    stamp: false,
    stampSpacing: 0.1,
    stampHardness: 1,
  };
  record("AC-02", "the parsed brush of a legacy file is the old brush plus the stamp fields", {
    actual: brushV8,
    equal: JSON.stringify(brushV8) === JSON.stringify(expected),
  });

  return { at: new Date().toISOString(), results };
}

(window as any).__qaFormat = { runFormatChecks };
