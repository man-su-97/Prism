import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { emailOTP, organization, twoFactor } from "better-auth/plugins";

import { pool } from "@/lib/db";
import {
  sendInvitationEmail,
  sendOtpEmail,
  sendPasswordResetEmail,
} from "@/lib/mailer";
const env = process.env;
const isBuildPhase = env.NEXT_PHASE === "phase-production-build";

const googleEnabled =
  Boolean(env.GOOGLE_CLIENT_ID) && Boolean(env.GOOGLE_CLIENT_SECRET);

// Hard ceiling on workspaces per user across all plans. Paid plans are
// described to users as "unlimited"; this is the soft cap that guards against
// runaway loops or scripted abuse.
const WORKSPACE_HARD_CAP = 100;

// Plans whose `subscriptions.status` should be treated as not currently paid.
const INACTIVE_SUB_STATUSES = new Set(["canceled", "incomplete_expired", "unpaid"]);

// Free plan = 1 workspace per user. Any active paid subscription on any of
// the user's workspaces unlocks the soft cap. Runs inside Better Auth's
// `organizationHooks.beforeCreateOrganization` hook, which throws an
// APIError to surface a 400 to the UI.
async function checkWorkspaceCreationLimit(userId: string): Promise<void> {
  const client = await pool().connect();
  try {
    const memRes = await client.query<{ organizationId: string }>(
      'SELECT "organizationId" FROM "member" WHERE "userId" = $1',
      [userId],
    );
    const orgIds = memRes.rows.map((r) => r.organizationId);
    if (orgIds.length === 0) return; // first workspace is always allowed
    if (orgIds.length >= WORKSPACE_HARD_CAP) {
      throw new APIError("BAD_REQUEST", {
        message: `Workspace limit reached (${WORKSPACE_HARD_CAP}).`,
      });
    }

    // subscriptions is FORCE RLS — set the GUC per row to read each org's plan.
    let hasPaid = false;
    for (const orgId of orgIds) {
      await client.query("SELECT set_config('app.org_id', $1, false)", [orgId]);
      const subRes = await client.query<{ plan: string; status: string }>(
        "SELECT plan, status FROM subscriptions WHERE org_id = $1",
        [orgId],
      );
      const row = subRes.rows[0];
      if (row && row.plan !== "free" && !INACTIVE_SUB_STATUSES.has(row.status)) {
        hasPaid = true;
        break;
      }
    }

    if (!hasPaid) {
      throw new APIError("BAD_REQUEST", {
        message:
          "The Free plan allows a single workspace. Upgrade an existing workspace to create more.",
      });
    }
  } finally {
    try {
      await client.query("SELECT set_config('app.org_id', '', false)");
    } catch {
      // best-effort; pg pool will recycle the connection on next checkout
    }
    client.release();
  }
}

