# Healthify

Healthify API and web scaffold (GitHub repository: Healthfy).

**Bootstrap status:** this commit freezes the scaffold, local defaults, and the normative auth contract below. Registration, sessions, migrations, and the PostgreSQL test suite land in the following commits on this branch. Paths, status codes, cookie attributes, and error bodies in this document are the contract frontend and QA should build against.

The frontend in `frontend/` is only a Vite + React + TypeScript shell. Feature UI is owned separately. The backend in `backend/` is FastAPI. PostgreSQL is the system of record.

## Local ports

| Service | URL |
| --- | --- |
| Frontend (Vite) | `http://localhost:5173` |
| API | `http://localhost:8000` |
| PostgreSQL | `localhost:5432` |

Use `localhost` for both the page and the API. `http://127.0.0.1:5173` is a different origin and is **not** in the default allowlist. The session cookie is host-scoped to the API host the browser used, so call the API as `http://localhost:8000` from the page at `http://localhost:5173`.

## Client rules

Send cookies on every auth call:

```ts
await fetch("http://localhost:8000/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password }),
});
```

```ts
await fetch("http://localhost:8000/auth/me", { credentials: "include" });
```

```ts
await fetch("http://localhost:8000/auth/logout", {
  method: "POST",
  credentials: "include",
});
```

- `credentials: 'include'` is required. There is no bearer token.
- The JSON body never contains a session token, password, or password hash.
- Do not put the session in `localStorage`, `sessionStorage`, or any other JS-readable store. The browser stores the `HttpOnly` cookie and JavaScript cannot read it.
- `POST /auth/register` and `POST /auth/login` use `Content-Type: application/json`.
- `POST /auth/logout` has no JSON body. Do not send one.
- Paths have no trailing slash (`redirect_slashes` is off). `/auth/login/` is not an alias.

A browser on `http://localhost:5173` sends `Origin: http://localhost:5173` on these POSTs. That origin is allowlisted by default.

