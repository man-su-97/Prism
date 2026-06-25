import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  return NextResponse.json(
    { status: "ok", service: "web", timestamp: new Date().toISOString() },
    { status: 200 },
  );
}
