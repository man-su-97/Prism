import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Browser-facing proxy so the UploadDropzone can hit `/datasets/api?path=...`
 * without a separate API origin. Forwards method + body to FastAPI under the
 * caller's JWT.
 */
async function proxy(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target || !target.startsWith("/api/")) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  const init: RequestInit = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) init.body = body;
  }
  const res = await backendFetch(target, init);
  const body = await res.text();
  // 204/304 responses are spec'd as null-body; passing even an empty string
  // makes the Response constructor throw "Invalid response status code 204".
  const hasBody = body.length > 0 && res.status !== 204 && res.status !== 304;
  return new NextResponse(hasBody ? body : null, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

export const GET = proxy;
export const POST = proxy;
export const DELETE = proxy;
