import { createHttpAuthClient } from "./httpClient";
import type { AuthClient } from "./types";

export type AuthModeEnv = {
  prod: boolean;
  authMode?: string;
};

/**
 * Mock mode is an exact opt-in and only applies outside production builds.
 * `vite build` sets `prod`, so `VITE_AUTH_MODE=mock` cannot replace the API.
 */
export function resolveAuthMode(env: AuthModeEnv): "http" | "mock" {
  if (env.prod) return "http";
  return env.authMode === "mock" ? "mock" : "http";
}

export async function loadAuthClient(): Promise<AuthClient> {
  if (import.meta.env.PROD) {
    return createHttpAuthClient();
  }
  if (resolveAuthMode({ prod: false, authMode: import.meta.env.VITE_AUTH_MODE }) === "mock") {
    const { createMockAuthClient } = await import("./mockClient");
    return createMockAuthClient();
  }
  return createHttpAuthClient();
}
