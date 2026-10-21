/**
 * Autosave tests.
 *
 * The properties being pinned down are the ones that decide whether a
 * recovery feature protects the user's work or destroys it:
 *
 *  - **an autosave never marks the document saved** - the dirty flag, the
 *    close guard and the title dot must all keep saying "unsaved";
 *  - **an autosave never writes the user's own path** - the copy goes
 *    somewhere else, always;
 *  - the copy is a real project file, so it can be read back with the
 *    project's own parser;
 *  - a copy written while the user was saving is reported as superseded
 *    rather than passed off as current.
 *
 * The service is not started by the application - the product decisions that
 * govern autosaving are the owner's - so these tests drive `tick()` directly
 * against an in-memory gateway and a real engine. The order is the one the
 * app has: the service starts, and then the user edits.
 */

import { describe, expect, it } from "vitest";
import { AutosaveService, type AutosavePolicy } from "../core/autosave/autosaveService";
import { isRecoveryPath, recoveryPathFor } from "../core/autosave/recovery";
import { createDocument } from "../core/document/document";
import { DrawingEngine } from "../core/engine/DrawingEngine";
import { parseProject } from "../core/project/projectFormat";
import { ProjectFiles } from "../core/project/projectFiles";
import { MemoryProjectGateway } from "./support/memoryGateway";

const PROJECT_PATH = "C:\\art\\cat.paka";
const RECOVERY_PATH = "C:\\art\\cat.autosave.paka";

/** A gateway that can hold a write open, so a race can be arranged. */
class HoldingGateway extends MemoryProjectGateway {
  private hold: Promise<void> | null = null;
  private openHold: (() => void) | null = null;
  /** How many writes were in flight at the same time. */
  maxConcurrent = 0;
  private concurrent = 0;

  holdWrites(): void {
    this.hold = new Promise<void>((resolve) => {
      this.openHold = resolve;
    });
  }

  releaseWrites(): void {
    this.openHold?.();
    this.hold = null;
    this.openHold = null;
  }

  override async writeTextFile(path: string, contents: string): Promise<void> {
    this.concurrent += 1;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      if (this.hold !== null) {
        await this.hold;
      }
      await super.writeTextFile(path, contents);
    } finally {
      this.concurrent -= 1;
    }
  }
}

function createEngine(): DrawingEngine {
  return new DrawingEngine({ document: createDocument({ name: "Test", width: 200, height: 120 }) });
}

/** An engine with a saved, clean project. */
function createSavedEngine(): DrawingEngine {
  const engine = createEngine();
  engine.markSaved(PROJECT_PATH);
  return engine;
}

function policy(overrides: Partial<AutosavePolicy> = {}): AutosavePolicy {
  return {
    enabled: true,
    intervalMs: 1000,
    recoveryPathFor,
    ...overrides,
  };
}

function createService(
  engine: DrawingEngine,
  gateway: MemoryProjectGateway,
  overrides: Partial<AutosavePolicy> = {},
): AutosaveService {
  const service = new AutosaveService({ engine, gateway, policy: policy(overrides) });
  service.start();
  return service;
}

describe("where a recovery copy goes", () => {
  it("sits beside the project and keeps the project extension", () => {
    expect(recoveryPathFor("C:\\art\\cat.paka")).toBe(RECOVERY_PATH);
    expect(recoveryPathFor("/home/user/cat.paka")).toBe("/home/user/cat.autosave.paka");
    // The native writer only accepts `.paka` and `.json`, and the extension is
    // the last part of the name - so the marker cannot go at the end.
    expect(recoveryPathFor("C:\\art\\cat.paka").endsWith(".paka")).toBe(true);
  });

  it("recognises a recovery copy", () => {
    expect(isRecoveryPath(RECOVERY_PATH)).toBe(true);
    expect(isRecoveryPath(PROJECT_PATH)).toBe(false);
  });
});

