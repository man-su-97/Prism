import { NextRequest, NextResponse } from "next/server";

import { backendUserFetch } from "@/lib/backend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Thin proxy so the client-side DeleteAccountPanel can hit a same-origin URL
 * for the account-teardown preview and POST. Uses the org-less JWT bridge —
 * teardown is intentionally not scoped to one workspace.
 */
async function proxy(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const target = url.searchParams.get("path");
  if (
    !target ||
    !(
      target === "/api/me/account-teardown/preview" ||
      target === "/api/me/account-teardown"
    )
  ) {
    return NextResponse.json({ error: "invalid_path" }, { status: 400 });
  }
  const init: RequestInit = { method: req.method };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }
  const res = await backendUserFetch(target, init);
  const body = await res.text();
  return new NextResponse(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
