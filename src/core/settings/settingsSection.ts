/**
 * A section of the settings file.
 *
 * The settings store owns the settings file, so state that belongs in the
 * file but not in the engine - which side panels are hidden, where they are
 * docked, what the workspace looks like - cannot write to the file directly
 * without two writers racing for the same document. A **section** is the
 * hand-off instead: the store reads the section out of the file, gives it to
 * its owner, and writes the owner's state back into the document whenever it
 * changes.
 *
 * A section is deliberately narrow. It knows the key it is stored under, how
 * to read and write its own state, and how to be told that its state
 * changed. It does not know about the engine, the history or the document.
 *
 * The shape of a section's value is the section's own business. It is read
 * field by field, exactly like the rest of the settings file:
 *
 *  - a **missing** field takes its default;
 *  - a **malformed** field takes its default;
 *  - a section written by a **newer** version of its own format is ignored
 *    wholesale, because its meaning is unknown rather than merely wrong -
 *    the same rule the settings file itself follows.
 *
 * A section is therefore readable on its own: {@link readSettingsSection}
 * takes the section's value and nothing else, so a builder can test its
 * section without the whole file, and a builder that only needs a different
 * shape can bring its own {@link SettingsCodec} instead of a field list.
 */

import { asRecord } from "../../utils/record";

/**
 * The settings file as a plain document.
 *
 * This is the object the file holds: the engine's own fields at the top
 * level, and one key per section below them.
 */
export type SettingsDocument = Record<string, unknown>;

/**
 * One field of a section.
 *
 * The field owns its own key, so a section's state and its stored shape can
 * drift apart without the two being confused.
 */
export interface SettingsField<T> {
  /** The key the field is stored under inside the section. */
  readonly key: string;
  /**
   * Reads the field out of an untrusted value.
   *
   * The value is the field's own value, or `undefined` when the file does
   * not have it. A field that cannot make sense of what it was given returns
   * its default instead of throwing: a malformed value falls back, it never
   * stops the editor from starting.
   */
  readonly read: (value: unknown) => T;
  /** Writes the field into a plain value for the file. */
  readonly write: (value: T) => unknown;
}

/**
 * A section's fields, keyed by the field's place in the section's state.
 *
 * The type ties the field list to the state it produces, so a field that is
 * missing from the list, or a state field with no rule, is a compile error
 * rather than a value that silently stops being saved.
 */
export type SettingsSectionFields<S> = {
  readonly [K in keyof S]: SettingsField<S[K]>;
};

/**
 * How a section's state is read out of an untrusted value and written back.
 *
 * This is the whole contract of a section's *shape*. A builder that already
 * has a pair of functions for its state - the shell preferences have
 * `normalizeShellPreferences` and `serializeShellPreferences` - brings those
 * instead of a field list.
 */
export interface SettingsCodec<S> {
  /** Reads the section's state out of an untrusted value. */
  readonly read: (value: unknown) => S;
  /** Writes the section's state into a plain value for the file. */
  readonly write: (state: S) => unknown;
}

/**
 * A named, versioned section.
 *
 * The version is the section's *own*: it says how the section's value is
 * shaped, not how the settings file is shaped. A section written by a newer
 * version of itself is ignored, so a section can change its shape without
 * the rest of the file noticing.
 */
export interface SettingsSectionSpec<S> {
  /** The key the section is stored under in the settings document. */
  readonly key: string;
  /** The version of the section's own format. */
  readonly version: number;
  /** The rules that read the section's state and write it back. */
  readonly codec: SettingsCodec<S>;
}

/**
 * The owner of a section's state.
 *
 * The owner is whatever holds the state - a panel store, a workspace store,
 * the shell. The store never looks inside it: it asks for the current state
 * when it writes, hands over the state it read, and listens for changes.
 */
export interface SettingsSectionOwner<S> {
  /** The state the owner currently holds. */
  current(): S;
  /** Replaces the owner's state, e.g. with the one read from the file. */
  apply(state: S): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}

/**
 * A section, as the settings store sees it.
 *
 * The store reads the section out of the document, hands it to its owner,
 * and writes the owner's state back into the document. The section owns the
 * key it is stored under, so two sections can never write to the same place.
 */