Non-browser clients (curl, server-side tests) omit `Origin`. That is allowed. See [CSRF / Origin](#csrf--origin).

```bash
curl -sS -c /tmp/healthify.cookies -H 'Content-Type: application/json' \
  -d '{"name":"Ada Lovelace","email":"ada@example.com","password":"correct-horse"}' \
  http://localhost:8000/auth/register

curl -sS -b /tmp/healthify.cookies http://localhost:8000/auth/me

curl -sS -b /tmp/healthify.cookies -c /tmp/healthify.cookies -X POST \
  http://localhost:8000/auth/logout -D -
```

## User object

```json
{
  "id": "2b6e0c3a-1e4a-4f0b-9c1d-6a7b8c9d0e1f",
  "name": "Ada Lovelace",
  "email": "ada@example.com",
  "created_at": "2026-01-15T12:00:00Z"
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | UUID, hyphenated lowercase hex |
| `name` | string | Trimmed display name, 1–100 characters |
| `email` | string | Normalized email (see below) |
| `created_at` | string | ISO-8601 UTC with a `Z` suffix. Fractional seconds are included only when the timestamp has them |

## Endpoints

### `GET /health`

Operational check, not part of the auth contract.

`200`

```json
{"status": "ok"}
```

### `POST /auth/register`

Request:

```json
{"name": "Ada Lovelace", "email": "Ada@Example.com", "password": "correct-horse"}
```

`201` and `Set-Cookie: healthify_session=...` (auto-login). Response:

```json
{
  "user": {
    "id": "2b6e0c3a-1e4a-4f0b-9c1d-6a7b8c9d0e1f",
    "name": "Ada Lovelace",
    "email": "ada@example.com",
    "created_at": "2026-01-15T12:00:00Z"
  }
}
```

The stored and returned email is normalized. `password` is never echoed.

Duplicate normalized email, including a race on the unique index: `409`.

```json
{"error": {"code": "EMAIL_ALREADY_EXISTS", "message": "An account with this email already exists."}}
```

### `POST /auth/login`

Request:

```json
{"email": "Ada@Example.com", "password": "correct-horse"}
```

`200` and `Set-Cookie` with a **new** session. Older sessions stay valid until they expire or that specific session is logged out.

```json
{"user": {"id": "...", "name": "Ada Lovelace", "email": "ada@example.com", "created_at": "2026-01-15T12:00:00Z"}}
```

Unknown email and wrong password return the same body. `401`:

```json
{"error": {"code": "INVALID_CREDENTIALS", "message": "Invalid email or password."}}
```

There is no `details` object on this error. The message does not say which field was wrong.

### `GET /auth/me`

`200` `{ "user": User }` when the cookie names a session that exists, is not revoked, and `expires_at` is still in the future.

Missing cookie, unknown token, expired session, and revoked session all return `401` with the same body:

```json
{"error": {"code": "UNAUTHENTICATED", "message": "Authentication required."}}
```

`/auth/me` does not slide the expiry and does not rotate the cookie.

### `POST /auth/logout`

No JSON body.

`204` with an empty body. The current session row, if any, gets `revoked_at` set. Other sessions for that user are left alone. The response clears `healthify_session`.

Logout is idempotent: no cookie, an unknown cookie, an already revoked session, and an expired session still return `204` and still clear the cookie.

The origin guard still applies. A cross-site browser POST is `403`, not `204`.

## Validation

Invalid JSON, missing fields, wrong types, and rule failures are `422`:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input.",
    "details": {
      "fields": [
        {"field": "email", "message": "Enter a valid email address."},
        {"field": "password", "message": "Password must be at least 8 characters."}
      ]
    }
  }
}
```

`details`, when present, is only `{ "fields": [ { "field": string, "message": string } ] }`. `field` is `name`, `email`, `password`, or `body` (when the body is not a JSON object). Messages are the fixed strings below. Submitted values, including the password, are not included.

| Field | Condition | Message |
| --- | --- | --- |
| `name` | missing | Name is required. |
| `name` | not a string | Name must be a string. |
| `name` | blank after trim | Name is required. |
| `name` | longer than 100 after trim | Name must be at most 100 characters. |
| `name` | contains a character below U+0020 | Name contains invalid characters. |
| `email` | missing | Email is required. |
| `email` | not a string | Email must be a string. |
| `email` | fails email validation, or longer than 254 after normalization | Enter a valid email address. / Email must be at most 254 characters. |
| `password` | missing | Password is required. |
| `password` | not a string | Password must be a string. |
| `password` | fewer than 8 characters | Password must be at least 8 characters. |
| `password` | more than 128 characters | Password must be at most 128 characters. |
| `body` | body is not a JSON object | Request body must be valid JSON. |

Name and email are trimmed. Password is **not** trimmed; spaces count toward the length.

Email normalization, applied before uniqueness checks on register and before lookup on login:

1. Strip leading and trailing whitespace.
2. Validate the address. No DNS or deliverability lookup.
3. Lowercase the whole normalized address and store that value.
4. Reject stored values longer than 254 characters.

`Ada@Example.com` and ` ada@example.com ` are one account. Plus-tags are kept (`a+b@example.com`). Provider-specific rules such as Gmail dot removal are not applied.

Register and login use the same password length rules (8–128). A shorter login password is `422` and is **not** a failed login attempt.

Extra JSON properties are ignored.

## Rate limit

Login throttling is per immediate client IP, stored in PostgreSQL (`login_failures`) so it is shared by every API process. It is not an in-memory counter.

| Setting | Default |
| --- | --- |
| Maximum failed attempts | 5 (`LOGIN_RATE_LIMIT_MAX_FAILURES`) |
| Rolling window | 900 seconds / 15 minutes (`LOGIN_RATE_LIMIT_WINDOW_SECONDS`) |

Policy:

- A counted failure is an authentication failure after the body passed validation: unknown email or wrong password. Each one inserts one row and returns **401** `INVALID_CREDENTIALS`.
- The first 5 failed attempts inside the window return **401**.
- If 5 failures for that IP are already inside the window, the next attempt returns **429** and does not check the password and does not insert another row. A burst of blocked requests cannot extend the window.
- `Retry-After` is the whole seconds until enough of the oldest failures leave the window for the count to drop below 5. With the default of 5, that is when the oldest stored failure ages out. The value is at least 1.
- A **successful login does not delete or reset** that IP's failure rows. Logging into an account does not clear the bucket.
- `422` validation errors and `403` origin failures do not add rows.
- Registration is not covered by this limiter.

Example: 3 wrong passwords (`401`), one correct password (`200`, 3 rows remain), 2 wrong passwords (`401`, 5 rows), next attempt `429` even if the password is correct.

`429`:

```json
{"error": {"code": "RATE_LIMITED", "message": "Too many login attempts. Try again later."}}
```

`Retry-After: 800`

The header is listed in `Access-Control-Expose-Headers` so page JavaScript can read it.

Client IP is `request.client.host` (the immediate TCP peer). `X-Forwarded-For` is ignored unless `TRUST_X_FORWARDED_FOR=true`. When that flag is true, the **rightmost** hop is used, which is only correct behind one proxy that appends the peer address. If the flag is on and the client connects directly, the client can supply that value. Leave the flag false unless a trusted proxy is actually in front of the process.

Rows older than the window are deleted during a login attempt. There is no public endpoint to seed or clear this table.

## Session cookie

| Attribute | Value |
| --- | --- |
| Name | `healthify_session` |
| Value | Opaque random token (`secrets.token_urlsafe(32)`). Not a JWT. Not in the JSON body |
| HttpOnly | yes |
| SameSite | `Lax` |
| Path | `/` |
| Domain | omitted (host-only cookie) |
| Secure | `true` when `APP_ENV=production`; `false` for local HTTP development. Production refuses to boot if Secure is false |
| Max-Age | `604800` seconds (7 days), set when the session is created |

Server session row:

- Lookup key is the SHA-256 hex digest of the cookie value. The raw token is not stored.
- `expires_at` is `created_at + 7 days`. This is an absolute lifetime. Requests do not extend it.
- `revoked_at` is set only for the session presented on logout.
- Expired or revoked tokens fail `/auth/me` with `401` even if the browser still has the cookie.
- Login and register each create a new session. They do not revoke previous sessions.

Auth JSON responses also send `Cache-Control: no-store`.

## CSRF / Origin

Unsafe methods (`POST`, `PUT`, `PATCH`, `DELETE`) are origin-guarded, including register, login, and logout. `GET`, `HEAD`, and `OPTIONS` are not.

1. If `Origin` is present, it must exactly match an entry in `CORS_ORIGINS`. Otherwise `403`.
2. If `Origin` is absent and `Sec-Fetch-Site` is present: `same-origin` and `none` are allowed; any other value is `403`.
3. If `Origin` and `Sec-Fetch-Site` are both absent, the request is treated as a non-browser client and allowed.

`403` bodies:

```json
{"error": {"code": "FORBIDDEN", "message": "Origin is not allowed."}}
```

```json
{"error": {"code": "FORBIDDEN", "message": "Cross-site request was blocked."}}
```

Local development: the Vite page at `http://localhost:5173` sends `Origin: http://localhost:5173`, which matches the default allowlist. SameSite=Lax still sends the cookie on that same-site (cross-port) `fetch` because both hosts are `localhost`. A page on another site sends a foreign `Origin` and does not get the Lax cookie on cross-site POST.

`Origin: null` is not allowlisted.

## CORS

- `Access-Control-Allow-Origin` is the request `Origin` only when it is an exact allowlist member. It is never `*`.
- `Access-Control-Allow-Credentials: true`.
- Allowed methods: `GET`, `POST`, `OPTIONS`.
- Allowed request headers: `Content-Type`, `Accept`.
- Exposed response headers: `Retry-After`.

A disallowed origin does not receive `Access-Control-Allow-Origin`, so browser JavaScript cannot read the response. The origin guard still rejects disallowed browser POSTs with `403`.

## Other errors

```json
{"error": {"code": "NOT_FOUND", "message": "Not found."}}
```

```json
{"error": {"code": "METHOD_NOT_ALLOWED", "message": "Method not allowed."}}
```

```json
{"error": {"code": "INTERNAL_ERROR", "message": "Internal server error."}}
```

`details` is omitted unless the error is `VALIDATION_ERROR`. Error bodies never include the password, the session token, the password hash, or a raw database error.

## Environment variables

Copy `.env.example` to `.env` in the repository root. The API reads that file. Do not commit `.env`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_ENV` | `development` | `development`, `test`, or `production` |
| `DATABASE_URL` | `postgresql+psycopg://healthify:healthify@localhost:5432/healthify` | SQLAlchemy URL. The example password is local only |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated exact origins. `*` is rejected |
| `SESSION_COOKIE_NAME` | `healthify_session` | Cookie name |
| `SESSION_TTL_SECONDS` | `604800` | Absolute session TTL |
| `SESSION_COOKIE_SECURE` | unset: `false` unless `APP_ENV=production`, then `true` | `Secure` attribute. Production plus `false` refuses to start |
| `LOGIN_RATE_LIMIT_MAX_FAILURES` | `5` | Failed logins before `429` |
| `LOGIN_RATE_LIMIT_WINDOW_SECONDS` | `900` | Rolling window |
| `TRUST_X_FORWARDED_FOR` | `false` | When `false`, ignore `X-Forwarded-For` |

Changing the rate-limit or TTL variables changes behavior. Tests and this document assume the defaults above.

## Run locally

PostgreSQL 16. Docker is optional. This cloud VM has no Docker daemon; PostgreSQL was installed with apt. Either path is valid.

Docker:

```bash
docker compose up -d postgres
```

Apt (Debian/Ubuntu), once:

```bash
sudo service postgresql start
sudo -u postgres psql -c "CREATE ROLE healthify LOGIN PASSWORD 'healthify' SUPERUSER;"
sudo -u postgres psql -c "CREATE DATABASE healthify OWNER healthify;"
sudo -u postgres psql -c "CREATE DATABASE healthify_test OWNER healthify;"
```

`healthify_test` is also created by pytest when the role can create databases. The dev database `healthify` must exist before `alembic upgrade head`. The app does not auto-migrate on startup.

API:

```bash
cp .env.example .env
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open the API as `http://localhost:8000`. If `localhost` resolves to IPv6 `::1` and nothing is listening there, start uvicorn with `--host localhost` as well, or call the IPv4 address only after adding that origin to `CORS_ORIGINS` and using it consistently.

Frontend:

```bash
cd frontend
npm ci
npm run dev
```

Vite listens on `http://localhost:5173` only (`strictPort`). Lint and build:

```bash
npm run lint
npm run build
```

Backend lint:

```bash
cd backend
ruff check .
ruff format --check .
```

## Tests and the isolated database

Pytest refuses to run the auth suite unless the database name in `DATABASE_URL` is `healthify_test`. The suite drops and recreates schema `public` on that database, then runs `alembic upgrade head`. It does not connect to the `healthify` development database.

```bash
cd backend
source .venv/bin/activate
DATABASE_URL=postgresql+psycopg://healthify:healthify@localhost:5432/healthify_test \
APP_ENV=test \
SESSION_COOKIE_SECURE=false \
CORS_ORIGINS=http://localhost:5173 \
pytest
```

There is no production or test HTTP endpoint to move the clock, expire a session, or seed rate-limit rows.

Fixtures in `backend/tests/conftest.py` (auth suite):

| Fixture | Behavior |
| --- | --- |
| `client` | `TestClient` for the app using `healthify_test` |
| `db` | SQLAlchemy session on `healthify_test` |
| `clock` | Frozen clock installed with `app.clock.configure`. In-process only. `set` / `advance` change `clock.now()` for session expiry and the rate-limit window |
| `seed_login_failures(client_ip, attempted_at, count=1)` | Inserts `login_failures` rows through SQLAlchemy. Used to pin `Retry-After` and window edges without a debug route |

Session expiry checks either advance `clock` past the 7-day absolute `expires_at`, or update `sessions.expires_at` / `sessions.revoked_at` in `healthify_test`. Cookie `Max-Age` is not the security boundary.

## Data model

`users`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `name` | 1–100, trimmed |
| `email` | normalized, unique |
| `password_hash` | Argon2id encoded hash, never returned |
| `created_at` | `timestamptz` UTC |

`sessions`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `user_id` | FK to `users.id` |
| `token_hash` | SHA-256 hex of the cookie token, unique |
| `created_at` | `timestamptz` UTC |
| `expires_at` | absolute expiry |
| `revoked_at` | null until that session is logged out |

`login_failures`

| Column | Notes |
| --- | --- |
| `id` | UUID primary key |
| `client_ip` | immediate peer, or rightmost forwarded hop when explicitly trusted |
| `attempted_at` | `timestamptz` UTC |

Password hashing is Argon2id with explicit parameters: `time_cost=3`, `memory_cost=65536`, `parallelism=4`, `hash_len=32`, `salt_len=16`. Unknown emails still run a verify against a dummy hash so the failure path does similar work. Login failures are serialized per IP with a Postgres transaction advisory lock so two concurrent misses cannot both sneak under the cap as often. A lock collision only adds waiting; it does not merge distinct IPs on purpose beyond `hashtext` collisions, which only serialize those IPs together.

Migrations are Alembic revisions under `backend/alembic/versions`. Apply them with `alembic upgrade head` from `backend/`.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs backend ruff and pytest, and frontend `npm run lint` and `npm run build`. The auth commits add a PostgreSQL 16 service, create `healthify_test`, and run `alembic upgrade head` before pytest.

## Security limitations

- `409 EMAIL_ALREADY_EXISTS` tells the caller that the normalized email is registered. Login does not.
- Logout revokes one session. A stolen earlier cookie keeps working until that session expires or is logged out itself. Login does not invalidate other sessions.
- A stolen cookie is valid until absolute expiry or logout. Tokens are not rotated on each request.
- Clients that send neither `Origin` nor `Sec-Fetch-Site` skip the origin guard. Modern browsers send `Origin` on POST. SameSite=Lax also withholds the cookie on cross-site POST. Very old clients that do neither are the residual gap.
- The cookie name is `healthify_session`, not a `__Host-` prefixed name. `__Host-` would require `Secure`, which local HTTP cannot set. The name is fixed by contract.
- Registration is not rate limited in this P0.
- The limiter is per IP, not per account. Many users behind one NAT share five failures. Many source IPs can still guess slowly.
- There is no email verification, password reset, breach-password check, or MFA. Those are out of scope.
- Password policy is length only (8–128). Passwords are not trimmed.
- Expired session and failure rows are not swept by a background job. Failure rows older than the window are deleted on a later login attempt. Expired sessions are rejected and kept.
- Enable `TRUST_X_FORWARDED_FOR` only behind a proxy that appends the peer. Otherwise leave it false.
- Do not run `APP_ENV=development` (insecure cookie) on an untrusted network.
- Do not log request bodies at a proxy. The app logs startup config and unhandled exception paths only, without the database URL, passwords, tokens, or hashes.
- Example database credentials in `.env.example` are for local PostgreSQL only.

## Implementation notes that are not API changes

These are stricter than a literal reading of "store a session cookie" and do not change status codes or JSON:

- The database stores a SHA-256 digest of the opaque cookie, not the raw token.
- Rate-limit state is rows in PostgreSQL, not process memory.
- `Retry-After` is exposed through CORS so browser clients can read it.
- `APP_ENV=production` with `SESSION_COOKIE_SECURE=false` fails at startup.
- Validation bounds (name 1–100, email 254, password 8–128) are part of the contract above.
