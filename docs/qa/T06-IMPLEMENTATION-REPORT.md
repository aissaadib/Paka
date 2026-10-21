# T-06 - Settings, persistence and safe autosave: implementation report

**Agent:** night shift, agent 2 (settings and document persistence)
**Date:** 2026-10-21
**Branch:** `feat/t06-settings-persistence`, from `feat/stamp-brush-engine` at `a1c9c1d`
**Discovery this implements:** `docs/SETTINGS-AUTOSAVE-DISCOVERY.md` (branch
`chore/t06-discovery`, commit `43e8a57`)

---

## 1. What this slice does, and what it does not

| Stage | State | Why |
| --- | --- | --- |
| **A - settings persistence** | **implemented** | Independently safe. The storage location is fixed by the platform, not by a product choice. |
| **B - autosave** | **infrastructure only, not enabled** | The product decisions that govern autosaving are unanswered. The machinery, the policy seam and the dangerous invariants are implemented and tested; nothing is started, and the app's behaviour is unchanged. |

The discovery report is a **research report**: its §12 lists eight open
questions with *recommendations*, and the overnight log records one blocker
against T-06 - "T-06's autosave policy | the owner". A recommendation is not
an approval, so this slice does not treat any of the eight as decided.

What this slice therefore delivers for Stage B is exactly what the task asks
for in that case: the implementation plan, the API seam, and regression tests
for the dangerous dirty-state behaviour - with the blocked steps marked.

---

## 2. The discovery's claims, verified against the current tree

Every claim was re-checked at `a1c9c1d` rather than taken from the report.
The report was written at `9b0a885`; five slices have landed since.

| Claim | Verified? | Evidence at `a1c9c1d` |
| --- | --- | --- |
| The dirty state is `revision !== savedRevision` | **yes, and it has grown** | `DrawingEngine.ts:2811` - `const dirty = this.revision !== this.savedRevision \|\| this.fileHoldsPreview;`. The `fileHoldsPreview` term arrived with the guides slice (T-11): a file written while a guide drag is in flight holds the *preview*, so it is not called clean (`DrawingEngine.ts:838-843`). |
| `markSaved` is the operation that clears the dirty flag | **yes** | `DrawingEngine.ts:838` - it sets `filePath`, `savedRevision = revision` and `fileHoldsPreview`. It is the only writer of `savedRevision`. |
| Autosaving must not call `markSaved` | **still true, and now sharper** | The autosave service calls no engine mutator at all, so it cannot clear the dirty flag by any route. |
| The project extension whitelist rejects `drawing.paka.autosave` | **yes** | `project_io.rs:30` - `PROJECT_EXTENSIONS = ["paka", "json"]`; `require_extension` (`:108`) matches the *last* extension, so `drawing.paka.autosave` is rejected and `drawing.autosave.paka` is accepted. |
| The project content carries no revision or timestamp | **yes** | `serializeProject` emits `format`, `version`, `document`, `layers`; there is still no ordering metadata, so "is the recovery copy newer than the project?" cannot be answered from the bytes. |
| There is no client-side settings persistence layer | **yes** | No `localStorage` / `sessionStorage` / `IndexedDB` / cookie use in `src/`. |
| The frontend can write only through three Rust commands | **yes, and now five** | `lib.rs` exposes `native_environment`, `read_text_file`, `write_text_file_atomic`, `write_binary_file_atomic`; this slice adds `read_app_settings` and `write_app_settings`. |
| "The six editor preferences" | **no - there are nine** | The discovery counted six (brush, tool, shape fill, fill tolerance, gradient type, gradient end colour). The polygon/star slice (T-14) added three: `setShapeSides`, `setShapeInnerRatio`, `setShapeRotation`. The settings file persists all **nine**. |
| `write_atomic` fsyncs the file but not the parent directory | **yes** | `project_io.rs:134-166` - `sync_all()` on the temporary file, then `fs::rename`. The rename is therefore not guaranteed across a power cut. **This slice does not claim power-loss durability.** |
| The write path is "serialize, write, then mark saved" | **yes** | `projectFiles.ts:143-159`. |
| A cancelled save dialog changes neither path nor dirty state | **yes** | `projectFiles.ts:101-112` returns `{status: "cancelled"}` before `writeTo` is reached. |
| Editor preferences do not dirty the document | **yes** | Every preference setter only assigns, calls `commands.breakMerge()` and publishes - no revision bump, no history entry. |

---

## 3. Stage A - settings persistence

### 3.1 What is persisted

Nine editor preferences, and nothing else:

