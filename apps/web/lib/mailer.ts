import "server-only";

import nodemailer, { type Transporter } from "nodemailer";

const env = process.env;

export type MailMessage = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

let cached: Transporter | null = null;

function getTransport(): Transporter | null {
  if (cached) return cached;
  const host = env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number(env.SMTP_PORT ?? 587);
  const secure = (env.SMTP_SECURE ?? "false").toLowerCase() === "true";
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS;
  cached = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user ? { user, pass: pass ?? "" } : undefined,
  });
  return cached;
}

function fromAddress(): string {
  return env.SMTP_FROM?.trim() || "Prism <noreply@example.com>";
}

/**
 * Send an email via SMTP, or log it to stdout when SMTP isn't configured.
 * Returning instead of throwing keeps a missing mailbox from breaking signup,
 * invitation, and password-reset flows in local dev. Production deploys
 * should set SMTP_HOST.
 */
export async function sendMail(msg: MailMessage): Promise<void> {
  const transport = getTransport();
  if (!transport) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "mail.skipped_no_smtp",
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
      }),
    );
    return;
  }
  try {
    const info = await transport.sendMail({
      from: fromAddress(),
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html ?? msg.text,
    });
    console.log(
      JSON.stringify({
        level: "info",
        event: "mail.sent",
        to: msg.to,
        subject: msg.subject,
        messageId: info.messageId,
        response: info.response,
      }),
    );
  } catch (err) {
    // SMTP errors must not abort auth flows (invitation, password-reset, OTP).
    // Log the full payload so the OTP/reset URL is recoverable from stdout.
    console.error(
      JSON.stringify({
        level: "error",
        event: "mail.send_failed",
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}

function appBaseUrl(): string {
  return (
    env.NEXT_PUBLIC_APP_URL?.trim() ||
    env.BETTER_AUTH_URL?.trim() ||
    "https://app.localhost"
  );
}

function renderShell(title: string, body: string, cta?: { href: string; label: string }): string {
  const button = cta
    ? `<p style="margin:24px 0"><a href="${cta.href}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600">${cta.label}</a></p>
       <p style="color:#6b7280;font-size:13px;margin:8px 0">Or copy this link: <br/><span style="word-break:break-all">${cta.href}</span></p>`
    : "";
  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;line-height:1.5;padding:24px;background:#f9fafb">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:28px">
      <h1 style="margin:0 0 12px;font-size:20px">${title}</h1>
      <div style="font-size:14px">${body}</div>
      ${button}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"/>
      <p style="color:#6b7280;font-size:12px;margin:0">Sent by Prism</p>
    </div>
  </body></html>`;
}

export async function sendInvitationEmail(args: {
  to: string;
  workspaceName: string;
  inviterName: string;
  invitationId: string;
}): Promise<void> {
  const url = `${appBaseUrl()}/accept-invite/${args.invitationId}`;
  const subject = `${args.inviterName} invited you to ${args.workspaceName} on Prism`;
  const text = `${args.inviterName} has invited you to join the "${args.workspaceName}" workspace on Prism.\n\nAccept the invitation: ${url}\n\nThis link expires in 7 days.`;
  const html = renderShell(
    "You're invited to a workspace",
    `<p><strong>${args.inviterName}</strong> has invited you to join <strong>${args.workspaceName}</strong> on Prism.</p><p style="color:#6b7280;font-size:13px">This link expires in 7 days.</p>`,
    { href: url, label: "Accept invitation" },
  );
  await sendMail({ to: args.to, subject, text, html });
}

export async function sendDashboardShareEmail(args: {
  to: string;
  dashboardName: string;
  senderName: string;
  shareUrl: string;
  expiresAt: string | null;
}): Promise<void> {
  const expiry = args.expiresAt
    ? `This link expires on ${new Date(args.expiresAt).toUTCString()}.`
    : "This link does not expire.";
  const subject = `${args.senderName} shared the "${args.dashboardName}" dashboard with you`;
  const text = `${args.senderName} shared the "${args.dashboardName}" dashboard with you on Prism.\n\nOpen it: ${args.shareUrl}\n\n${expiry}`;
  const html = renderShell(
    "A dashboard was shared with you",
    `<p><strong>${args.senderName}</strong> shared the <strong>${args.dashboardName}</strong> dashboard with you on Prism.</p><p style="color:#6b7280;font-size:13px">${expiry}</p>`,
    { href: args.shareUrl, label: "Open dashboard" },
  );
  await sendMail({ to: args.to, subject, text, html });
}

export async function sendPasswordResetEmail(args: {
  to: string;
  resetUrl: string;
  userName?: string | null;
}): Promise<void> {
  const greeting = args.userName ? `Hi ${args.userName},` : "Hi,";
  const subject = "Reset your Prism password";
  const text = `${greeting}\n\nWe received a request to reset your password. Open this link to choose a new one:\n\n${args.resetUrl}\n\nIf you didn't request this, you can ignore this email.`;
  const html = renderShell(
    "Reset your password",
    `<p>${greeting}</p><p>We received a request to reset your password. Use the button below to choose a new one.</p><p style="color:#6b7280;font-size:13px">If you didn't request this, you can safely ignore this email.</p>`,
    { href: args.resetUrl, label: "Reset password" },
  );
  await sendMail({ to: args.to, subject, text, html });
}

export async function sendOtpEmail(args: {
  to: string;
  otp: string;
  type: "email-verification" | "forget-password" | "sign-in" | "change-email";
}): Promise<void> {
  const isReset = args.type === "forget-password";
  const subject = isReset
    ? "Your Prism password reset code"
    : "Verify your Prism account";
  const title = isReset ? "Reset your password" : "Verify your email";
  const body = isReset
    ? `<p>Use the code below to reset your Prism password. It expires in <strong>10 minutes</strong>.</p>`
    : `<p>Use the code below to verify your Prism account. It expires in <strong>10 minutes</strong>.</p>`;
  const codeBlock = `<div style="margin:24px 0;text-align:center">
    <span style="display:inline-block;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace;background:#f3f4f6;border-radius:8px;padding:12px 20px;color:#111827">${args.otp}</span>
  </div>`;
  const warning = `<p style="color:#6b7280;font-size:12px;margin:16px 0 0">If you didn't request this, you can safely ignore this email. Do not share this code with anyone.</p>`;
  const text = `${isReset ? "Password reset code" : "Verification code"}: ${args.otp}\n\nThis code expires in 10 minutes. Do not share it with anyone.`;
  const html = renderShell(title, `${body}${codeBlock}${warning}`);
  await sendMail({ to: args.to, subject, text, html });
}