function buildAuth() {
  if (!env.BETTER_AUTH_SECRET) {
    // Crash-fast at request time so misconfigured deploys surface clearly.
    // Build-time data collection takes the placeholder path instead.
    throw new Error("BETTER_AUTH_SECRET is required");
  }
  const baseURL = env.BETTER_AUTH_URL ?? "https://app.localhost";
  // Comma-separated extra origins (browser → Next.js host) that are allowed
  // to call the auth endpoints. The local dev port 3000 is included by
  // default so direct `http://localhost:3000` works alongside Caddy.
  const extraOrigins = (env.BETTER_AUTH_TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const trustedOrigins = Array.from(
    new Set([
      baseURL,
      "http://localhost:3000",
      "https://app.localhost",
      ...extraOrigins,
    ]),
  );

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins,
    database: pool(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendPasswordResetEmail({
          to: user.email,
          resetUrl: url,
          userName: user.name,
        });
      },
    },
    emailVerification: {
      // After OTP is verified, automatically create a session so the user
      // lands on onboarding without a separate sign-in step.
      autoSignInAfterVerification: true,
      // Auto-send a new OTP when an unverified user signs in, so returning
      // users with emailVerified=false don't land on an empty verify page.
      sendOnSignIn: true,
    },
    user: {
      // GDPR right to erasure. The Prism-side teardown of workspaces,
      // datasets, parquet blobs and Stripe subscriptions is orchestrated by
      // the web client BEFORE this endpoint is called (it hits
      // /api/me/account-teardown on the FastAPI side first). Better Auth then
      // handles the auth-layer rows: user, sessions, accounts, member,
      // twoFactor — all cascade-deleted by FK from `user.id`.
      //
      // `sendDeleteAccountVerification` is not wired: account deletion runs
      // through the in-app teardown flow which already requires an active
      // session and a typed-confirmation modal. Wire it via `sendMail` from
      // `lib/mailer.ts` if you want an out-of-band confirmation step.
      deleteUser: {
        enabled: true,
      },
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            // Request long-lived refresh tokens so the worker can keep syncing
            // sheets in the background without the user signing in again.
            accessType: "offline",
            prompt: "consent",
            scope: [
              "openid",
              "email",
              "profile",
              "https://www.googleapis.com/auth/drive.readonly",
              "https://www.googleapis.com/auth/spreadsheets.readonly",
            ],
          },
        }
      : undefined,
    plugins: [
      emailOTP({
        // Routes all OTP emails (signup verification + password reset) through
        // the mailer so SMTP errors never abort the auth flow.
        async sendVerificationOTP({ email, otp, type }) {
          await sendOtpEmail({ to: email, otp, type });
        },
        // Let emailOTP take over the default link-based email verification so
        // signup triggers an OTP email instead of a magic link.
        overrideDefaultEmailVerification: true,
        otpLength: 6,
        expiresIn: 600,    // 10 minutes
        allowedAttempts: 5,
      }),
      organization({
        allowUserToCreateOrganization: true,
        organizationLimit: WORKSPACE_HARD_CAP,
        membershipLimit: 100,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        organizationHooks: {
          // Better Auth 1.2 fires this BEFORE the organization row is
          // inserted. Throwing an APIError aborts the create and surfaces
          // the message to the client. The older `organizationCreation`
          // shape this code originally used silently never ran.
          beforeCreateOrganization: async ({
            user,
          }: {
            user: { id: string };
          }) => {
            await checkWorkspaceCreationLimit(user.id);
          },
        },
        sendInvitationEmail: async ({
          email,
          invitation,
          organization: org,
          inviter,
        }) => {
          await sendInvitationEmail({
            to: email,
            workspaceName: org.name,
            inviterName: inviter.user.name || inviter.user.email,
            invitationId: invitation.id,
          });
        },
      }),
      // TOTP-based 2FA. Schema (twoFactor table + user.twoFactorEnabled) lives
      // in alembic migration 20260513_0001.
      twoFactor({
        issuer: "Prism",
      }),
    ],
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      cookieCache: {
        enabled: true,
        maxAge: 60 * 5,
      },
    },
  });
}

type RealAuth = ReturnType<typeof buildAuth>;

let cached: RealAuth | null = null;

function getAuth(): RealAuth {
  if (cached) return cached;
  cached = buildAuth();
  return cached;
}

// `auth` is the public surface. During `next build`'s page-data collection
// pass the env may legitimately be empty — we hand back a Proxy that throws
// only when a property is actually accessed at request time.
export const auth: RealAuth = new Proxy({} as RealAuth, {
  get(_target, prop, receiver) {
    if (isBuildPhase && !env.BETTER_AUTH_SECRET) {
      // Returning `undefined` here is fine: every accessor we have is awaited
      // inside a request handler, never during static collection.
      return undefined;
    }
    const real = getAuth();
    return Reflect.get(real, prop, receiver);
  },
}) as RealAuth;

export type Auth = RealAuth;
