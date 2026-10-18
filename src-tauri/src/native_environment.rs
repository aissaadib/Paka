//! Native environment reporting.
//!
//! The frontend calls this once at startup. It is deliberately cheap: its job
//! is to prove the IPC bridge is wired and to let the status bar report the
//! real host instead of guessing, rather than to do any heavy lifting.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeEnvironment {
    pub os: String,
    pub arch: String,
    pub app_version: String,
}

impl NativeEnvironment {
    /// Reads the host triple facts compiled into this binary.
    pub fn detect() -> Self {
        Self {
            os: std::env::consts::OS.to_string(),
            arch: std::env::consts::ARCH.to_string(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
        }
    }
}

#[tauri::command]
pub fn native_environment() -> NativeEnvironment {
    NativeEnvironment::detect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_host_constants_and_crate_version() {
        let environment = NativeEnvironment::detect();
        assert!(!environment.os.is_empty());
        assert!(!environment.arch.is_empty());
        assert_eq!(environment.app_version, env!("CARGO_PKG_VERSION"));
    }

    #[test]
    fn serializes_to_camel_case_for_the_frontend() {
        let json = serde_json::to_string(&NativeEnvironment::detect()).expect("serializes");
        assert!(json.contains("\"appVersion\""));
        assert!(json.contains("\"os\""));
        assert!(json.contains("\"arch\""));
    }
}