describe("an autosave", () => {
  it("never marks the document saved", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    expect(engine.getState().file.dirty).toBe(true);

    const outcome = await service.tick();

    expect(outcome.status).toBe("written");
    // The document is still unsaved: the close guard must keep vetoing.
    expect(engine.getState().file.dirty).toBe(true);
  });

  it("never writes the user's own path", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    await service.tick();

    expect(gateway.writes).toEqual([RECOVERY_PATH]);
    expect(gateway.writes).not.toContain(PROJECT_PATH);
  });

  it("refuses to write when the recovery path is the project's own", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway, { recoveryPathFor: () => PROJECT_PATH });

    engine.addLayer();
    const outcome = await service.tick();

    expect(outcome.status).toBe("failed");
    expect(gateway.writes).toEqual([]);
  });

  it("writes a copy that is a valid project file", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    await service.tick();

    const written = gateway.files.get(RECOVERY_PATH);
    expect(written).toBeDefined();
    const parsed = parseProject(written!);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.project.document.layers.length).toBe(
        engine.getState().document.layers.length,
      );
    }
  });

  it("writes after an edit and not before one", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    // A clean document has nothing to protect.
    expect((await service.tick()).status).toBe("clean");
    expect(gateway.writes).toEqual([]);

    engine.addLayer();
    expect((await service.tick()).status).toBe("written");
    expect(gateway.writes).toEqual([RECOVERY_PATH]);
  });

  it("writes nothing when the document has not changed since the last copy", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    await service.tick();
    const second = await service.tick();

    expect(second.status).toBe("unchanged");
    expect(gateway.writes).toHaveLength(1);
  });

  it("does nothing for a document that was never saved", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    const outcome = await service.tick();

    expect(outcome.status).toBe("no-project");
    expect(gateway.writes).toEqual([]);
  });

  it("does nothing when autosaving is off", async () => {
    const gateway = new MemoryProjectGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway, { enabled: false });

    engine.addLayer();
    const outcome = await service.tick();

    expect(outcome.status).toBe("disabled");
    expect(gateway.writes).toEqual([]);
  });

  it("leaves the document dirty when the write fails, and retries next time", async () => {
    const gateway = new MemoryProjectGateway();
    gateway.writeFailure = "the disk is full";
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    const failed = await service.tick();
    expect(failed.status).toBe("failed");
    expect(engine.getState().file.dirty).toBe(true);

    gateway.writeFailure = null;
    const retried = await service.tick();
    expect(retried.status).toBe("written");
    expect(gateway.writes).toEqual([RECOVERY_PATH]);
  });

  it("keeps one write in flight at a time", async () => {
    const gateway = new HoldingGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    gateway.holdWrites();
    const first = service.tick();
    const second = await service.tick();
    expect(second.status).toBe("busy");

    gateway.releaseWrites();
    await first;

    expect(gateway.maxConcurrent).toBe(1);
  });
});

describe("an autosave racing a user save", () => {
  it("reports a copy written while the user saved as superseded", async () => {
    const gateway = new HoldingGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    gateway.holdWrites();
    const write = service.tick();

    // The user saves while the copy is in flight.
    engine.markSaved(PROJECT_PATH);
    expect(engine.getState().file.dirty).toBe(false);

    gateway.releaseWrites();
    const outcome = await write;

    expect(outcome.status).toBe("superseded");
    // The user's file was not touched by the autosave.
    expect(gateway.writes).toEqual([RECOVERY_PATH]);
  });

  it("does not let the autosave write over a document the user has saved", async () => {
    const gateway = new HoldingGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    gateway.holdWrites();
    const write = service.tick();
    engine.markSaved(PROJECT_PATH);
    gateway.releaseWrites();
    await write;

    // After the save the document is clean, so there is nothing left to
    // protect and the next tick writes nothing.
    const next = await service.tick();
    expect(next.status).toBe("clean");
    expect(gateway.writes).toEqual([RECOVERY_PATH]);
  });

  it("does not change the project's path or the dirty state", async () => {
    const gateway = new HoldingGateway();
    const engine = createSavedEngine();
    const service = createService(engine, gateway);

    engine.addLayer();
    gateway.holdWrites();
    const write = service.tick();
    engine.markSaved(PROJECT_PATH);
    gateway.releaseWrites();
    await write;

    const state = engine.getState();
    expect(state.file.path).toBe(PROJECT_PATH);
    expect(state.file.dirty).toBe(false);
  });

  it("leaves a real save alone", async () => {
    // The hazard, with the real save path: the user saves through the file
    // service while a copy is in flight. The user's file is theirs; the copy
    // goes elsewhere; and the copy is reported as superseded rather than
    // passed off as current.
    const projectGateway = new MemoryProjectGateway();
    const copyGateway = new HoldingGateway();
    const engine = createSavedEngine();
    const files = new ProjectFiles(engine, projectGateway);
    const service = new AutosaveService({ engine, gateway: copyGateway, policy: policy() });
    service.start();

    engine.addLayer();
    copyGateway.holdWrites();
    const copy = service.tick();

    const outcome = await files.save();
    expect(outcome.status).toBe("saved");
    expect(engine.getState().file.dirty).toBe(false);

    copyGateway.releaseWrites();
    const copyOutcome = await copy;

    expect(copyOutcome.status).toBe("superseded");
    expect(copyGateway.writes).toEqual([RECOVERY_PATH]);
    expect(projectGateway.writes).toEqual([PROJECT_PATH]);
  });

  it("is unaffected by a cancelled save", async () => {
    // The user opens the save dialog and cancels it. The chosen path and the
    // dirty state must not move, and the recovery state must not either.
    const projectGateway = new MemoryProjectGateway();
    projectGateway.savePath = null;
    const engine = createEngine();
    const files = new ProjectFiles(engine, projectGateway);
    const service = new AutosaveService({ engine, gateway: projectGateway, policy: policy() });
    service.start();

    engine.addLayer();
    const outcome = await files.save();

    expect(outcome.status).toBe("cancelled");
    expect(engine.getState().file.path).toBeNull();
    expect(engine.getState().file.dirty).toBe(true);
    // The document still has no path, so there is still nowhere to write.
    expect((await service.tick()).status).toBe("no-project");
  });
});
