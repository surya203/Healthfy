import { AuthApiError, AuthNetworkError, AuthProtocolError, isAbortError } from "./errors";
import { messages } from "./messages";
import { parseRetryAfter } from "./presentError";
import type { AuthClient, ErrorDetails, LoginBody, RegisterBody, RequestOptions, User } from "./types";

export const DEFAULT_API_BASE_URL = "http://localhost:8000";
export const PRODUCTION_API_BASE_URL = "/api";
export const SLOW_REQUEST_MS = 2_500;
export const REQUEST_TIMEOUT_MS = 55_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function readApiBaseUrl(value?: string, prod = false): string {
  const raw = value?.trim() ?? "";
  const base = raw.replace(/\/+$/, "");
  if (!prod) return base || DEFAULT_API_BASE_URL;
  if (base.startsWith("/") && !base.startsWith("//")) return base;
  return PRODUCTION_API_BASE_URL;
}

type Endpoint = "register" | "login" | "me" | "logout";

function fallbackFor(status: number, endpoint: Endpoint): { code: string; message: string } {
  if (status === 409 && endpoint === "register") {
    return { code: "EMAIL_ALREADY_EXISTS", message: messages.emailExists };
  }
  if (status === 401 && endpoint === "login") {
    return { code: "INVALID_CREDENTIALS", message: messages.invalidCredentials };
  }
  if (status === 401) return { code: "UNAUTHENTICATED", message: messages.unauthenticated };
  if (status === 422) return { code: "VALIDATION_ERROR", message: messages.validation };
  if (status === 429) return { code: "RATE_LIMITED", message: messages.rateLimited };
  if (status === 403) return { code: "FORBIDDEN", message: messages.forbidden };
  return { code: "REQUEST_FAILED", message: messages.generic };
}

function readDetails(value: unknown): ErrorDetails | undefined {
  if (!value || typeof value !== "object" || !("fields" in value)) return undefined;
  const fields = (value as { fields?: unknown }).fields;
  if (!Array.isArray(fields)) return undefined;
  const parsed: ErrorDetails["fields"] = [];
  for (const item of fields) {
    if (!item || typeof item !== "object") continue;
    const field = (item as { field?: unknown }).field;
    const message = (item as { message?: unknown }).message;
    if (typeof field === "string" && typeof message === "string") parsed.push({ field, message });
  }
  return parsed.length > 0 ? { fields: parsed } : undefined;
}

async function readErrorBody(response: Response): Promise<{
  code?: string;
  message?: string;
  details?: ErrorDetails;
}> {
  const text = await response.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || !("error" in parsed)) return {};
    const error = (parsed as { error?: unknown }).error;
    if (!error || typeof error !== "object") return {};
    const record = error as { code?: unknown; message?: unknown; details?: unknown };
    return {
      code: typeof record.code === "string" ? record.code : undefined,
      message: typeof record.message === "string" ? record.message : undefined,
      details: readDetails(record.details),
    };
  } catch {
    return {};
  }
}

async function readUser(response: Response): Promise<User> {
  try {
    const text = await response.text();
    return parseUser(text ? (JSON.parse(text) as unknown) : null);
  } catch (error) {
    if (error instanceof AuthProtocolError) throw error;
    throw new AuthProtocolError(messages.unexpected);
  }
}

async function fail(response: Response, endpoint: Endpoint): Promise<never> {
  const body = await readErrorBody(response);
  const fallback = fallbackFor(response.status, endpoint);
  throw new AuthApiError({
    status: response.status,
    code: body.code ?? fallback.code,
    message: body.message ?? fallback.message,
    details: body.details,
    retryAfterSeconds: response.status === 429 ? parseRetryAfter(response.headers.get("Retry-After")) : null,
  });
}

export function parseUser(value: unknown): User {
  if (!value || typeof value !== "object" || !("user" in value)) throw new AuthProtocolError(messages.unexpected);
  const user = (value as { user?: unknown }).user;
  if (!user || typeof user !== "object") throw new AuthProtocolError(messages.unexpected);
  const record = user as Record<string, unknown>;
  const id = record.id;
  const name = record.name;
  const email = record.email;
  const createdAt = record.created_at;
  if (typeof id !== "string" || !UUID_PATTERN.test(id)) throw new AuthProtocolError(messages.unexpected);
  if (typeof name !== "string" || typeof email !== "string" || typeof createdAt !== "string") {
    throw new AuthProtocolError(messages.unexpected);
  }
  if (!createdAt.endsWith("Z") || Number.isNaN(Date.parse(createdAt))) {
    throw new AuthProtocolError(messages.unexpected);
  }
  return { id, name, email, created_at: createdAt };
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort();
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

async function request(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
  body: RegisterBody | LoginBody | undefined,
  options?: RequestOptions,
): Promise<Response> {
  const headers: Record<string, string> = { Accept: "application/json" };
  let payload: string | undefined;
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(), REQUEST_TIMEOUT_MS);
  const slowId = setTimeout(() => options?.onSlow?.(), SLOW_REQUEST_MS);
  const signal = combineSignals([options?.signal, timeout.signal]);
  try {
    // The browser sets Origin. Do not set it here; that is not the CSRF protocol.
    return await fetchImpl(`${baseUrl}${path}`, {
      method,
      credentials: "include",
      cache: "no-store",
      headers,
      body: payload,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      if (options?.signal?.aborted) throw error;
      throw new AuthNetworkError(messages.slowTimeout);
    }
    throw new AuthNetworkError(messages.network);
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(slowId);
  }
}

export function createHttpAuthClient(options?: {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): AuthClient {
  const baseUrl = readApiBaseUrl(options?.baseUrl ?? import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD);
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    async register(input, requestOptions) {
      const response = await request(
        fetchImpl,
        baseUrl,
        "/auth/register",
        "POST",
        { name: input.name, email: input.email, password: input.password },
        requestOptions,
      );
      if (response.status !== 201) return fail(response, "register");
      return readUser(response);
    },
    async login(input, requestOptions) {
      const response = await request(
        fetchImpl,
        baseUrl,
        "/auth/login",
        "POST",
        { email: input.email, password: input.password },
        requestOptions,
      );
      if (response.status !== 200) return fail(response, "login");
      return readUser(response);
    },
    async me(requestOptions) {
      const response = await request(fetchImpl, baseUrl, "/auth/me", "GET", undefined, requestOptions);
      if (response.status !== 200) return fail(response, "me");
      return readUser(response);
    },
    async logout(requestOptions) {
      const response = await request(fetchImpl, baseUrl, "/auth/logout", "POST", undefined, requestOptions);
      if (response.status !== 204) return fail(response, "logout");
    },
  };
}
