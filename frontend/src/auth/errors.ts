import type { ErrorDetails } from "./types";

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: ErrorDetails;
  readonly retryAfterSeconds: number | null;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    details?: ErrorDetails;
    retryAfterSeconds: number | null;
  }) {
    super(init.message);
    this.name = "AuthApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

export class AuthNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthNetworkError";
  }
}

export class AuthProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthProtocolError";
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}
