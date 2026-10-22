/**
 * The rule that decides when deleting a layer has to be confirmed.
 *
 * The promise the layers panel makes is that content cannot be lost by
 * accident: a layer that holds strokes, fills or gradients is confirmed
 * before it goes, and a layer that holds nothing is removed without a
 * question. The rule and the wording that states it are pinned here, because
 * the React layer that uses them has no automated tests.
 */

import { describe, expect, it } from "vitest";
import { canDeleteLayer, layerDeletionPrompt } from "../core/document/layerDeletion";

describe("canDeleteLayer", () => {
  it("allows a layer to go while the document keeps one", () => {
    expect(canDeleteLayer(2)).toBe(true);
    expect(canDeleteLayer(9)).toBe(true);
  });

  it("keeps the last layer", () => {
    // The drawing pipeline always needs a destination, so the document model
    // refuses to remove the last layer. The panel has to know that before it
    // asks the user to confirm a deletion.
    expect(canDeleteLayer(1)).toBe(false);
    expect(canDeleteLayer(0)).toBe(false);
  });
});

describe("layerDeletionPrompt", () => {
  it("asks before a layer that holds content is deleted", () => {
    const prompt = layerDeletionPrompt("Ink", 3);
    expect(prompt).not.toBeNull();
    expect(prompt?.title).toContain("Ink");
    expect(prompt?.body).toContain("3 items");
    expect(prompt?.confirmLabel).toBe("Delete layer");
  });

  it("says \"item\" for a single element", () => {
    const prompt = layerDeletionPrompt("Sketch", 1);
    expect(prompt?.body).toContain("1 item -");
    expect(prompt?.body).not.toContain("1 items");
  });

  it("does not ask about an empty layer", () => {
    expect(layerDeletionPrompt("Empty", 0)).toBeNull();
  });

  it("treats a negative count as empty rather than as content", () => {
    expect(layerDeletionPrompt("Empty", -1)).toBeNull();
  });

  it("says the undo brings the content back", () => {
    const prompt = layerDeletionPrompt("Ink", 2);
    expect(prompt?.body).toContain("Undo");
  });
});
