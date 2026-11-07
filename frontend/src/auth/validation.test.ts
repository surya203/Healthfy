import { describe, expect, it } from "vitest";
import { messages } from "./messages";
import { validateLogin, validateRegistration } from "./validation";

const valid = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  password: "correct-horse",
  confirmPassword: "correct-horse",
};

describe("validateRegistration", () => {
  it("requires every field", () => {
    expect(validateRegistration({ name: " ", email: " ", password: "", confirmPassword: "" })).toEqual({
      name: messages.nameRequired,
      email: messages.emailRequired,
      password: messages.passwordRequired,
      confirmPassword: messages.confirmRequired,
    });
  });

  it("rejects a short password and a mismatched confirmation", () => {
    expect(
      validateRegistration({ ...valid, password: "short", confirmPassword: "other" }),
    ).toMatchObject({
      password: messages.passwordMin,
      confirmPassword: messages.confirmMismatch,
    });
  });

  it("rejects a password longer than 128 characters", () => {
    const password = "a".repeat(129);
    expect(validateRegistration({ ...valid, password, confirmPassword: password })).toMatchObject({
      password: messages.passwordMax,
    });
  });

  it("keeps surrounding spaces in the password length and the match", () => {
    const password = "  secret1";
    expect(validateRegistration({ ...valid, password, confirmPassword: password })).toEqual({});
    expect(validateRegistration({ ...valid, password, confirmPassword: "secret1" })).toMatchObject({
      confirmPassword: messages.confirmMismatch,
    });
    expect(validateRegistration({ ...valid, password: "        ", confirmPassword: "        " })).toEqual({});
    expect(validateRegistration({ ...valid, password: "       ", confirmPassword: "       " })).toMatchObject({
      password: messages.passwordMin,
    });
  });

  it("trims name and email only for the check", () => {
    expect(validateRegistration({ ...valid, name: "  Ada  ", email: " Ada@Example.com " })).toEqual({});
    expect(validateRegistration({ ...valid, name: "x".repeat(101) })).toMatchObject({ name: messages.nameMax });
    expect(validateRegistration({ ...valid, name: "Ada\nLovelace" })).toMatchObject({
      name: messages.nameInvalid,
    });
    expect(validateRegistration({ ...valid, email: `${"a".repeat(250)}@b.co` })).toMatchObject({
      email: messages.emailMax,
    });
    expect(validateRegistration({ ...valid, email: "not-an-email" })).toMatchObject({
      email: messages.emailInvalid,
    });
  });
});

describe("validateLogin", () => {
  it("uses the same password length rule and does not trim", () => {
    expect(validateLogin({ email: "ada@example.com", password: "short" })).toEqual({
      password: messages.passwordMin,
    });
    expect(validateLogin({ email: "ada@example.com", password: "        " })).toEqual({});
  });
});
