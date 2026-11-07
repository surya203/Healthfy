import { proxyRequest, readProxyConfig } from "../server/proxy-handler.js";

export const runtime = "nodejs";
export const maxDuration = 60;

function handle(request: Request): Promise<Response> {
  return proxyRequest(request, readProxyConfig(process.env));
}

export default { fetch: handle };
export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
