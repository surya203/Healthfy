import { proxyRequest, readProxyConfig } from "./proxy-handler";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  return proxyRequest(request, readProxyConfig(process.env));
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
export const OPTIONS = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
