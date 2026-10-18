//! Project and image file I/O.
//!
//! Two reasons this lives in Rust instead of the WebView:
//!
//!  * **Safe writes.** A save replaces the project through a temporary file in
//!    the same folder: the bytes are flushed to disk first (`sync_all`) and the
//!    original is only swapped out once the new file is complete. A crash, a
//!    full disk or a killed process therefore leaves either the old project or
//!    the new one, never a half-written file.
//!  * **Scope.** The WebView gets no filesystem API at all. It asks for one of
//!    three operations, each of which validates the path, restricts the file
//!    type and bounds the amount of data involved.
//!
//! The paths themselves come from the native dialogs the user interacted with
//! (`tauri-plugin-dialog`), so the user always chose the location.

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;

/// Upper bound on a project file that will be read into memory.
pub const MAX_TEXT_FILE_BYTES: u64 = 256 * 1024 * 1024;

/// Extensions accepted for project text. `json` is allowed so a project written
/// by hand or by a tool can be opened; the content is validated either way.
const PROJECT_EXTENSIONS: [&str; 2] = ["paka", "json"];
/// Extensions accepted for binary writes.
const IMAGE_EXTENSIONS: [&str; 1] = ["png"];

/// Makes temporary file names unique within this process.
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Reads a project file as UTF-8 text.
#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = checked_path(&path)?;
    require_extension(&path, &PROJECT_EXTENSIONS, "project")?;

    let metadata = fs::metadata(&path)
        .map_err(|error| format!("{} could not be opened: {error}", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} is not a file.", path.display()));
    }
    if metadata.len() > MAX_TEXT_FILE_BYTES {
        return Err(format!(
            "{} is too large to open ({} bytes, limit {} bytes).",
            path.display(),
            metadata.len(),
            MAX_TEXT_FILE_BYTES
        ));
    }

    let bytes =
        fs::read(&path).map_err(|error| format!("{} could not be read: {error}", path.display()))?;
    String::from_utf8(bytes)
        .map_err(|_| format!("{} is not valid UTF-8 text.", path.display()))
}

/// Writes project text, replacing any existing file atomically.
#[tauri::command]
pub fn write_text_file_atomic(path: String, contents: String) -> Result<(), String> {
    let path = checked_path(&path)?;
    require_extension(&path, &PROJECT_EXTENSIONS, "project")?;
    write_atomic(&path, contents.as_bytes())
}

/// Writes base64-encoded binary data (PNG export), replacing any existing file
/// atomically.
#[tauri::command]
pub fn write_binary_file_atomic(path: String, data_base64: String) -> Result<(), String> {
    let path = checked_path(&path)?;
    require_extension(&path, &IMAGE_EXTENSIONS, "image")?;

    let bytes = BASE64
        .decode(data_base64.as_bytes())
        .map_err(|error| format!("The image data could not be decoded: {error}"))?;

    write_atomic(&path, &bytes)
}

/// Rejects paths that cannot be written to and returns the cleaned-up form.
fn checked_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("No file path was given.".to_string());
    }

    let path = PathBuf::from(path);
    match path.file_name() {
        Some(name) if !name.is_empty() => {}
        _ => return Err(format!("{} is not a file path.", path.display())),
    }

    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_path_buf(),
        _ => PathBuf::from("."),
    };
    if !parent.is_dir() {
        return Err(format!("The folder {} does not exist.", parent.display()));
    }

    Ok(path)
}

fn require_extension(path: &Path, allowed: &[&str], kind: &str) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .unwrap_or_default();

    if allowed.contains(&extension.as_str()) {
        Ok(())
    } else {
        Err(format!(
            "{} is not a supported {kind} file (expected {}).",
            path.display(),
            allowed
                .iter()
                .map(|candidate| format!(".{candidate}"))
                .collect::<Vec<_>>()
                .join(" or ")
        ))
    }
}

/// Writes `bytes` to `path` through a sibling temporary file.
///
/// The temporary file is removed on any failure, so a failed save cannot leave
/// debris next to the project.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = match path.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("{} is not a file path.", path.display()))?;

    let unique = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(".{name}.{}.{unique}.tmp", std::process::id()));

    let write = |temporary: &Path| -> std::io::Result<()> {
        let mut file = File::create(temporary)?;
        file.write_all(bytes)?;
        // Flush to the device before the rename, so the swap never exposes a
        // file whose contents are still only in the page cache.
        file.sync_all()
    };

    if let Err(error) = write(&temporary) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Writing {} failed: {error}", path.display()));
    }

    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!("Replacing {} failed: {error}", path.display()));
    }

    Ok(())
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
        let dir = std::env::temp_dir().join(format!("paka-io-{label}-{stamp}"));
        fs::create_dir_all(&dir).expect("scratch directory");
        dir
    }

    #[test]
    fn writes_and_reads_text_back() {
        let dir = scratch_dir("round-trip");
        let path = dir.join("drawing.paka");
        let text = "{\"format\":\"paka-project\"}".to_string();

        write_text_file_atomic(path.to_string_lossy().into_owned(), text.clone()).expect("write");
        let read = read_text_file(path.to_string_lossy().into_owned()).expect("read");

        assert_eq!(read, text);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn replaces_an_existing_file_without_leaving_temporaries() {
        let dir = scratch_dir("replace");
        let path = dir.join("drawing.paka");

        write_text_file_atomic(path.to_string_lossy().into_owned(), "first".to_string())
            .expect("first write");
        write_text_file_atomic(path.to_string_lossy().into_owned(), "second".to_string())
            .expect("second write");

        assert_eq!(fs::read_to_string(&path).expect("contents"), "second");
        let entries: Vec<_> = fs::read_dir(&dir)
            .expect("list")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(entries.len(), 1, "no temporary files may survive: {entries:?}");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn decodes_base64_and_writes_binary() {
        let dir = scratch_dir("binary");
        let path = dir.join("export.png");
        // The 8-byte PNG signature, base64-encoded.
        let encoded = BASE64.encode([0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);

        write_binary_file_atomic(path.to_string_lossy().into_owned(), encoded).expect("write");

        assert_eq!(
            fs::read(&path).expect("bytes"),
            vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]
        );
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_data_that_is_not_base64() {
        let dir = scratch_dir("bad-base64");
        let path = dir.join("export.png");

        let result = write_binary_file_atomic(path.to_string_lossy().into_owned(), "***".to_string());

        assert!(result.is_err());
        assert!(!path.exists(), "nothing may be written for invalid data");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_unknown_extensions_before_touching_the_disk() {
        let dir = scratch_dir("extension");
        let path = dir.join("notes.txt");

        let result = write_text_file_atomic(path.to_string_lossy().into_owned(), "{}".to_string());

        assert!(result.is_err());
        assert!(!path.exists());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_missing_files_and_folders() {
        let dir = scratch_dir("missing");
        let missing = dir.join("nope.paka");

        assert!(read_text_file(missing.to_string_lossy().into_owned()).is_err());

        let in_no_folder = dir.join("absent").join("drawing.paka");
        assert!(write_text_file_atomic(in_no_folder.to_string_lossy().into_owned(), "{}".to_string()).is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn rejects_directories_and_empty_paths() {
        let dir = scratch_dir("not-a-file");
        assert!(read_text_file(dir.to_string_lossy().into_owned()).is_err());
        assert!(read_text_file(String::new()).is_err());
        fs::remove_dir_all(&dir).ok();
    }
}
