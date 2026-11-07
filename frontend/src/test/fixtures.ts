import { vi } from "vitest";
import { AuthApiError, AuthNetworkError } from "../auth/errors";
import { messages } from "../auth/messages";
import type { AuthClient, User } from "../auth/types";

export const ada: User = {
  id: "2b6e0c3a-1e4a-4f0b-9c1d-6a7b8c9d0e1f",
  name: "Ada Lovelace",
  email: "ada@example.com",
  created_at: "2026-01-15T12:00:00Z",
};

export function unauthenticated(): AuthApiError {
  return new AuthApiError({
    status: 401,
    code: "UNAUTHENTICATED",
    message: messages.unauthenticated,
    retryAfterSeconds: null,
  });
}

export function networkError(): AuthNetworkError {
  return new AuthNetworkError(messages.network);
}

export function stubClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    register: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    me: vi.fn().mockRejectedValue(unauthenticated()),
    ...overrides,
  };
}

export function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}
