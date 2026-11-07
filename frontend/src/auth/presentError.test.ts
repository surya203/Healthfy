import { describe, expect, it } from "vitest";
import { AuthApiError, AuthNetworkError, AuthProtocolError } from "./errors";
import { messages } from "./messages";
import { parseRetryAfter, presentAuthError, withRetryAfter } from "./presentError";

describe("presentAuthError", () => {
  it("maps validation fields and leaves unknown fields on the banner", () => {
    const error = new AuthApiError({
      status: 422,
      code: "VALIDATION_ERROR",
      message: messages.validation,
      details: {
        fields: [
          { field: "email", message: messages.emailInvalid },
          { field: "body", message: "Request body must be valid JSON." },
        ],
      },
      retryAfterSeconds: null,
    });
    expect(presentAuthError(error)).toEqual({
      fields: { email: messages.emailInvalid },
      banner: "Request body must be valid JSON.",
    });
  });

  it("puts a duplicate email on the email field", () => {
    const error = new AuthApiError({
      status: 409,
      code: "EMAIL_ALREADY_EXISTS",
      message: messages.emailExists,
      retryAfterSeconds: null,
    });
    expect(presentAuthError(error)).toEqual({ fields: { email: messages.emailExists } });
  });

  it("keeps invalid credentials generic and off individual fields", () => {
    const error = new AuthApiError({
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: messages.invalidCredentials,
      details: { fields: [{ field: "password", message: "Wrong password." }] },
      retryAfterSeconds: null,
    });
    expect(presentAuthError(error)).toEqual({ banner: messages.invalidCredentials });
  });

  it("adds a friendly retry time to rate limits", () => {
    const error = new AuthApiError({
      status: 429,
      code: "RATE_LIMITED",
      message: messages.rateLimited,
      retryAfterSeconds: 900,
    });
    expect(presentAuthError(error).banner).toBe(
      "Too many login attempts. Try again later. You can try again in 15 minutes.",
    );
  });

  it("shows forbidden, network, and protocol messages", () => {
    expect(
      presentAuthError(
        new AuthApiError({
          status: 403,
          code: "FORBIDDEN",
          message: "Cross-site request was blocked.",
          retryAfterSeconds: null,
        }),
      ).banner,
    ).toBe("Cross-site request was blocked.");
    expect(presentAuthError(new AuthNetworkError(messages.network)).banner).toBe(messages.network);
    expect(presentAuthError(new AuthProtocolError(messages.unexpected)).banner).toBe(messages.unexpected);
    expect(presentAuthError(new Error("password=secret"))).toEqual({ banner: messages.generic });
  });
});

describe("retry after", () => {
  it("parses whole seconds only", () => {
    expect(parseRetryAfter("800")).toBe(800);
    expect(parseRetryAfter(" 90 ")).toBe(90);
    expect(parseRetryAfter("900.5")).toBeNull();
    expect(parseRetryAfter("Wed, 21 Oct 2015 07:28:00 GMT")).toBeNull();
  });

  it("phrases seconds and minutes", () => {
    expect(withRetryAfter("Later.", 1)).toBe("Later. You can try again in 1 second.");
    expect(withRetryAfter("Later.", 45)).toBe("Later. You can try again in 45 seconds.");
    expect(withRetryAfter("Later.", 60)).toBe("Later. You can try again in 1 minute.");
    expect(withRetryAfter("Later.", 90)).toBe("Later. You can try again in 2 minutes.");
    expect(withRetryAfter("Later.", null)).toBe("Later.");
  });
});
