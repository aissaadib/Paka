/**
 * A section of the settings file that the engine does not own.
 *
 * The settings store owns the file, so shell state - which side panels are
 * hidden, for instance - cannot write to it directly without two writers
 * racing for the same document. A section is the hand-off instead: the store
 * reads the section out of the file, gives it to its owner, and writes the
 * owner's state back into the document whenever it changes.
 *
 * A section is deliberately narrow. It knows the key it is stored under, how
 * to read and write its own state, and how to be told that its state
 * changed. It does not know about the engine, the history or the document.
 */
export interface SettingsSection<S> {
  /** The key the section's state is stored under in the settings document. */
  readonly key: string;
  /** Reads the section's state out of a settings document. */
  read(document: Record<string, unknown>): S;
  /** Writes the section's state into a settings document. */
  write(document: Record<string, unknown>, state: S): void;
  /** The state the section's owner currently holds. */
  current(): S;
  /** Hands the owner the state that was read from the file. */
  apply(state: S): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}
