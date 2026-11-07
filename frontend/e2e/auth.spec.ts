import AxeBuilder from "@axe-core/playwright";
import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

const artifacts = "/opt/cursor/artifacts";

function uniqueEmail(label: string): string {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
}

function clearLoginFailures(): void {
  execFileSync(
    "psql",
    ["-h", "127.0.0.1", "-U", "healthify", "-d", "healthify", "-c", "DELETE FROM login_failures;"],
    { env: { ...process.env, PGPASSWORD: "healthify" }, stdio: "pipe" },
  );
}

async function noBrowserSecrets(page: Page): Promise<void> {
  const storage = await page.evaluate(async () => ({
    local: localStorage.length,
    session: sessionStorage.length,
    cookie: document.cookie,
    databases: (await indexedDB.databases?.()) ?? [],
  }));
  expect(storage.local).toBe(0);
  expect(storage.session).toBe(0);
  expect(storage.cookie).not.toContain("healthify_session");
  expect(storage.databases).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const health = await fetch("http://localhost:8000/health");
  if (!health.ok) throw new Error(`API is not ready (${health.status}).`);
  const app = await fetch("http://localhost:5173/");
  if (!app.ok) throw new Error(`Frontend is not ready (${app.status}).`);
  clearLoginFailures();
});

test.beforeEach(async ({ context }) => {
  await context.clearCookies();
});

test("client validation does not call the API", async ({ page }) => {
  const registrations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/auth/register")) registrations.push(request.url());
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/register");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `${artifacts}/healthify-register-mobile.png`, fullPage: true });

  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Name is required.")).toBeVisible();
  await expect(page.getByText("Email is required.")).toBeVisible();
  await expect(page.getByText("Password is required.")).toBeVisible();
  await expect(page.getByText("Confirm your password.")).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Name")).toBeFocused();

  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill("ada@example.com");
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByLabel("Confirm password").fill("correct-horse ");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Passwords do not match.")).toBeVisible();
  await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-describedby", /confirmPassword-error/);
  expect(registrations).toEqual([]);
  await page.screenshot({ path: `${artifacts}/healthify-register-validation.png`, fullPage: true });
});

test("keyboard registration signs the user in", async ({ page }) => {
  const email = uniqueEmail("keys");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/register");
  await page.screenshot({ path: `${artifacts}/healthify-register-desktop.png`, fullPage: true });
  const empty = await new AxeBuilder({ page }).analyze();
  expect(empty.violations).toEqual([]);

  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Name")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.getByLabel("Name").focus();
  await page.keyboard.type("Grace Hopper");
  await page.keyboard.press("Tab");
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct-horse");
  await page.keyboard.press("Tab");
  await page.keyboard.type("correct-horse");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("heading", { name: "Welcome, Grace Hopper" })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await noBrowserSecrets(page);
  const session = (await page.context().cookies("http://localhost:8000")).find((cookie) => cookie.name === "healthify_session");
  expect(session?.httpOnly).toBe(true);
  expect(session?.sameSite).toBe("Lax");
  expect(session?.path).toBe("/");
  expect(session?.secure).toBe(false);
  const home = await new AxeBuilder({ page }).analyze();
  expect(home.violations).toEqual([]);
  await page.screenshot({ path: `${artifacts}/healthify-home.png`, fullPage: true });
});

test("session hydration, logout, login, and duplicate email use the API", async ({ page }) => {
  const email = uniqueEmail("flow");
  await page.goto("/register");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByLabel("Confirm password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeVisible();
  await expect(page.getByText(email.toLowerCase())).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeVisible();
  await noBrowserSecrets(page);

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  await expect(page.getByText(/wrong password/i)).toHaveCount(0);
  await expect(page.getByText(/not found/i)).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/healthify-login-invalid.png`, fullPage: true });

  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const loggedOut = await page.evaluate(async () => {
    const first = await fetch("http://localhost:8000/auth/logout", { method: "POST", credentials: "include" });
    const second = await fetch("http://localhost:8000/auth/logout", { method: "POST", credentials: "include" });
    return [first.status, second.status];
  });
  expect(loggedOut).toEqual([204, 204]);

  await page.goto("/register");
  await page.getByLabel("Name").fill("Ada Lovelace");
  await page.getByLabel("Email").fill(`  ${email.toUpperCase()}  `);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByLabel("Confirm password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("An account with this email already exists.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toHaveCount(0);
});

test("password spaces are kept and a trimmed password does not match", async ({ page }) => {
  const email = uniqueEmail("spaces");
  const password = "  correct-horse";
  await page.goto("/register");
  await page.getByLabel("Name").fill("Space User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Space User" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");

  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Space User" })).toBeVisible();
});

test("login rate limit survives a successful login", async ({ page }) => {
  clearLoginFailures();
  const email = uniqueEmail("limit");
  await page.goto("/register");
  await page.getByLabel("Name").fill("Limit User");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByLabel("Confirm password").fill("correct-horse");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Limit User" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("wrong-pass");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  }

  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Welcome, Limit User" })).toBeVisible();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("wrong-pass");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert")).toHaveText("Invalid email or password.");
  }

  await page.getByLabel("Password", { exact: true }).fill("correct-horse");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("Too many login attempts. Try again later.");
  await expect(page.getByRole("alert")).toContainText(/try again in \d+ minute/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/healthify-rate-limit.png`, fullPage: true });
});

test("a foreign Origin is forbidden and does not become a login failure", async ({ request }) => {
  clearLoginFailures();
  const response = await request.post("http://localhost:8000/auth/login", {
    headers: {
      Origin: "http://evil.example",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    data: { email: "ada@example.com", password: "correct-horse" },
  });
  expect(response.status()).toBe(403);
  const body = (await response.json()) as { error: { code: string } };
  expect(body.error.code).toBe("FORBIDDEN");
});

test("login page has no accessibility violations on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: `${artifacts}/healthify-login-mobile.png`, fullPage: true });
});
