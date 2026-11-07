import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { AuthApiError, AuthNetworkError } from "./errors";
import { createHttpAuthClient } from "./httpClient";
import { messages } from "./messages";
import { ada, jsonResponse, networkError, stubClient } from "../test/fixtures";
import { pathName, renderApp } from "../test/renderApp";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (reason: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function showRegister() {
  expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
}

async function fillRegister(
  user: ReturnType<typeof userEvent.setup>,
  values: { name: string; email: string; password: string; confirmPassword: string },
) {
  await user.type(screen.getByLabelText("Name"), values.name);
  await user.type(screen.getByLabelText("Email"), values.email);
  await user.type(screen.getByLabelText("Password"), values.password);
  await user.type(screen.getByLabelText("Confirm password"), values.confirmPassword);
}

describe("registration", () => {
  it("shows inline validation and does not submit", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderApp(client, "/register");
    await showRegister();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toEqual([
      messages.nameRequired,
      messages.emailRequired,
      messages.passwordRequired,
      messages.confirmRequired,
    ]);
    expect(screen.getByText(messages.emailRequired)).toBeInTheDocument();
    expect(screen.getByText(messages.passwordRequired)).toBeInTheDocument();
    expect(screen.getByText(messages.confirmRequired)).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(client.register).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation before calling the API", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderApp(client, "/register");
    await showRegister();
    await fillRegister(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse ",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText(messages.confirmMismatch)).toBeInTheDocument();
    expect(screen.getByLabelText("Confirm password")).toHaveAttribute("aria-describedby", expect.stringContaining("confirmPassword-error"));
    expect(client.register).not.toHaveBeenCalled();
  });

  it("shows a clear duplicate-email message and stays signed out", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      register: vi.fn().mockRejectedValue(
        new AuthApiError({
          status: 409,
          code: "EMAIL_ALREADY_EXISTS",
          message: messages.emailExists,
          retryAfterSeconds: null,
        }),
      ),
    });
    renderApp(client, "/register");
    await showRegister();
    await fillRegister(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText(messages.emailExists)).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Welcome/ })).not.toBeInTheDocument();
  });

  it("signs the user in after a successful registration without browser storage", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const client = stubClient({ register: vi.fn().mockResolvedValue(ada) });
    renderApp(client, "/register");
    await showRegister();
    await fillRegister(user, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "  secret1",
      confirmPassword: "  secret1",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText(ada.email)).toBeInTheDocument();
    expect(pathName()).toBe("/");
    expect(client.register).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "  secret1",
    });
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).toBe("");
  });
});

describe("login", () => {
  it("shows one generic invalid-credentials error", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      login: vi.fn().mockRejectedValue(
        new AuthApiError({
          status: 401,
          code: "INVALID_CREDENTIALS",
          message: messages.invalidCredentials,
          retryAfterSeconds: null,
        }),
      ),
    });
    renderApp(client, "/login");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(messages.invalidCredentials);
    expect(alert).toHaveFocus();
    expect(screen.queryByText(/wrong password/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/incorrect/i)).not.toBeInTheDocument();
  });

  it("blocks a short password before the request so it is not a failed login", async () => {
    const user = userEvent.setup();
    const client = stubClient();
    renderApp(client, "/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "short");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByText(messages.passwordMin)).toBeInTheDocument();
    expect(client.login).not.toHaveBeenCalled();
  });

  it("announces rate limit, forbidden, and network failures", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      login: vi
        .fn()
        .mockRejectedValueOnce(
          new AuthApiError({
            status: 429,
            code: "RATE_LIMITED",
            message: messages.rateLimited,
            retryAfterSeconds: 900,
          }),
        )
        .mockRejectedValueOnce(
          new AuthApiError({
            status: 403,
            code: "FORBIDDEN",
            message: "Origin is not allowed.",
            retryAfterSeconds: null,
          }),
        )
        .mockRejectedValueOnce(networkError()),
    });
    renderApp(client, "/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/try again in 15 minutes/i);
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Origin is not allowed.");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.network);
  });
});

