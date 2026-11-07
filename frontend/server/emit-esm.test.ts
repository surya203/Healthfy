/**
 * @vitest-environment node
 *
 * Compiles the Vercel handler with tsc the way Node ESM will load it, then
 * imports that emitted JavaScript with native Node. Vitest's resolver is not
 * used for this import.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const tsc = require.resolve("typescript/bin/tsc");
const frontendRoot = join(import.meta.dirname, "..");

describe("emitted Vercel handler", () => {
  let outputDir = "";

  afterEach(() => {
    if (outputDir) rmSync(outputDir, { recursive: true, force: true });
  });

  it("imports under native Node ESM and does not publish the helper as an api function", async () => {
    outputDir = mkdtempSync(join(tmpdir(), "healthify-api-emit-"));
    execFileSync(process.execPath, [tsc, "-p", "tsconfig.api.emit.json", "--outDir", outputDir], {
      cwd: frontendRoot,
      stdio: "pipe",
    });

    const handlerSource = readFileSync(join(outputDir, "api/index.js"), "utf8");
    expect(handlerSource).toContain('from "../server/proxy-handler.js"');
    expect(handlerSource).not.toMatch(/from ["']\.\/proxy-handler["']/u);
    expect(readFileSync(join(outputDir, "server/proxy-handler.js"), "utf8")).toContain("export");

    const loaded = (await import(pathToFileURL(join(outputDir, "api/index.js")).href)) as {
      default: { fetch: (request: Request) => Promise<Response> };
    };
    const response = await loaded.default.fetch(new Request("https://healthify.example/api/auth/login"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("TRUSTED_PROXY_SECRET");
  });
});