| Field | Range | Default |
| --- | --- | --- |
| `brush` | the brush settings, validated field by field | `DEFAULT_BRUSH` |
| `toolId` | one of the thirteen tool ids | `"brush"` |
| `shapeFill` | boolean | `false` |
| `shapeSides` | 3-24 | 5 |
| `shapeInnerRatio` | 0.05-1 | 0.5 |
| `shapeRotation` | 0-360 | 0 |
| `fillTolerance` | 0-255 | 24 |
| `gradientType` | `"linear"` / `"radial"` | `"linear"` |
| `gradientEndColor` | a hex colour | `#ffffff` |

The file is versioned (`version: 1`) and holds **no drawing**.

### 3.2 Where it lives

`%APPDATA%\com.paka.drawing\settings.json` on Windows, the platform's
configuration directory elsewhere - Tauri's `app.path().app_config_dir()`.

Two new native commands own the path:

| Command | Signature | Purpose |
| --- | --- | --- |
| `read_app_settings` | `(app) -> Result<Option<String>, String>` | The settings text, or `None` when there is no file. |
| `write_app_settings` | `(app, contents) -> Result<(), String>` | Replaces the file atomically. |

**The WebView never learns the path.** It asks for the settings and hands
them back. This was a deliberate choice over reusing
`write_text_file_atomic` with a frontend-supplied path: that would have
widened the WebView's write scope from *one file* to *any `.json` the user
can name*, in exchange for four lines of code. The two commands keep the
scope at one file and the path knowledge in Rust.

The write reuses the project's own atomic replace (`write_atomic`, now
`pub(crate)`), so a crash or a full disk cannot leave a half-written settings
file. As with the project save, the parent directory is not fsynced, so the
rename is not guaranteed across a power cut.

### 3.3 The rules the file obeys

| Situation | What happens |
| --- | --- |
| No file yet | The defaults. Not an error. |
| The file is not valid JSON | The defaults. Not an error. **A corrupt settings file cannot stop the editor from starting.** |
| The file is from a newer version | The whole file is ignored and the defaults are used - its meaning is unknown, not merely wrong. |
| A field is missing | Its default. |
| A field is out of range | It is **clamped** into range, not rejected. |
| A field is malformed | Its default. |
| A field the build does not know | Ignored. |
| The file cannot be read | The defaults, and the failure is recorded. |
| The file cannot be written | The failure is recorded; the editor carries on. |

### 3.4 Settings are not document state

Applying the settings goes through the engine's **editor-state** setters, so
restoring a preference costs no history entry, no revision bump and no dirty
flag - the same contract the brush settings have always had. This is pinned
by two tests that assert `file.dirty === false` and `history.depth === 0`
after a restore, and after a preference change.

The file is written when a preference changes, debounced by 300 ms so a
brush-slider drag is one write rather than sixty. A failed write is recorded
(`SettingsStore.lastError`) and forgotten; it is not raised in the UI, because
a preferences file that cannot be written is a minor inconvenience and not
something the user can act on.

### 3.5 Applying at startup

