import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { App } from "../App";
import type { AuthClient } from "../auth/types";

function PathProbe() {
  const location = useLocation();
  return <p data-testid="path">{location.pathname}</p>;
}

export function renderApp(client: AuthClient, path = "/login") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PathProbe />
      <App client={client} />
    </MemoryRouter>,
  );
}

export function pathName(): string {
  return screen.getByTestId("path").textContent ?? "";
}
