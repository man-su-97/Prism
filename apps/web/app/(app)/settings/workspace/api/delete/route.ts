import { NextRequest, NextResponse } from "next/server";

import { backendFetch } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "/api/workspaces/delete-preview",
  "/api/workspaces/delete",
]);

async function proxy(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (!target || !ALLOWED.has(target)) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  const init: RequestInit = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    const body = await req.text();
    if (body) init.body = body;
  }
  const res = await backendFetch(target, init);
  const body = await res.text();
  const hasBody = body.length > 0 && res.status !== 204 && res.status !== 304;
  return new NextResponse(hasBody ? body : null, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