export interface SettingsSection<S> {
  /** The key the section's state is stored under in the settings document. */
  readonly key: string;
  /** Reads the section's state out of a settings document. */
  read(document: SettingsDocument): S;
  /** Writes the section's state into a settings document. */
  write(document: SettingsDocument, state: S): void;
  /** The state the section's owner currently holds. */
  current(): S;
  /** Hands the owner the state that was read from the file. */
  apply(state: S): void;
  /** Subscribes to the owner's changes. */
  subscribe(listener: () => void): () => void;
}

/**
 * Builds a field.
 *
 * The writer defaults to the identity, which is right for a string, a number
 * or a boolean. A field that stores something else - a list, a map - writes
 * its own plain value.
 */
export function settingsField<T>(
  key: string,
  read: (value: unknown) => T,
  write: (value: T) => unknown = (value) => value,
): SettingsField<T> {
  return { key, read, write };
}

/**
 * A codec built from a field list.
 *
 * Each field is read on its own, so one malformed field costs that field its
 * value and not the whole section: the rest of the fields are still read.
 */
export function codecFromFields<S>(fields: SettingsSectionFields<S>): SettingsCodec<S> {
  const keys = Object.keys(fields) as (keyof S & string)[];
  return {
    read: (value) => {
      const record = asRecord(value);
      const state: Record<string, unknown> = {};
      for (const key of keys) {
        const field = fields[key] as unknown as SettingsField<unknown>;
        state[key] = field.read(record === null ? undefined : record[field.key]);
      }
      return state as S;
    },
    write: (state) => {
      const record: Record<string, unknown> = {};
      const source = state as unknown as Record<string, unknown>;
      for (const key of keys) {
        const field = fields[key] as unknown as SettingsField<unknown>;
        record[field.key] = field.write(source[key]);
      }
      return record;
    },
  };
}

/**
 * A section defined by a set of fields.
 *
 * The short way to build a section: a name, a version and the fields.
 */
export function fieldsSection<S>(
  key: string,
  version: number,
  fields: SettingsSectionFields<S>,
): SettingsSectionSpec<S> {
  return { key, version, codec: codecFromFields(fields) };
}

/**
 * The state a section starts from.
 *
 * The defaults are the section's own: every field's rule, applied to a value
 * that is not there. A section therefore knows its defaults without the
 * settings file having to say so.
 */
export function defaultSettingsSection<S>(spec: SettingsSectionSpec<S>): S {
  return spec.codec.read(undefined);
}

/**
 * Reads a section out of an untrusted value.
 *
 * The value is the section's own value - what was stored under the section's
 * key - and nothing else, so a section can be read and tested on its own.
 *
 * A value that is not an object, and a value written by a newer version of
 * the section, both yield the section's defaults: the first because it says
 * nothing, the second because its meaning is unknown rather than merely
 * wrong. A value written by an *older* version is read field by field, and
 * the fields it does not have take their defaults.
 */
export function readSettingsSection<S>(spec: SettingsSectionSpec<S>, value: unknown): S {
  const record = asRecord(value);
  if (record === null) {
    return defaultSettingsSection(spec);
  }
  const version = record.version;
  if (
    typeof version === "number" &&
    Number.isFinite(version) &&
    version > spec.version
  ) {
    return defaultSettingsSection(spec);
  }
  return spec.codec.read(record);
}

/**
 * Writes a section back into a plain value.
 *
 * The section's own version travels with the value, so the next build can
 * tell an old section from a new one. The spec's version is the authority:
 * it is written last, so a codec that carries a version of its own cannot
 * contradict the section it belongs to.
 */
export function writeSettingsSection<S>(
  spec: SettingsSectionSpec<S>,
  state: S,
): SettingsDocument {
  const written = asRecord(spec.codec.write(state)) ?? {};
  return { ...written, version: spec.version };
}

/**
 * Builds the section the settings store uses.
 *
 * The spec says how the section's value is shaped; the owner says who holds
 * the state. The store only ever sees the section.
 */
export function createSettingsSection<S>(
  spec: SettingsSectionSpec<S>,
  owner: SettingsSectionOwner<S>,
): SettingsSection<S> {
  return {
    key: spec.key,
    read: (document) => readSettingsSection(spec, document[spec.key]),
    write: (document, state) => {
      document[spec.key] = writeSettingsSection(spec, state);
    },
    current: () => owner.current(),
    apply: (state) => owner.apply(state),
    subscribe: (listener) => owner.subscribe(listener),
  };
}
