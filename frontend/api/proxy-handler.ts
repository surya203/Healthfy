/**
 * Same-origin Vercel server proxy for the Healthify API.
 *
 * Visitor IP comes only from headers Vercel overwrites, per
 * https://vercel.com/docs/headers/request-headers :
 * `x-vercel-forwarded-for` is the platform copy that stays Vercel's when an
 * outer proxy overwrites `x-forwarded-for`. `x-forwarded-for` is used only
 * when the platform header is absent, and only if it is already one address.
 * A comma-separated chain is rejected. The value is not taken from any hop
 * the caller can choose.
 *
 * Compatible with backend PR #5 (b803f11): Render accepts a request only when
 * `X-Healthify-Proxy-Auth` matches TRUSTED_PROXY_SECRET and
 * `X-Healthify-Client-IP` is one IPv4 or IPv6 address. This module is not
 * imported by the browser bundle.
 */

export const PROXY_AUTH_HEADER = "x-healthify-proxy-auth";
export const CLIENT_IP_HEADER = "x-healthify-client-ip";
export const PLATFORM_IP_HEADER = "x-vercel-forwarded-for";
export const FALLBACK_PLATFORM_IP_HEADER = "x-forwarded-for";

const MIN_SECRET_LENGTH = 32;
const UPSTREAM_TIMEOUT_MS = 55_000;

export type ProxyConfig = {
  secret: string;
  upstream: URL;
};

export function parseSingleIp(value: string | null | undefined): string | null {
  if (value == null) return null;
  const candidate = value.trim();
  if (!candidate || candidate.includes(",") || /\s/u.test(candidate)) return null;
  if (candidate.startsWith("[") || candidate.includes("/") || candidate.includes("%")) return null;
  if (!candidate.includes(":")) return parseIpv4(candidate);
  return parseIpv6(candidate);
}

export function readPlatformClientIp(headers: Headers): string | null {
  if (headers.has(PLATFORM_IP_HEADER)) {
    return parseSingleIp(headers.get(PLATFORM_IP_HEADER));
  }
  if (headers.has(FALLBACK_PLATFORM_IP_HEADER)) {
    return parseSingleIp(headers.get(FALLBACK_PLATFORM_IP_HEADER));
  }
  return null;
}

export function parseSecret(value: string | undefined): string | null {
  if (!value || value.length < MIN_SECRET_LENGTH || value.length > 256) return null;
  if (/\s/u.test(value)) return null;
  return value;
}

export function parseUpstreamBase(
  value: string | undefined,
  options?: { allowInsecureLoopback?: boolean },
): URL | null {
  if (!value || /\s/u.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:") return url;
  if (options?.allowInsecureLoopback && url.protocol === "http:" && loopback) return url;
  return null;
}

export function readProxyConfig(
  env: Record<string, string | undefined>,
  options?: { allowInsecureLoopback?: boolean },
): ProxyConfig | null {
  const secret = parseSecret(env.TRUSTED_PROXY_SECRET);
  const upstream = parseUpstreamBase(env.RENDER_API_BASE_URL, options);
  if (!secret || !upstream) return null;
  return { secret, upstream };
}

export function stripApiPath(pathname: string): string | null {
  if (!pathname.startsWith("/api/") && pathname !== "/api") return null;
  const rest = pathname === "/api" ? "/" : pathname.slice(4);
  if (!rest.startsWith("/") || rest.startsWith("//")) return null;
  if (rest.includes("\\") || rest.includes("\0")) return null;
  if (/%(?:2e|2f|5c|00)/iu.test(rest)) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rest);
  } catch {
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0") || decoded.includes("://") || decoded.startsWith("//")) {
    return null;
  }
  if (/%(?:2e|2f|5c|00)/iu.test(decoded)) return null;
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) return null;
  return rest;
}

export function stripCookieDomain(setCookie: string): string | null {
  if (/[\r\n\0]/u.test(setCookie)) return null;
  const parts = setCookie
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const kept = parts.filter((part, index) => {
    if (index === 0) return true;
    return part.split("=")[0]?.trim().toLowerCase() !== "domain";
  });
  return kept.join("; ");
}

function unavailable(status: 502 | 503): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: status === 503 ? "UNAVAILABLE" : "BAD_GATEWAY",
        message: "The API is unavailable.",
      },
    }),
    {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    },
  );
}

