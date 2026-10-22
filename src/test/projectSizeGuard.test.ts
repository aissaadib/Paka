/**
 * Project-load size guardrails.
 *
 * A project is parsed before the engine replaces the open document, so this is
 * the last cheap point to reject dimensions that would allocate an unsafe
 * raster surface. These tests mutate only JSON metadata; no canvas is created.
 */

import { describe, expect, it } from "vitest";
import { createDocument } from "../core/document/document";
import type { StrokeSource } from "../core/document/types";
import type { DrawingEngine } from "../core/engine/DrawingEngine";
import { ProjectFiles } from "../core/project/projectFiles";
import type { ProjectFileGateway } from "../core/project/projectGateway";
import { parseProject, serializeProject } from "../core/project/projectFormat";

const emptyStore: StrokeSource = {
  listStrokes: () => [],
  listElements: () => [],
};

interface RawProjectLike {
  document: { width?: unknown; height?: unknown; [key: string]: unknown };
  layers: unknown[];
  [key: string]: unknown;
}

function projectText(width: unknown, height: unknown, layers?: unknown[]): string {
  const document = createDocument({ name: "Size guard", width: 8, height: 8 });
  const raw = JSON.parse(serializeProject(document, emptyStore)) as RawProjectLike;
  raw.document.width = width;
  raw.document.height = height;
  if (layers !== undefined) {
    raw.layers = layers;
  }
  return JSON.stringify(raw);
}

function rejectionOf(text: string): string {
  const parsed = parseProject(text);
  expect(parsed.ok, "expected the project to be refused").toBe(false);
  return parsed.ok ? "" : parsed.error;
}

class OversizedFileGateway implements ProjectFileGateway {
  constructor(private readonly text: string) {}

  async pickProjectToOpen(): Promise<string | null> {
    return "C:\\art\\huge.paka";
  }

  async pickProjectToSave(): Promise<string | null> {
    return null;
  }

  async pickPngToSave(): Promise<string | null> {
    return null;
  }

  async pickPresetLibraryToOpen(): Promise<string | null> {
    return null;
  }

  async pickPresetLibraryToSave(): Promise<string | null> {
    return null;
  }

  async readTextFile(): Promise<string> {
    return this.text;
  }

  async writeTextFile(): Promise<void> {
    throw new Error("unexpected write");
  }

  async writeBinaryFile(): Promise<void> {
    throw new Error("unexpected write");
  }
}

describe("project dimension guard", () => {
  it("opens a project exactly at the pixel limit", () => {
    const parsed = parseProject(projectText(4096, 4096));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.project.document.width).toBe(4096);
      expect(parsed.project.document.height).toBe(4096);
      expect(parsed.project.document.name).toBe("Size guard");
    }
  });

  it("opens a project below the pixel limit", () => {
    const parsed = parseProject(projectText(4095, 4096));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.project.document.width).toBe(4095);
      expect(parsed.project.document.height).toBe(4096);
    }
  });

  it("refuses a project one pixel over the budget before layer content is read", () => {
    const error = rejectionOf(projectText(4097, 4096, []));

    expect(error).toContain("outside the supported range");
    expect(error).toContain("4097x4096");
    expect(error).toContain("at most 16,777,216 px in total");
    // The dimension check runs first; an empty layer list must not mask it.
    expect(error).not.toContain("no layer list");
  });

  it("refuses the 8192x8192 case that would need a 1.07 GB surface", () => {
    const error = rejectionOf(projectText(8192, 8192));

    expect(error).toContain("outside the supported range");
    expect(error).toContain("8192x8192");
    expect(error).toContain("at most 16,777,216 px in total");
  });

  it("keeps the per-side range check", () => {
    expect(rejectionOf(projectText(8193, 8))).toContain("outside the supported range");
    expect(rejectionOf(projectText(8, 90000))).toContain("outside the supported range");
    expect(rejectionOf(projectText(8192, 2049))).toContain("outside the supported range");
  });

  it("refuses missing, string, null and non-finite dimensions", () => {
    const noWidth = JSON.parse(projectText(4096, 4096)) as RawProjectLike;
    delete noWidth.document.width;

    expect(rejectionOf(JSON.stringify(noWidth))).toContain("finite number");
    expect(rejectionOf(projectText("4096", 4096))).toContain("finite number");
    expect(rejectionOf(projectText(null, 4096))).toContain("finite number");
    // JSON has no NaN/Infinity literals; both serialize as null.
    expect(rejectionOf(projectText(Number.NaN, 4096))).toContain("finite number");
    expect(rejectionOf(projectText(Number.POSITIVE_INFINITY, 4096))).toContain("finite number");
  });

  it("round-trips a newly saved at-limit document through the same guard", () => {
    const document = createDocument({ name: "At limit", width: 4096, height: 4096 });
    const parsed = parseProject(serializeProject(document, emptyStore));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.project.document.width).toBe(4096);
      expect(parsed.project.document.height).toBe(4096);
    }
  });

  it("reports an oversized file without replacing the open document", async () => {
    let loaded = false;
    const engine = {
      loadProject: () => {
        loaded = true;
      },
    } as unknown as DrawingEngine;
    const files = new ProjectFiles(engine, new OversizedFileGateway(projectText(8192, 8192)));

    const outcome = await files.open();

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.message).toContain("could not be opened");
      expect(outcome.message).toContain("outside the supported range");
    }
    expect(loaded).toBe(false);
  });
});
