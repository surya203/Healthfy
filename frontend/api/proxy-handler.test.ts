/**
 * @vitest-environment node
 */
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT } from "./[...path]";
import {
  parseSecret,
  parseSingleIp,
  parseUpstreamBase,
  proxyRequest,
  readPlatformClientIp,
  readProxyConfig,
  stripApiPath,
  stripCookieDomain,
} from "./proxy-handler";

const SECRET = "fixture-not-a-real-secret-32bytes!";
const UPSTREAM = "https://healthify-api.example";

function config() {
  return readProxyConfig({
    TRUSTED_PROXY_SECRET: SECRET,
    RENDER_API_BASE_URL: UPSTREAM,
  });
}

function incoming(
  path: string,
  init: { method?: string; headers?: HeadersInit; body?: string } = {},
): Request {
  return new Request(`https://healthify.example${path}`, init);
}

function platformHeaders(ip = "203.0.113.10", extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set("x-vercel-forwarded-for", ip);
  return headers;
}

describe("parseSingleIp", () => {
  it("accepts one IPv4 or IPv6 address and compresses IPv6", () => {
    expect(parseSingleIp("203.0.113.10")).toBe("203.0.113.10");
    expect(parseSingleIp(" 2001:0db8:0000:0000:0000:0000:0000:0001 ")).toBe("2001:db8::1");
    expect(parseSingleIp("::1")).toBe("::1");
    expect(parseSingleIp("::")).toBe("::");
    expect(parseSingleIp("2001:db8::")).toBe("2001:db8::");
    expect(parseSingleIp("2001:db8:0:0:1:0:0:1")).toBe("2001:db8::1:0:0:1");
    expect(parseSingleIp("::ffff:203.0.113.10")).toBe("::ffff:203.0.113.10");
  });

  it("rejects chains, ports, zones, and non-addresses", () => {
    for (const malformed of [
      null,
      "",
      "   ",
      "203.0.113.10, 198.51.100.20",
      "203.0.113.10 198.51.100.20",
      "not-an-ip",
      "203.0.113.10:443",
      "[2001:db8::1]",
      "2001:db8::1%eth0",
      "203.0.113.0/24",
      "01.2.3.4",
      "203.0.113.256",
    ]) {
      expect(parseSingleIp(malformed)).toBeNull();
    }
  });
});

describe("platform IP selection", () => {
  it("prefers the Vercel platform header over x-forwarded-for", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.10",
      "x-forwarded-for": "198.51.100.20",
      "x-real-ip": "192.0.2.9",
    });
    expect(readPlatformClientIp(headers)).toBe("203.0.113.10");
  });

  it("uses a single overwritten x-forwarded-for only when the platform header is absent", () => {
    expect(readPlatformClientIp(new Headers({ "x-forwarded-for": "203.0.113.10" }))).toBe("203.0.113.10");
    expect(
      readPlatformClientIp(new Headers({ "x-forwarded-for": "198.51.100.9, 203.0.113.10" })),
    ).toBeNull();
  });

  it("does not fall through a chained platform header", () => {
    const headers = new Headers({
      "x-vercel-forwarded-for": "203.0.113.10, 198.51.100.20",
      "x-forwarded-for": "203.0.113.10",
    });
    expect(readPlatformClientIp(headers)).toBeNull();
  });
});

describe("server config", () => {
  it("requires a 32-character secret and an https origin with no path", () => {
    expect(parseSecret("short-secret")).toBeNull();
    expect(parseSecret(`${"f".repeat(31)}`)).toBeNull();
    expect(parseSecret("f".repeat(32))).toBe("f".repeat(32));
    expect(parseSecret(`${"f".repeat(32)}\n`)).toBeNull();
    expect(parseUpstreamBase("https://healthify-api.example")).toBeInstanceOf(URL);
    expect(parseUpstreamBase("https://healthify-api.example/extra")).toBeNull();
    expect(parseUpstreamBase("http://healthify-api.example")).toBeNull();
    expect(parseUpstreamBase("https://user:pass@healthify-api.example")).toBeNull();
    expect(parseUpstreamBase(undefined)).toBeNull();
    expect(readProxyConfig({})).toBeNull();
    expect(readProxyConfig({ TRUSTED_PROXY_SECRET: SECRET })).toBeNull();
  });

  it("does not treat the documented placeholder as a configured target", () => {
    expect(readProxyConfig({ TRUSTED_PROXY_SECRET: SECRET, RENDER_API_BASE_URL: "" })).toBeNull();
  });
});

