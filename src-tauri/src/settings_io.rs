//! Per-user settings storage.
//!
//! The settings file is Paka's own: a small JSON document in the operating
//! system's configuration directory for the app (`%APPDATA%\com.paka.drawing`
//! on Windows). It is **not** a project file and it is not in the project
//! format - it holds editor preferences only, and it never touches a drawing.
//!
//! Two commands, and the WebView never learns the path: it asks for the
//! settings and hands them back. That keeps the WebView's write scope at
//! exactly one file - the settings file - instead of "any `.json` the user can
//! name", which is what using the generic `write_text_file_atomic` with a
//! frontend-supplied path would have widened it to.
//!
//! The write goes through the same atomic replace the project files use: a
//! sibling temporary file is flushed to disk and then renamed over the target,
//! so a crash or a full disk cannot leave a half-written settings file. The
//! parent directory is not itself fsynced, so the *rename* is not guaranteed
//! across a power cut - the same limitation the project save has.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use tauri::AppHandle;
use tauri::Manager;

use crate::project_io::write_atomic;

/// The settings file's name inside the configuration directory.
const SETTINGS_FILE_NAME: &str = "settings.json";

/// The configuration directory for the app, created if it does not exist.
fn settings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("The configuration folder could not be located: {error}"))?;
    fs::create_dir_all(&directory).map_err(|error| {
        format!(
            "The configuration folder {} could not be created: {error}",
            directory.display()
        )
    })?;
    Ok(directory)
}

/// Reads the settings file, or `None` when there is none yet.
///
/// A missing file is the normal first-launch case, and it is not an error.
/// Every other failure is reported, because a settings file that cannot be
/// read is a real problem the user may want to know about.
pub fn read_settings_at(path: &Path) -> Result<Option<String>, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "The settings could not be read from {}: {error}",
            path.display()
        )),
    }
}

/// Writes the settings file, replacing any existing one atomically.
pub fn write_settings_at(path: &Path, contents: &str) -> Result<(), String> {
    write_atomic(path, contents.as_bytes())
}

/// The frontend's read command: the settings, or nothing if there are none.
#[tauri::command]
pub fn read_app_settings(app: AppHandle) -> Result<Option<String>, String> {
    let path = settings_dir(&app)?.join(SETTINGS_FILE_NAME);
    read_settings_at(&path)
}

/// The frontend's write command: replace the settings file.
#[tauri::command]
pub fn write_app_settings(app: AppHandle, contents: String) -> Result<(), String> {
    let path = settings_dir(&app)?.join(SETTINGS_FILE_NAME);
    write_settings_at(&path, &contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Fresh directory per test, so tests never share state.
    fn scratch_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before epoch")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("paka-settings-{label}-{stamp}"));
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    #[test]
    fn a_missing_settings_file_is_not_an_error() {
        let dir = scratch_dir("missing");
        let path = dir.join(SETTINGS_FILE_NAME);

        let result = read_settings_at(&path);

        assert_eq!(result.expect("read"), None);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn writes_and_reads_the_settings_back() {
        let dir = scratch_dir("round-trip");
        let path = dir.join(SETTINGS_FILE_NAME);
        let text = "{\"version\":1}".to_string();

        write_settings_at(&path, &text).expect("write");
        let read = read_settings_at(&path).expect("read");

        assert_eq!(read, Some(text));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replaces_the_settings_without_leaving_temporaries() {
        let dir = scratch_dir("replace");
        let path = dir.join(SETTINGS_FILE_NAME);

        write_settings_at(&path, "{\"version\":1,\"fillTolerance\":1}").expect("first");
        write_settings_at(&path, "{\"version\":1,\"fillTolerance\":2}").expect("second");

        let read = read_settings_at(&path).expect("read");
        assert_eq!(read, Some("{\"version\":1,\"fillTolerance\":2}".to_string()));
        let entries: Vec<_> = fs::read_dir(&dir)
            .expect("list")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(entries.len(), 1, "no temporary files may survive: {entries:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_settings_file_that_cannot_be_read_is_an_error_not_a_silent_default() {
        let dir = scratch_dir("unreadable");
        // A directory where the file should be: reading it fails, and that is
        // not the same as "there is no settings file".
        let path = dir.join(SETTINGS_FILE_NAME);
        fs::create_dir_all(&path).expect("a directory in the file's place");

        let result = read_settings_at(&path);

        assert!(result.is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
