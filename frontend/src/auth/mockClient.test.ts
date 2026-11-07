import { describe, expect, it, vi } from "vitest";
import { messages } from "./messages";
import { createMockAuthClient } from "./mockClient";

describe("createMockAuthClient", () => {
  it("auto-logs in after register and keeps the raw password", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const client = createMockAuthClient();
    const password = "  correct-horse";
    const user = await client.register({ name: "  Ada Lovelace ", email: " Ada@Example.com ", password });
    expect(user.name).toBe("Ada Lovelace");
    expect(user.email).toBe("ada@example.com");
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(user.created_at.endsWith("Z")).toBe(true);
    await expect(client.me()).resolves.toEqual(user);
    await client.logout();
    await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(client.login({ email: "ada@example.com", password: "correct-horse" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
      message: messages.invalidCredentials,
    });
    await expect(client.login({ email: "ADA@example.com", password })).resolves.toEqual(user);
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it("returns a clear duplicate-email error", async () => {
    const client = createMockAuthClient();
    await client.register({ name: "Ada", email: "ada@example.com", password: "correct-horse" });
    await expect(
      client.register({ name: "Ada", email: " Ada@Example.com ", password: "correct-horse" }),
    ).rejects.toMatchObject({ status: 409, code: "EMAIL_ALREADY_EXISTS", message: messages.emailExists });
  });

  it("does not count validation failures and rate limits the sixth attempt", async () => {
    const client = createMockAuthClient();
    const user = await client.register({ name: "Ada", email: "ada@example.com", password: "correct-horse" });
    await client.logout();
    await expect(client.login({ email: "ada@example.com", password: "short" })).rejects.toMatchObject({
      status: 422,
      code: "VALIDATION_ERROR",
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(client.login({ email: "ada@example.com", password: "wrong-pass" })).rejects.toMatchObject({
        status: 401,
        code: "INVALID_CREDENTIALS",
      });
    }
    await expect(client.login({ email: "ada@example.com", password: "correct-horse" })).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      message: messages.rateLimited,
    });
    await expect(client.me()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(user.email).toBe("ada@example.com");
  });

  it("does not reset the failure window after a successful login", async () => {
    const client = createMockAuthClient();
    await client.register({ name: "Ada", email: "ada@example.com", password: "correct-horse" });
    await client.logout();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(client.login({ email: "missing@example.com", password: "wrong-pass" })).rejects.toMatchObject({
        status: 401,
      });
    }
    await expect(client.login({ email: "ada@example.com", password: "correct-horse" })).resolves.toMatchObject({
      email: "ada@example.com",
    });
    await client.logout();
    await client.logout();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expect(client.login({ email: "ada@example.com", password: "wrong-pass" })).rejects.toMatchObject({
        status: 401,
      });
    }
    await expect(client.login({ email: "ada@example.com", password: "correct-horse" })).rejects.toMatchObject({
      status: 429,
    });
  });
});
