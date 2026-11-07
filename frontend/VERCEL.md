# Deploy the Healthify frontend on Vercel

This is the deployment contract for the Vite app and its same-origin API proxy. It does not create a Vercel project, deploy, or store a real secret. The Render service name below is a placeholder, not a verified live host.

The proxy matches the Render contract from PR #5 (`b803f11`, now on `main`): Render accepts traffic only when `X-Healthify-Proxy-Auth` matches `TRUSTED_PROXY_SECRET` and `X-Healthify-Client-IP` is exactly one IPv4 or IPv6 address. `GET /health` and `HEAD /health` stay open on Render so its own probe can succeed. This function still fail-closes `/api/health` when its own config or visitor IP is missing; that probe never goes through Vercel.

## Dashboard settings

Set the project root to this directory. `vercel.json` cannot choose the root for you.

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Vite |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js Version | 22.x |

`frontend/vercel.json` repeats the install command, build command, output directory, and Vite preset. There is one Node.js function, `api/index.ts` (`runtime = "nodejs"`, `maxDuration = 60`). It imports `../server/proxy-handler.js`. The `.js` suffix is the file Node loads after Vercel transpiles the TypeScript; `package.json` has `"type": "module"`, so an extensionless import fails at runtime with `ERR_MODULE_NOT_FOUND`. The helper lives outside `api/` so Vercel does not publish it as its own function.

`frontend/package.json` is `"type": "module"`. Vercel therefore runs the transpiled handler as native Node ESM and does not rewrite those imports to CommonJS.

A non-Next `api/[...path]` file only matches one path segment, so `/api/health` can invoke it while `/api/auth/login` is an edge `NOT_FOUND`. The config does not use a catch-all. A rewrite sends `/api/(.*)` to the existing `/api` function. The rewrite destination is the path `/api` with no query string, so a browser query parameter cannot choose the upstream path. A `request.path` transform sets the path the function reads from `request.url` to `/api/$proxyPath`, captured from the pathname only. The function then allows only `/health`, `/auth/register`, `/auth/login`, `/auth/me`, and `/auth/logout`.

The SPA rewrite sends other routes, including unprefixed `/auth/me` and `/auth/logout`, to `/index.html`. It does not match `/api`, `/api/*`, or `/assets/*`. Those unprefixed `/auth/*` URLs are not API routes.

## Environment variables

Add these in Vercel → Settings → Environment Variables for Production and Preview. Leave them server-side. Do not enable “Expose to the client”, and do not prefix them with `VITE_`.

| Name | Scope | Value |
| --- | --- | --- |
| `TRUSTED_PROXY_SECRET` | Server only | 32-byte secret. Generate with `openssl rand -hex 32` (64 hex characters). The API rejects anything shorter than 32 characters. |
| `RENDER_API_BASE_URL` | Server only | HTTPS origin of the Render service, no path, query, or userinfo. Placeholder shape: `https://healthify-api.onrender.com`. That host is not deployed or verified by this repo. |

Store the same `TRUSTED_PROXY_SECRET` on Render (`sync: false` in `render.yaml` on the backend branch). Do not commit the output, paste it into `vercel.json`, or print it in logs. This repository's tests use an obvious fixture string, not that command's output.

`VITE_API_BASE_URL` is optional and development-only. Leave it unset in production. The production browser default is `/api`. An absolute `VITE_` URL is ignored in a production build so the page cannot skip the proxy. Local `npm run dev` keeps `http://localhost:8000`.

On Render, set `CORS_ORIGINS` to the exact page origin the browser sends, such as `https://YOUR_VERCEL_PROJECT.vercel.app`. Do not invent a CSRF token. The browser sends `Origin` itself, and the function forwards that value unchanged.

## Request path

`/api/auth/login` becomes `RENDER_API_BASE_URL + /auth/login`. The same applies to `/api/auth/register`, `/api/auth/me`, `/api/auth/logout`, and `/api/health`. The query string is preserved but never selects the path. The function rejects `..`, encoded segments, backslashes, a bare `/api`, and any other path. It does not follow redirects. A 3xx response becomes `502` with no `Location` header.

Visitor IP, from [Vercel request headers](https://vercel.com/docs/headers/request-headers):

1. `x-vercel-forwarded-for` when it is present. Vercel documents this as the same client IP as `x-forwarded-for`, and as the value that remains Vercel's if a proxy in front of Vercel overwrites `x-forwarded-for`.
2. Otherwise `x-forwarded-for`, which Vercel overwrites to stop spoofing when no outer proxy is present.

Either value must already be exactly one IPv4 or IPv6 address. A comma-separated chain is rejected. The function does not choose a hop, and it does not trust `x-real-ip`, `cf-connecting-ip`, or a caller-supplied `X-Healthify-*` header. IPv6 is sent in compressed form, matching the API's `ipaddress` normalization.

Every upstream request then sets:

| Header | Value |
| --- | --- |
| `X-Healthify-Proxy-Auth` | `TRUSTED_PROXY_SECRET` |
| `X-Healthify-Client-IP` | that single address |
| `Origin` | browser `Origin`, unchanged |
| `Cookie` | browser `Cookie`, unchanged |
| `Content-Type` | browser `Content-Type`, unchanged |

Inbound `X-Healthify-*` headers are dropped before those two are set. The body and HTTP method are forwarded. The response status, body, `Retry-After`, and every `Set-Cookie` are returned to the browser. A `Domain` attribute is removed so `healthify_session` stays host-only (`HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`) on the Vercel host.

Missing or invalid server config, or a missing or chained visitor IP, returns `503` and does not call Render. The body does not include the secret or the upstream URL.

## Cold starts

Render's free web service can take about a minute to answer after idle. The page keeps the request open for 55 seconds. After 2.5 seconds it adds: “The server may be waking up. This can take about a minute.” That sentence does not mean a cold start was verified. If the deadline passes, the form shows a retryable error. Registration, login, and logout are not sent again automatically. Leaving the page aborts the in-flight request.

`maxDuration` is 60 seconds. If the Vercel plan cuts the function off sooner, the platform may close the request before this page's own deadline. That limit was not verified against an account.
