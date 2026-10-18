/**
 * Native (Rust) integration.
 *
 * Reports whether the Tauri bridge answered, so the status bar can show the
 * real native environment instead of pretending one exists in a plain browser
 * preview.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface NativeEnvironment {
  readonly os: string;
  readonly arch: string;
  readonly appVersion: string;
}

export type NativeStatus = "loading" | "ready" | "unavailable";

export interface NativeEnvironmentState {
  readonly status: NativeStatus;
  readonly environment: NativeEnvironment | null;
  readonly error: string | null;
}

const INITIAL: NativeEnvironmentState = { status: "loading", environment: null, error: null };

export function useNativeEnvironment(): NativeEnvironmentState {
  const [state, setState] = useState<NativeEnvironmentState>(INITIAL);

  useEffect(() => {
    let cancelled = false;

    invoke<NativeEnvironment>("native_environment")
      .then((environment) => {
        if (!cancelled) {
          setState({ status: "ready", environment, error: null });
        }
      })
      .catch((error: unknown) => {
        // Expected when running the frontend outside the Tauri shell (plain
        // `pnpm dev`); reported in the UI rather than swallowed.
        const message = error instanceof Error ? error.message : String(error);
        if (!cancelled) {
          setState({ status: "unavailable", environment: null, error: message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