describe("path safety", () => {
  it("strips /api and rejects traversal", () => {
    expect(stripApiPath("/api/auth/login")).toBe("/auth/login");
    expect(stripApiPath("/api/health")).toBe("/health");
    expect(stripApiPath("/api/auth/login/")).toBe("/auth/login/");
    expect(stripApiPath("/auth/login")).toBeNull();
    expect(stripApiPath("/api/../secret")).toBeNull();
    expect(stripApiPath("/api/auth/%2e%2e/secret")).toBeNull();
    expect(stripApiPath("/api/auth/%2fsecret")).toBeNull();
    expect(stripApiPath("/api//evil.example")).toBeNull();
    expect(stripApiPath("/api/https://evil.example/x")).toBeNull();
    expect(stripApiPath("/api/auth/%252e%252e/secret")).toBeNull();
  });
});

describe("proxyRequest", () => {
  it("replaces proxy headers, forwards method, origin, cookie, content-type, and body", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const response = await proxyRequest(
      incoming("/api/auth/login?next=1", {
        method: "POST",
        headers: platformHeaders("2001:0db8:0000:0000:0000:0000:0000:0001", {
          origin: "https://healthify.example",
          cookie: "healthify_session=abc",
          "content-type": "application/json; charset=utf-8",
          accept: "application/json",
          "x-healthify-proxy-auth": "attacker-secret-should-be-dropped!!",
          "X-Healthify-Client-IP": "198.51.100.20",
          "X-HEALTHIFY-EXTRA": "nope",
          authorization: "Bearer leaked",
          "x-forwarded-for": "198.51.100.20, 203.0.113.11",
        }),
        body: '{"email":"ada@example.com","password":"correct-horse"}',
      }),
      config(),
      fetchImpl,
    );

    expect(response.status).toBe(204);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://healthify-api.example/auth/login?next=1");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("manual");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-healthify-proxy-auth")).toBe(SECRET);
    expect(headers.get("x-healthify-client-ip")).toBe("2001:db8::1");
    expect(headers.get("origin")).toBe("https://healthify.example");
    expect(headers.get("cookie")).toBe("healthify_session=abc");
    expect(headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-forwarded-for")).toBeNull();
    expect(headers.get("x-healthify-extra")).toBeNull();
    const names: string[] = [];
    headers.forEach((_value, name) => names.push(name));
    expect(names.filter((name) => name.startsWith("x-healthify-")).sort()).toEqual([
      "x-healthify-client-ip",
      "x-healthify-proxy-auth",
    ]);
    expect(await new Response(init?.body).text()).toBe('{"email":"ada@example.com","password":"correct-horse"}');
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).not.toContain(SECRET);
  });

  it("passes status, body, retry-after, and multiple host-only cookies", async () => {
    const upstreamHeaders = new Headers({
      "content-type": "application/json",
      "cache-control": "no-store",
      "retry-after": "800",
    });
    upstreamHeaders.append(
      "set-cookie",
      "healthify_session=one; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=healthify-api.example",
    );
    upstreamHeaders.append("set-cookie", "healthify_other=two; Path=/; Domain=evil.example");
    const fetchImpl = vi.fn<typeof fetch>(
      async () => new Response('{"error":{"code":"RATE_LIMITED","message":"Too many login attempts. Try again later."}}', {
        status: 429,
        headers: upstreamHeaders,
      }),
    );
    const response = await proxyRequest(
      incoming("/api/auth/login", { method: "POST", headers: platformHeaders(), body: "{}" }),
      config(),
      fetchImpl,
    );
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "RATE_LIMITED", message: "Too many login attempts. Try again later." },
    });
    expect(response.headers.get("retry-after")).toBe("800");
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.getSetCookie()).toEqual([
      "healthify_session=one; HttpOnly; Secure; SameSite=Lax; Path=/",
      "healthify_other=two; Path=/",
    ]);
    expect(response.headers.getSetCookie().join("\n")).not.toMatch(/domain=/i);
  });

  it("fails closed without calling upstream when config or the IP is unusable", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const missing = await proxyRequest(incoming("/api/auth/me", { headers: platformHeaders() }), null, fetchImpl);
    const chained = await proxyRequest(
      incoming("/api/auth/me", {
        headers: { "x-vercel-forwarded-for": "203.0.113.10, 198.51.100.20" },
      }),
      config(),
      fetchImpl,
    );
    const spoofedOnly = await proxyRequest(
      incoming("/api/auth/me", { headers: { "x-healthify-client-ip": "203.0.113.10" } }),
      config(),
      fetchImpl,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    for (const response of [missing, chained, spoofedOnly]) {
      expect(response.status).toBe(503);
      const text = await response.text();
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain("healthify-api");
    }
  });

  it("does not follow or forward a redirect to another host", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example/steal" },
        }),
    );
    const response = await proxyRequest(
      incoming("/api/auth/me", { headers: platformHeaders() }),
      config(),
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
    expect(response.status).toBe(502);
    expect(response.headers.get("location")).toBeNull();
    const text = await response.text();
    expect(text).not.toContain("evil.example");
    expect(text).not.toContain(SECRET);
  });

  it("does not leak the secret when the upstream is down", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new TypeError("connect ECONNREFUSED");
    });
    const response = await proxyRequest(
      incoming("/api/health", { headers: platformHeaders() }),
      config(),
      fetchImpl,
    );
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(SECRET);
  });
});

