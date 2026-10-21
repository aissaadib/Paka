/**
 * In-memory `SettingsGateway` for tests.
 *
 * The settings store is deliberately unaware of Tauri, so the whole "read,
 * apply, change, persist" cycle can be exercised in Node by swapping the
 * gateway: "there is no settings file yet", "the file is corrupt", "this write
 * fails", "this write is still in flight".
 */

import type { SettingsGateway } from "../../core/settings/settingsGateway";

export class MemorySettingsGateway implements SettingsGateway {
  /** The stored text, or `null` when there is no settings file yet. */
  contents: string | null = null;
  /** Every write, in order. */
  readonly writes: string[] = [];
  /** When set, the read fails with this message. */
  readFailure: string | null = null;
  /** When set, the write fails with this message. */
  writeFailure: string | null = null;

  private hold: Promise<void> | null = null;
  private releaseHold: (() => void) | null = null;

  async read(): Promise<string | null> {
    if (this.readFailure !== null) {
      throw new Error(this.readFailure);
    }
    return this.contents;
  }

  async write(contents: string): Promise<void> {
    if (this.writeFailure !== null) {
      throw new Error(this.writeFailure);
    }
    if (this.hold !== null) {
      await this.hold;
    }
    this.contents = contents;
    this.writes.push(contents);
  }

  /** Holds every later write until {@link release} is called. */
  holdWrites(): void {
    this.hold = new Promise<void>((resolve) => {
      this.releaseHold = resolve;
    });
  }

  /** Lets the held writes finish. */
  release(): void {
    this.releaseHold?.();
    this.hold = null;
    this.releaseHold = null;
  }
}