The editor is created synchronously; the settings read is asynchronous. The
settings are applied **after** creation, through the editor's own actions.
The first paint therefore shows the default brush for a moment, which is the
trade the discovery recommended against gating the editor on the read (which
would delay the first paint and have to survive StrictMode's double mount).

StrictMode's double mount is handled: a store that is torn down while its
read is in flight does not apply anything.

---

## 4. Stage B - the autosave seam, and what is blocked

### 4.1 What exists

`src/core/autosave/` holds two framework-free modules:

- **`recovery.ts`** - where a copy goes. `<stem>.autosave.paka`, **beside**
  the project, so it inherits the project's backup and sync behaviour. The
  marker sits in the middle because the native writer only accepts `.paka` and
  `.json`, and the extension is the last part of the name.
- **`autosaveService.ts`** - the service. It takes its **policy by
  injection**: `enabled`, `intervalMs` and `recoveryPathFor`. Nothing in the
  module chooses any of them.

### 4.2 The invariants, enforced in code and pinned by tests

| # | Invariant | How it is enforced | Test |
| --- | --- | --- | --- |
| 1 | **An autosave never marks the document saved.** | The service calls no engine mutator. | "never marks the document saved" - the document is still dirty after a copy is written. |
| 2 | **An autosave never writes the user's path.** | The write path comes from the policy, and the service refuses to write at all when it equals the project's own path. | "never writes the user's own path"; "refuses to write when the recovery path is the project's own". |
| 3 | **One write at a time.** | A `writing` guard; a tick during a write returns `busy`. | "keeps one write in flight at a time" - the gateway records the maximum concurrency. |
| 4 | **A copy written while the user saved is reported as superseded.** | A generation counter, bumped when the document becomes clean or the project's path changes. | "reports a copy written while the user saved as superseded". |
| 5 | A copy is a valid project file. | It is written with `engine.serialize()`, the same call a save uses. | "writes a copy that is a valid project file" - it parses with `parseProject`. |
| 6 | Nothing is written for a clean document, an unsaved document, or an unchanged one. | The tick checks the dirty flag, the path and the change flag. | Three tests. |
| 7 | A failed write leaves the document dirty and the next tick retries. | The failure path does not clear the change flag. | "leaves the document dirty when the write fails, and retries next time". |
| 8 | A save racing a copy does not change the project's path or the dirty state. | The service never touches either. | "leaves a real save alone" (through the real `ProjectFiles.save()` path) and "does not change the project's path or the dirty state". |
| 9 | A cancelled save changes nothing. | The service only reads the path and the dirty flag. | "is unaffected by a cancelled save". |
| 10 | An edit that lands **during** a copy is not marked as copied. | The document the copy covered is compared with the newest one after the write. | "writes the newer content after an edit during an in-flight write". |

**Row 10 was a bug, found by the test that now pins it.** The first
implementation cleared the "changed" flag as soon as a copy landed, so an edit
made while the copy was in flight was marked as *already copied* and was never
protected - the newest work would have been left unprotected until the next
edit. The service now compares the document the copy covered with the newest
one, and only clears the flag when they are the same object. The engine
replaces the document on every change, so the identity comparison is exact.

**One detection gap, stated plainly.** The service recognises a user save by
watching the document become clean. A save taken **while a guide drag is in
flight** does not make the document clean - `markSaved` sets
`fileHoldsPreview`, so the file holds the live preview and the document stays
dirty (`DrawingEngine.ts:838-843`, `:2811`). The service therefore cannot see
that save, and a copy written at that moment is reported as `written` rather
than `superseded`. Nothing is lost: the user's file is intact and the copy is
a *stale* extra, never a replacement. The fix would be to publish the saved
revision in the snapshot so every save is visible - an engine change to a
public type, which is not made for a service that is not enabled.

### 4.3 The blocked steps - marked, not quietly chosen

| # | Blocked step | Why it is blocked | What is needed |
| --- | --- | --- | --- |
| B-1 | **Starting the service.** | Whether autosave is on by default, and at what interval, is a product decision. | The owner's answer to discovery §12.1. The seam is `new AutosaveService({engine, gateway, policy})` and `start()`. |
| B-2 | **Protecting a document that was never saved.** | It has no folder to write into, and autosaving cannot prompt. | The owner's answer to §12.2: accept the limitation, or fund a command that writes into the app-config directory. |
| B-3 | **Offering a recovery.** | Whether recovery is automatic, prompted or manual is a product decision. | The owner's answer to §12.4 and the conflict question. The service writes the copy; the *offer* is UI. |
| B-4 | **Deleting the recovery copy after a successful save.** | It needs a `delete_file` command, and that widens what the WebView can delete to any path the user names - a security decision, not a technical one. | The owner's answer to §12, plus a security review of a delete command. **This is why a stale copy can outlive a save today.** |
| B-5 | **A status-bar channel for autosave failures.** | The existing file-message channel belongs to user-initiated file operations; an autosave failure must not look like a failed save. | A channel of its own, when there is a service to report from. |
| B-6 | **A recovery file's conflict with a newer project.** | The project format carries no ordering metadata, so "which is newer?" cannot be answered from the bytes. | The owner's answer to the conflict question. |

### 4.4 The plan for the day the decisions are made

1. Answer §12.1-§12.4 and the conflict question.
2. Add the settings fields for the autosave preferences (`enabled`,
   `intervalSeconds`) to `AppSettings` - additive, no version bump, because
   the schema is already tolerant of missing fields.
3. Start the service in `EditorProvider` (or a dedicated hook), with the
   policy built from those settings.
4. Add the status-bar channel (B-5).
5. Add the recovery offer to the open flow: after `ProjectFiles.open()`
   succeeds, ask whether a copy exists, parse it with `parseProject`, and
   offer it - **never open it silently**. A copy the parser refuses is
   reported, not offered.
6. Decide the delete command (B-4) and clean the copy up on a successful save.
7. Add the settings UI for the two preferences.

---

## 5. Acceptance criteria applied, and how they are checked

### Stage A

| # | Criterion | Check |
| --- | --- | --- |
| A-1 | The nine preferences survive a restart. | "writes the changed preferences and reads them back" - a new engine and a new store read the same file. |
| A-2 | A missing file starts the app with the defaults and no error. | "starts with the defaults when there is no file". |
| A-3 | A corrupt file starts the app with the defaults and no error. | "starts with the defaults when the file is corrupt". |
| A-4 | Out-of-range values are clamped, not rejected. | "clamps out-of-range values instead of rejecting them". |
| A-5 | A file from a future version is ignored. | "ignores a file written by a newer version". |
| A-6 | A preference change creates no history entry and no dirty flag. | "does not dirty the document or add a history step". |
| A-7 | A failed write is not surfaced as an error and does not stop the app. | "keeps the editor usable when the write fails"; "keeps the editor usable when the read fails". |
| A-8 | Applying the file adds no history entry and no dirty flag. | "does not dirty the document or add a history step when applying the file". |
| A-10 | Malformed fields fall back to their defaults. | "falls back to the default for a malformed field". |
| A-11 | A burst of changes is one write. | "coalesces a burst of changes into one write". |
| A-12 | Drawing the document does not write the file. | "does not write the file when the drawing changes". |

### Stage B

B-1 to B-9 of the discovery's list are covered by the eight invariant tests
above. The criteria that need a decision (B-10's cleanup, B-11's offer, B-12's
decline, B-13's restore, B-14's refusal) are **not** implemented, because
they are the product decisions in §4.3.

---

## 6. Test commands and results

Run in the worktree `C:\Users\aissa\Desktop\Paka-feature-factory\worktrees\t06-settings-persistence`.

```
pnpm install --frozen-lockfile      # 1.1 s
pnpm test                           # 36 files, 742 tests, all pass
pnpm typecheck                      # clean
pnpm build                          # built
pnpm test:visual                    # 19 passed (the scene goldens are unchanged)
cargo test --manifest-path src-tauri\Cargo.toml
```

The unit suite before this slice was **711 tests in 34 files**; this slice
adds **31 tests in 2 files** (16 settings, 15 autosave) and one test support
module.

**The Rust tests could not be executed here, and the reason is not this
slice.** `cargo test` **compiles** the crate - the new `settings_io` module
and the two command registrations included - in 4m 36s, and then the test
*binary* fails to start:

```
Running unittests src\lib.rs (src-tauri\target\debug\deps\paka_lib-....exe)
error: test failed, to rerun pass `--lib`
  process didn't exit successfully (...paka_lib-....exe)
  (exit code: 0xc0000139, STATUS_ENTRYPOINT_NOT_FOUND)
```

This is the environment, not the change: the same command on the **base
commit**, with every file of this slice stashed away, fails identically
(same exit code, same binary, same linker warning about `.rsrc merge
failure: multiple non-default manifests`). The installed toolchain is
`stable-x86_64-pc-windows-gnu` (MinGW) while the default host is
`x86_64-pc-windows-msvc`, and no MSVC toolchain or `link.exe` is installed
here to build the test binary the way the shipped `paka.exe` was built.

So: the Rust code **compiles**, and the four new unit tests in
`settings_io.rs` (a missing file is not an error, a round trip, a replace
that leaves no temporary, an unreadable file *is* an error) are **written but
not executed**. They need a run on a machine whose toolchain can execute the
test binary - the same gap the project's other Rust tests have.

---

## 7. Changed files

| File | Change |
| --- | --- |
| `src-tauri/src/settings_io.rs` | **new** - the two commands, the path helper, the tests. |
| `src-tauri/src/project_io.rs` | `write_atomic` is now `pub(crate)`, so the settings write uses the same atomic replace. One word and a doc comment. |
| `src-tauri/src/lib.rs` | Registers the two commands. |
| `src/core/settings/appSettings.ts` | **new** - the schema, the defaults, the normaliser, the serialiser, the comparison. |
| `src/core/settings/settingsGateway.ts` | **new** - the interface. |
| `src/core/settings/tauriSettingsGateway.ts` | **new** - the Tauri implementation. |
| `src/core/settings/settingsStore.ts` | **new** - read, apply, watch, persist. |
| `src/core/autosave/recovery.ts` | **new** - where a copy goes. |
| `src/core/autosave/autosaveService.ts` | **new** - the service and its invariants. Not started. |
| `src/app/EditorProvider.tsx` | Creates the settings store for the session. |
| `src/test/settings.test.ts` | **new** - 16 tests. |
| `src/test/autosave.test.ts` | **new** - 15 tests. |
| `src/test/support/memorySettingsGateway.ts` | **new** - the in-memory gateway. |
| `docs/qa/T06-IMPLEMENTATION-REPORT.md` | **new** - this report. |
| `README.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, `docs/SESSION-BRIEF.md`, `AGENTS.md` | The state moves with the behaviour. |

**Not touched:** the project format, `PROJECT_VERSION`, the drawing engine's
document semantics, the file service, the tool registry, the release or
licensing files (`LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`,
`docs/g1/`), and every other agent's files.

---

## 8. Architectural decisions

1. **The settings path stays in Rust.** The WebView asks for the settings
   rather than being told where they live. The alternative widened the
   WebView's write scope for no gain.
2. **Two narrow commands rather than one general one.** A `delete_file`
   command - which the recovery lifecycle needs - would let the WebView
   delete any path the user names. It is a security decision, so it is not
   here.
3. **The settings schema is explicit and versioned, and every field is
   validated on the way in.** A file on disk is user-writable, so a corrupt
   one is a case to handle, not an error to raise.
4. **The store watches the engine rather than intercepting the actions.** The
   snapshot carries all nine preferences, so no control and no engine method
   had to change.
5. **The store keeps the editor as the authority.** After applying the file
   it stores what the editor holds, not what it asked for.
6. **The autosave policy is injected.** Every product decision is a parameter,
   so the owner's answers need no change to the service.
7. **The autosave service is not started.** A feature that is half-wired is
   worse than one that is absent, and the wiring is the decision.

---

## 9. Known limitations

1. **Preferences are written 300 ms after the last change.** A change made in
   the last moments before the window closes can be lost. The flush on
   teardown is best-effort, because a closing window may not wait for it.
2. **The settings file is not fsynced at the directory level**, exactly like
   the project file: the *contents* are flushed, the *rename* is not
   guaranteed across a power cut. **No power-loss durability is claimed.**
3. **The first paint shows the default brush** for as long as the settings
   read takes.
4. **In the browser preview there is no settings file.** The native commands
   are absent, so the read fails, the defaults are used and the write is
   recorded as a failure. The editor is unaffected.
5. **The autosave service is dead code until the policy is decided.** It is
   covered by tests, but nothing exercises it in the running app.
6. **A recovery copy can outlive a successful save**, because deleting it
   needs a command that has a security dimension (B-4).
7. **The settings file has no per-field "unknown version" handling**: a file
   from a newer version is ignored wholesale, so a future version that only
   *adds* a field will lose the settings it shares. That is the safe
   direction - a newer file is not misread - but it is a real cost of the
   version bump.
8. **The Rust unit tests could not be executed in this environment.** The
   crate compiles, but the test binary fails to start with
   `STATUS_ENTRYPOINT_NOT_FOUND`, identically on the base commit. The four
   tests in `settings_io.rs` are written and unexecuted; see section 6.
9. **A save taken during a guide drag is invisible to the autosave
   service.** The document stays dirty after such a save, so the service
   cannot see it and does not report a concurrent copy as superseded. Nothing
   is lost - the user's file is intact and the copy is a stale extra - but
   the detection would need the saved revision in the snapshot.

---

## 10. The owner's decisions, still open

| # | Decision | Discovery reference |
| --- | --- | --- |
| 1 | Is autosave on by default, and at what interval? | §12.1 |
| 2 | How is a document that was never saved protected? | §12.2 |
| 3 | Is recovery automatic, prompted, or manual? | §12.4 |
| 4 | When is a recovery copy deleted? | §12 (and B-4 here) |
| 5 | How is a conflict between a project and a copy presented? | §12 |
| 6 | Where does the autosave toggle live? | §12.4 |
| 7 | Does the close guard's wording change once autosave exists? | §12.5 |
| 8 | Is a flush-on-close wanted? | §12.6 |

Decisions 1-5 are the ones the task marks as **gates**: this slice
implements none of them.

---

## 11. Coordination

- **Agent 1 (native file I/O):** the Rust side needed two commands. No other
  worktree had pending changes under `src-tauri/` when this slice started
  (`git status --short -- src-tauri` in every sibling worktree was empty), so
  the files were not contended. The change is additive: a new module, a new
  pair of commands, and `write_atomic` made `pub(crate)`.
- **No new dependency.** The settings path comes from Tauri's own
  `app.path().app_config_dir()`; the atomic write is the project's own.
  Nothing was added to `Cargo.toml` or `package.json`, so the licence and
  provenance records are untouched by this slice.
- **The `T-06` identifier collides** with the stamp engine's test ids
  (discovery §9). This report calls the stages "Stage A" and "Stage B" and
  does not use `T-06` as a test id.
