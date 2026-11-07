import { AuthApiError, AuthNetworkError, AuthProtocolError } from "./errors";
import { messages } from "./messages";

const SERVER_FIELDS = new Set(["name", "email", "password"]);

export type PresentedError = {
  banner?: string;
  fields?: Record<string, string>;
};

export function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) return null;
  return value;
}

export function withRetryAfter(message: string, retryAfterSeconds: number | null): string {
  if (retryAfterSeconds == null || retryAfterSeconds <= 0) return message;
  if (retryAfterSeconds < 60) {
    const unit = retryAfterSeconds === 1 ? "second" : "seconds";
    return `${message} You can try again in ${retryAfterSeconds} ${unit}.`;
  }
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const unit = minutes === 1 ? "minute" : "minutes";
  return `${message} You can try again in ${minutes} ${unit}.`;
}

export function presentAuthError(error: unknown): PresentedError {
  if (error instanceof AuthNetworkError || error instanceof AuthProtocolError) {
    return { banner: error.message };
  }
  if (!(error instanceof AuthApiError)) {
    return { banner: messages.generic };
  }
  if (error.code === "VALIDATION_ERROR") {
    const fields: Record<string, string> = {};
    const extras: string[] = [];
    for (const issue of error.details?.fields ?? []) {
      if (SERVER_FIELDS.has(issue.field)) fields[issue.field] = issue.message;
      else extras.push(issue.message);
    }
    const banner = extras[0] ?? (Object.keys(fields).length === 0 ? error.message : undefined);
    return { fields, banner };
  }
  if (error.code === "EMAIL_ALREADY_EXISTS") {
    return { fields: { email: error.message || messages.emailExists } };
  }
  if (error.code === "INVALID_CREDENTIALS") {
    return { banner: error.message || messages.invalidCredentials };
  }
  if (error.code === "RATE_LIMITED") {
    return { banner: withRetryAfter(error.message || messages.rateLimited, error.retryAfterSeconds) };
  }
  if (error.code === "FORBIDDEN") {
    return { banner: error.message || messages.forbidden };
  }
  return { banner: error.message || messages.generic };
}
