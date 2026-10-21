//! Native side of Paka.
//!
//! The frontend owns the drawing engine; Rust is used for native integration
//! and for work the WebView genuinely should not do itself. Today that is:
//!
//!  * reporting the host environment (`native_environment`),
//!  * the native open/save dialogs (`tauri-plugin-dialog`),
//!  * reading and atomically replacing project and image files (`project_io`),
//!  * storing the per-user settings file (`settings_io`).

mod native_environment;
mod project_io;
mod settings_io;

use native_environment::native_environment;
use project_io::{read_text_file, write_binary_file_atomic, write_text_file_atomic};
use settings_io::{read_app_settings, write_app_settings};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            native_environment,
            read_text_file,
            write_text_file_atomic,
            write_binary_file_atomic,
            read_app_settings,
            write_app_settings
        ])
        .run(tauri::generate_context!())
        .expect("failed to start the Paka application");
}
