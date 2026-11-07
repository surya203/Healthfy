import { AuthApiError } from "./errors";
import { messages } from "./messages";
import type { AuthClient, FieldIssue, LoginBody, RegisterBody, User } from "./types";
import { validateEmail, validateName, validatePassword } from "./validation";

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 5;

function validationError(fields: FieldIssue[]): AuthApiError {
  return new AuthApiError({
    status: 422,
    code: "VALIDATION_ERROR",
    message: messages.validation,
    details: { fields },
    retryAfterSeconds: null,
  });
}

function issuesFor(input: RegisterBody | LoginBody, includeName: boolean): FieldIssue[] {
  const fields: FieldIssue[] = [];
  if (includeName && "name" in input) {
    const name = validateName(input.name);
    if (name) fields.push({ field: "name", message: name });
  }
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);
  if (email) fields.push({ field: "email", message: email });
  if (password) fields.push({ field: "password", message: password });
  return fields;
}

/**
 * Explicit dev/test double. Production builds must not construct it.
 * The password map lives only in this closure so login can be checked.
 * It is not written to browser storage, logs, or disk.
 */
export function createMockAuthClient(): AuthClient {
  if (import.meta.env.PROD) {
    throw new Error("healthify-auth-mock cannot run in production");
  }

  const users = new Map<string, { user: User; password: string }>();
  let session: User | null = null;
  const failures: number[] = [];

  function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  function prune(now: number) {
    while (failures.length > 0 && failures[0]! <= now - WINDOW_MS) failures.shift();
  }

  return {
    async register(input) {
      const fields = issuesFor(input, true);
      if (fields.length > 0) throw validationError(fields);
      const email = normalizeEmail(input.email);
      if (users.has(email)) {
        throw new AuthApiError({
          status: 409,
          code: "EMAIL_ALREADY_EXISTS",
          message: messages.emailExists,
          retryAfterSeconds: null,
        });
      }
      const user: User = {
        id: crypto.randomUUID(),
        name: input.name.trim(),
        email,
        created_at: new Date().toISOString(),
      };
      users.set(email, { user, password: input.password });
      session = user;
      return user;
    },
    async login(input) {
      const fields = issuesFor(input, false);
      if (fields.length > 0) throw validationError(fields);
      const now = Date.now();
      prune(now);
      if (failures.length >= MAX_FAILURES) {
        const retryAfterSeconds = Math.max(1, Math.ceil((failures[0]! + WINDOW_MS - now) / 1000));
        throw new AuthApiError({
          status: 429,
          code: "RATE_LIMITED",
          message: messages.rateLimited,
          retryAfterSeconds,
        });
      }
      const record = users.get(normalizeEmail(input.email));
      if (!record || record.password !== input.password) {
        failures.push(now);
        throw new AuthApiError({
          status: 401,
          code: "INVALID_CREDENTIALS",
          message: messages.invalidCredentials,
          retryAfterSeconds: null,
        });
      }
      session = record.user;
      return record.user;
    },
    async me() {
      if (!session) {
        throw new AuthApiError({
          status: 401,
          code: "UNAUTHENTICATED",
          message: messages.unauthenticated,
          retryAfterSeconds: null,
        });
      }
      return session;
    },
    async logout() {
      session = null;
    },
  };
}
