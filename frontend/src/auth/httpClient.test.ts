import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthApiError, AuthNetworkError, AuthProtocolError } from "./errors";
import { createHttpAuthClient, parseUser, readApiBaseUrl, REQUEST_TIMEOUT_MS, SLOW_REQUEST_MS } from "./httpClient";
import { messages } from "./messages";
import { ada, jsonResponse } from "../test/fixtures";

function clientWith(fetchImpl: typeof fetch) {
  return createHttpAuthClient({ fetchImpl, baseUrl: "http://localhost:8000" });
}

function callInit(fetchImpl: ReturnType<typeof vi.fn>, index = 0): RequestInit {
  return fetchImpl.mock.calls[index]?.[1] as RequestInit;
}

describe("readApiBaseUrl", () => {
  it("defaults to the local API and strips a trailing slash", () => {
    expect(readApiBaseUrl(undefined)).toBe("http://localhost:8000");
    expect(readApiBaseUrl(" http://localhost:8000/ ")).toBe("http://localhost:8000");
    expect(readApiBaseUrl("/api")).toBe("/api");
  });

  it("uses the same-origin proxy in production and ignores an absolute override", () => {
    expect(readApiBaseUrl(undefined, true)).toBe("/api");
    expect(readApiBaseUrl("http://localhost:8000", true)).toBe("/api");
    expect(readApiBaseUrl("https://healthify-api.example", true)).toBe("/api");
    expect(readApiBaseUrl("/api/", true)).toBe("/api");
  });
});

describe("parseUser", () => {
  it("accepts the contract user and ignores extra properties", () => {
    expect(parseUser({ user: { ...ada, token: "nope", password: "nope" } })).toEqual(ada);
  });

  it("rejects a body that is not the user envelope", () => {
    expect(() => parseUser({ user: { ...ada, id: "not-a-uuid" } })).toThrow(AuthProtocolError);
    expect(() => parseUser({ id: ada.id })).toThrow(AuthProtocolError);
    expect(() => parseUser({ user: { ...ada, created_at: "2026-01-15T12:00:00+00:00" } })).toThrow(AuthProtocolError);
  });
});

describe("createHttpAuthClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers with credentials and the raw password, and never writes browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(201, { user: ada }));
    const client = clientWith(fetchImpl);
    const password = "  secret1";

    await expect(
      client.register({ name: "  Ada Lovelace  ", email: " Ada@Example.com ", password }),
    ).resolves.toEqual(ada);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://localhost:8000/auth/register");
    const init = callInit(fetchImpl);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect(init.cache).toBe("no-store");
    expect(JSON.parse(String(init.body))).toEqual({
      name: "  Ada Lovelace  ",
      email: " Ada@Example.com ",
      password,
    });
    expect(Object.keys(JSON.parse(String(init.body))).sort()).toEqual(["email", "name", "password"]);
    const headers = new Headers(init.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Origin")).toBeNull();
    expect(headers.get("Authorization")).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });

  it("logs in with the same cookie rules and a generic 401", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: messages.invalidCredentials } }),
    );
    const client = clientWith(fetchImpl);
    await expect(client.login({ email: "ada@example.com", password: "wrong-pass" })).rejects.toMatchObject({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: messages.invalidCredentials,
      details: undefined,
    });
    const init = callInit(fetchImpl);
    expect(init.credentials).toBe("include");
    expect(JSON.parse(String(init.body))).toEqual({ email: "ada@example.com", password: "wrong-pass" });
  });

  it("reads /auth/me with credentials and no body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { user: ada }));
    const client = clientWith(fetchImpl);
    await expect(client.me()).resolves.toEqual(ada);
    const init = callInit(fetchImpl);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe("http://localhost:8000/auth/me");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("include");
    expect(init.body).toBeUndefined();
    expect(new Headers(init.headers).get("Content-Type")).toBeNull();
  });

  it("treats missing and unknown sessions as unauthenticated", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: messages.unauthenticated } }),
    );
    const client = clientWith(fetchImpl);
    await expect(client.me()).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("logs out with an empty idempotent POST", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const client = clientWith(fetchImpl);
    await expect(client.logout()).resolves.toBeUndefined();
    await expect(client.logout()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(String(call[0])).toBe("http://localhost:8000/auth/logout");
      expect(init.method).toBe("POST");
      expect(init.credentials).toBe("include");
      expect(init.body).toBeUndefined();
      expect(new Headers(init.headers).get("Content-Type")).toBeNull();
      expect(new Headers(init.headers).get("Origin")).toBeNull();
    }
  });

  it("parses validation, duplicate email, rate limit, and forbidden errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(422, {
          error: {
            code: "VALIDATION_ERROR",
            message: messages.validation,
            details: { fields: [{ field: "password", message: messages.passwordMin }] },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(409, { error: { code: "EMAIL_ALREADY_EXISTS", message: messages.emailExists } }))
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { code: "RATE_LIMITED", message: messages.rateLimited } }, { "Retry-After": "800" }),
      )
      .mockResolvedValueOnce(jsonResponse(403, { error: { code: "FORBIDDEN", message: "Origin is not allowed." } }));
    const client = clientWith(fetchImpl);

    await expect(client.register({ name: "Ada", email: "ada@example.com", password: "short" })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
      details: { fields: [{ field: "password", message: messages.passwordMin }] },
    });
    await expect(client.register({ name: "Ada", email: "ada@example.com", password: "correct-horse" })).rejects.toMatchObject({
      status: 409,
      code: "EMAIL_ALREADY_EXISTS",
      message: messages.emailExists,
    });
    await expect(client.login({ email: "ada@example.com", password: "wrong-pass" })).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      retryAfterSeconds: 800,
    });
    await expect(client.login({ email: "ada@example.com", password: "wrong-pass" })).rejects.toMatchObject({
      status: 403,
      code: "FORBIDDEN",
      message: "Origin is not allowed.",
    });
  });

  it("turns transport failures into a network error and rethrows a caller abort", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    const client = clientWith(fetchImpl);
    fetchImpl.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(client.me()).rejects.toBeInstanceOf(AuthNetworkError);

    const controller = new AbortController();
    const pending = client.me({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("announces a slow request once and does not send it again after the deadline", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn<typeof fetch>(
        (_input, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), {
              once: true,
            });
          }),
      );
      const client = clientWith(fetchImpl);
      let slow = 0;
      const pending = client.me({
        onSlow: () => {
          slow += 1;
        },
      });
      const timedOut = expect(pending).rejects.toThrow(messages.slowTimeout);
      await vi.advanceTimersByTimeAsync(SLOW_REQUEST_MS);
      expect(slow).toBe(1);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - SLOW_REQUEST_MS);
      await timedOut;
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a success body that is not a user", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(200, { user: { name: "Ada" } }));
    const client = clientWith(fetchImpl);
    await expect(client.login({ email: "ada@example.com", password: "correct-horse" })).rejects.toBeInstanceOf(
      AuthProtocolError,
    );
  });

  it("does not put the password on the thrown error", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: messages.invalidCredentials } }),
    );
    const client = clientWith(fetchImpl);
    const password = "correct-horse";
    try {
      await client.login({ email: "ada@example.com", password });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthApiError);
      expect(JSON.stringify(error)).not.toContain(password);
    }
  });
});
