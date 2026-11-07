import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAuthClient, resolveAuthMode } from "./createAuthClient";
import { messages } from "./messages";

describe("resolveAuthMode", () => {
  it("never selects the mock for a production build", () => {
    expect(resolveAuthMode({ prod: true, authMode: "mock" })).toBe("http");
    expect(resolveAuthMode({ prod: true })).toBe("http");
    expect(resolveAuthMode({ prod: true, authMode: "http" })).toBe("http");
  });

  it("selects the mock only for the exact non-production flag", () => {
    expect(resolveAuthMode({ prod: false, authMode: "mock" })).toBe("mock");
    expect(resolveAuthMode({ prod: false, authMode: "MOCK" })).toBe("http");
    expect(resolveAuthMode({ prod: false, authMode: "mock " })).toBe("http");
    expect(resolveAuthMode({ prod: false })).toBe("http");
  });
});

describe("loadAuthClient", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses HTTP unless mock mode is explicitly enabled", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(JSON.stringify({ error: { code: "UNAUTHENTICATED", message: messages.unauthenticated } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchImpl);
    const client = await loadAuthClient();
    await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it("uses the in-memory mock only when VITE_AUTH_MODE=mock outside production", async () => {
    vi.stubEnv("VITE_AUTH_MODE", "mock");
    const fetchImpl = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchImpl);
    const client = await loadAuthClient();
    await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