function isHealthifyHeader(name: string): boolean {
  return name.toLowerCase().startsWith("x-healthify-");
}

export async function proxyRequest(
  request: Request,
  config: ProxyConfig | null,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  if (!config) return unavailable(503);
  const incoming = new URL(request.url);
  const path = stripApiPath(incoming.pathname);
  const clientIp = readPlatformClientIp(request.headers);
  if (!path || !clientIp) return unavailable(503);

  const target = new URL(path, config.upstream);
  target.search = incoming.search;
  if (target.origin !== config.upstream.origin || !target.pathname.startsWith("/")) return unavailable(503);

  const method = request.method.toUpperCase();
  if (!/^[A-Z]+$/u.test(method) || method === "TRACE" || method === "CONNECT") return unavailable(503);

  const headers = new Headers();
  for (const name of ["origin", "cookie", "content-type", "accept"]) {
    if (isHealthifyHeader(name)) continue;
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set(PROXY_AUTH_HEADER, config.secret);
  headers.set(CLIENT_IP_HEADER, clientIp);

  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  let upstream: Response;
  try {
    upstream = await fetchImpl(target, {
      method,
      headers,
      body: body && body.byteLength > 0 ? body : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return unavailable(502);
  }

  if (upstream.type === "opaqueredirect" || upstream.status === 0 || (upstream.status >= 300 && upstream.status < 400)) {
    return unavailable(502);
  }

  const responseHeaders = new Headers();
  for (const name of ["content-type", "cache-control", "pragma", "retry-after"]) {
    const value = upstream.headers.get(name);
    if (value && !/[\r\n\0]/u.test(value)) responseHeaders.set(name, value);
  }
  const setCookies = typeof upstream.headers.getSetCookie === "function" ? upstream.headers.getSetCookie() : [];
  for (const cookie of setCookies) {
    const safe = stripCookieDomain(cookie);
    if (!safe) return unavailable(502);
    responseHeaders.append("set-cookie", safe);
  }

  if (method === "HEAD" || upstream.status === 204 || upstream.status === 304) {
    return new Response(null, { status: upstream.status, headers: responseHeaders });
  }
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: responseHeaders });
}

function parseIpv4(value: string): string | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const numbers: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/u.test(part)) return null;
    if (part.length > 1 && part.startsWith("0")) return null;
    const number = Number(part);
    if (number > 255) return null;
    numbers.push(number);
  }
  return numbers.join(".");
}

function parseIpv6(value: string): string | null {
  let head = value;
  const lastColon = value.lastIndexOf(":");
  const lastDot = value.lastIndexOf(".");
  if (lastDot > lastColon) {
    const dotted = parseIpv4(value.slice(lastColon + 1));
    if (!dotted) return null;
    const octets = dotted.split(".").map(Number);
    const high = ((octets[0]! << 8) | octets[1]!).toString(16);
    const low = ((octets[2]! << 8) | octets[3]!).toString(16);
    head = `${value.slice(0, lastColon + 1)}${high}:${low}`;
  }
  if (head.includes(":::")) return null;
  const halves = head.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (!side) return [];
    const groups = side.split(":");
    if (groups.some((group) => !/^[0-9a-fA-F]{1,4}$/u.test(group))) return null;
    return groups.map((group) => Number.parseInt(group, 16));
  };
  const left = parseSide(halves[0] ?? "");
  if (!left) return null;
  if (halves.length === 1) {
    if (left.length !== 8) return null;
    return compressIpv6(left);
  }
  const right = parseSide(halves[1] ?? "");
  if (!right || left.length + right.length >= 8) return null;
  const zeros = Array<number>(8 - left.length - right.length).fill(0);
  return compressIpv6([...left, ...zeros, ...right]);
}

function compressIpv6(groups: number[]): string {
  const ipv4Mapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (ipv4Mapped) {
    const high = groups[6] ?? 0;
    const low = groups[7] ?? 0;
    return `::ffff:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  let bestStart = -1;
  let bestLength = 0;
  let index = 0;
  while (index < groups.length) {
    if (groups[index] !== 0) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === 0) end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  const left = hex.slice(0, bestStart).join(":");
  const right = hex.slice(bestStart + bestLength).join(":");
  if (!left && !right) return "::";
  if (!left) return `::${right}`;
  if (!right) return `${left}::`;
  return `${left}::${right}`;
}
