import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const forbidden = [
  "TRUSTED_PROXY_SECRET",
  "RENDER_API_BASE_URL",
  "X-Healthify-Proxy-Auth",
  "X-Healthify-Client-IP",
  "x-healthify-proxy-auth",
  "healthify-api.onrender.com",
];

async function files(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else if (/\.(?:js|css|html|map)$/u.test(entry.name)) found.push(path);
  }
  return found;
}

const bundled = await files(fileURLToPath(new URL("../dist", import.meta.url)));
const leaks = [];
for (const path of bundled) {
  const text = await readFile(path, "utf8");
  for (const needle of forbidden) {
    if (text.includes(needle)) leaks.push(`${path} contains ${needle}`);
  }
}
if (leaks.length > 0) {
  console.error(leaks.join("\n"));
  process.exit(1);
}