describe("loopback integration", () => {
  let server: Server | undefined;

  afterEach(async () => {
    server?.close();
    if (server) await once(server, "close");
    server = undefined;
  });

  it("forwards a real request and returns both cookies", async () => {
    const seen: { headers: Record<string, string | string[] | undefined>; body: string; url: string | undefined } = {
      headers: {},
      body: "",
      url: undefined,
    };
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        seen.headers = req.headers;
        seen.body = Buffer.concat(chunks).toString("utf8");
        seen.url = req.url;
        res.writeHead(200, [
          "content-type",
          "application/json",
          "set-cookie",
          "healthify_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=healthify-api.example",
          "set-cookie",
          "healthify_other=def; Path=/",
          "retry-after",
          "3",
        ]);
        res.end('{"ok":true}');
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a tcp port");
    const local = readProxyConfig(
      {
        TRUSTED_PROXY_SECRET: SECRET,
        RENDER_API_BASE_URL: `http://127.0.0.1:${address.port}`,
      },
      { allowInsecureLoopback: true },
    );
    expect(readProxyConfig({ TRUSTED_PROXY_SECRET: SECRET, RENDER_API_BASE_URL: `http://127.0.0.1:${address.port}` })).toBeNull();

    const response = await proxyRequest(
      incoming("/api/auth/register", {
        method: "POST",
        headers: platformHeaders("203.0.113.10", {
          origin: "https://healthify.example",
          cookie: "healthify_session=old",
          "content-type": "application/json",
        }),
        body: '{"name":"Ada"}',
      }),
      local,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("retry-after")).toBe("3");
    expect(response.headers.getSetCookie()).toEqual([
      "healthify_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/",
      "healthify_other=def; Path=/",
    ]);
    expect(seen.url).toBe("/auth/register");
    expect(seen.body).toBe('{"name":"Ada"}');
    expect(seen.headers["x-healthify-proxy-auth"]).toBe(SECRET);
    expect(seen.headers["x-healthify-client-ip"]).toBe("203.0.113.10");
    expect(seen.headers.origin).toBe("https://healthify.example");
    expect(seen.headers.cookie).toBe("healthify_session=old");
    expect(seen.headers["content-type"]).toBe("application/json");
  });
});

describe("vercel routing config", () => {
  it("does not rewrite /api or assets to the SPA shell or an external host", () => {
    const configFile = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")) as {
      rewrites: { source: string; destination: string }[];
      framework: string;
      installCommand: string;
      buildCommand: string;
      outputDirectory: string;
    };
    expect(configFile.framework).toBe("vite");
    expect(configFile.installCommand).toBe("npm ci");
    expect(configFile.buildCommand).toBe("npm run build");
    expect(configFile.outputDirectory).toBe("dist");
    expect(configFile.rewrites).toHaveLength(1);
    const rewrite = configFile.rewrites[0];
    expect(rewrite?.destination).toBe("/index.html");
    expect(rewrite?.destination).not.toMatch(/^https?:/u);
    const pattern = new RegExp(`^${rewrite?.source ?? ""}$`, "u");
    expect(pattern.test("/api/auth/login")).toBe(false);
    expect(pattern.test("/api")).toBe(false);
    expect(pattern.test("/assets/index-abc.js")).toBe(false);
    expect(pattern.test("/login")).toBe(true);
    expect(pattern.test("/")).toBe(true);
  });

  it("exports a node function for every forwarded method", () => {
    expect(GET).toBeTypeOf("function");
    expect(POST).toBe(GET);
    expect(HEAD).toBe(GET);
    expect(OPTIONS).toBe(GET);
    expect(PUT).toBe(GET);
    expect(PATCH).toBe(GET);
    expect(DELETE).toBe(GET);
  });
});

describe("cookie domain", () => {
  it("removes only the Domain attribute", () => {
    expect(
      stripCookieDomain("healthify_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/; Domain=healthify-api.example"),
    ).toBe("healthify_session=abc; HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(stripCookieDomain("healthify_session=abc\r\nSet-Cookie: evil=1")).toBeNull();
  });
});
