import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { sendDashboardShareEmail } from "@/lib/mailer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  to: string;
  dashboardName: string;
  shareUrl: string;
  expiresAt: string | null;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Reuse the user's auth cookie for the "sender" identity; we don't trust
  // a sender name supplied by the client.
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body?.to || !body.dashboardName || !body.shareUrl) {
    return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  }

  try {
    await sendDashboardShareEmail({
      to: body.to,
      dashboardName: body.dashboardName,
      senderName: session.user.name || session.user.email,
      shareUrl: body.shareUrl,
      expiresAt: body.expiresAt,
    });
  } catch (e) {
    console.error("share email send failed", e);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