describe("session", () => {
  it("shows a loading announcement before hydration finishes", async () => {
    const pending = deferred<typeof ada>();
    const client = stubClient({ me: vi.fn().mockReturnValue(pending.promise) });
    renderApp(client, "/");
    expect(screen.getByRole("status")).toHaveTextContent("Checking your session…");
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    pending.resolve(ada);
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
  });

  it("hydrates an existing session onto the home page", async () => {
    const client = stubClient({ me: vi.fn().mockResolvedValue(ada) });
    renderApp(client, "/");
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("dateTime", ada.created_at);
    expect(pathName()).toBe("/");
    expect(client.me).toHaveBeenCalledTimes(1);
  });

  it("redirects an anonymous visit to login", async () => {
    const client = stubClient();
    renderApp(client, "/");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() => expect(pathName()).toBe("/login"));
  });

  it("keeps a failed session check off the login form until it can be retried", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      me: vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValueOnce(ada),
    });
    renderApp(client, "/");
    expect(await screen.findByRole("heading", { name: "Session check failed" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(messages.network);
    expect(screen.queryByRole("heading", { name: "Sign in" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
  });

  it("logs out and sends the user to login", async () => {
    const user = userEvent.setup();
    const client = stubClient({ me: vi.fn().mockResolvedValue(ada) });
    renderApp(client, "/");
    await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" });
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(client.logout).toHaveBeenCalledTimes(1);
    expect(pathName()).toBe("/login");
    expect(screen.getByRole("heading", { name: "Sign in" })).toHaveFocus();
  });

  it("stays signed in when logout fails", async () => {
    const user = userEvent.setup();
    const client = stubClient({
      me: vi.fn().mockResolvedValue(ada),
      logout: vi.fn().mockRejectedValue(new AuthNetworkError(messages.network)),
    });
    renderApp(client, "/");
    await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" });
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.network);
    expect(screen.getByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it("moves through the register form in order and submits from the button", async () => {
    const user = userEvent.setup();
    const client = stubClient({ register: vi.fn().mockResolvedValue(ada) });
    renderApp(client, "/register");
    await showRegister();
    await user.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
    await user.tab();
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await user.keyboard("Ada Lovelace");
    await user.tab();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await user.keyboard("ada@example.com");
    await user.tab();
    expect(screen.getByLabelText("Password")).toHaveFocus();
    await user.keyboard("correct-horse");
    await user.tab();
    expect(screen.getByLabelText("Confirm password")).toHaveFocus();
    await user.keyboard("correct-horse");
    await user.tab();
    expect(screen.getByRole("button", { name: "Create account" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
  });

  it("links between login and register", async () => {
    const user = userEvent.setup();
    renderApp(stubClient(), "/login");
    await screen.findByRole("heading", { name: "Sign in" });
    await user.click(screen.getByRole("link", { name: "Create an account" }));
    expect(await screen.findByRole("heading", { name: "Create your account" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Create your account" })).toHaveFocus();
  });
});

describe("http adapter wired through the UI", () => {
  it("posts registration and renders the returned user", async () => {
    const user = userEvent.setup();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: messages.unauthenticated } });
      if (url.endsWith("/auth/register")) {
        expect(init?.credentials).toBe("include");
        expect(new Headers(init?.headers).get("Origin")).toBeNull();
        expect(JSON.parse(String(init?.body))).toEqual({
          name: "Ada Lovelace",
          email: "Ada@Example.com",
          password: "correct-horse",
        });
        return jsonResponse(201, { user: ada });
      }
      throw new Error(`unexpected ${url}`);
    });
    renderApp(createHttpAuthClient({ fetchImpl, baseUrl: "http://localhost:8000" }), "/register");
    await showRegister();
    await fillRegister(user, {
      name: "Ada Lovelace",
      email: "Ada@Example.com",
      password: "correct-horse",
      confirmPassword: "correct-horse",
    });
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByRole("heading", { name: "Welcome, Ada Lovelace" })).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("shows a server validation error and a generic login failure", async () => {
    const user = userEvent.setup();
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/me")) {
        return jsonResponse(401, { error: { code: "UNAUTHENTICATED", message: messages.unauthenticated } });
      }
      if (url.endsWith("/auth/login")) {
        return jsonResponse(401, { error: { code: "INVALID_CREDENTIALS", message: messages.invalidCredentials } });
      }
      throw new Error(`unexpected ${url}`);
    });
    render(
      <MemoryRouter initialEntries={["/login"]}>
        <App client={createHttpAuthClient({ fetchImpl, baseUrl: "http://localhost:8000" })} />
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Sign in" });
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-pass");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(messages.invalidCredentials);
    expect(fetchImpl.mock.calls.some((call) => String(call[0]).endsWith("/auth/login"))).toBe(true);
  });
});
