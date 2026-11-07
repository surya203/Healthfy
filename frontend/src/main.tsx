import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./App";
import { createHttpAuthClient } from "./auth/httpClient";
import type { AuthClient } from "./auth/types";
import "./index.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root was not found.");
}

async function bootClient(): Promise<AuthClient> {
  if (import.meta.env.PROD) {
    return createHttpAuthClient();
  }
  const { loadAuthClient } = await import("./auth/createAuthClient");
  return loadAuthClient();
}

void bootClient().then((client) => {
  createRoot(root).render(
    <StrictMode>
      <BrowserRouter>
        <App client={client} />
      </BrowserRouter>
    </StrictMode>,
  );
});
