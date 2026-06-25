import "server-only";

import { headers } from "next/headers";
import { SignJWT } from "jose";

import { isSuperAdmin } from "@/lib/admin";
import { auth } from "@/lib/auth";
import { parseApiError } from "@/lib/errors";
import { resolveActiveOrgId } from "@/lib/session";

const JWT_TTL_SECONDS = 60 * 5;

let cachedSecret: Uint8Array | null = null;

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret;
  const raw = process.env.BACKEND_JWT_SECRET;
  if (!raw) {
    throw new Error("BACKEND_JWT_SECRET is required");
  }
  cachedSecret = new TextEncoder().encode(raw);
  return cachedSecret;
}

const apiBase = process.env.API_BASE_URL ?? "http://api:8000";

export class NotAuthenticatedError extends Error {
  constructor() {
    super("not_authenticated");
  }
}

export class NoActiveOrgError extends Error {
  constructor() {
    super("no_active_org");
  }
}

async function mintToken(userId: string, orgId: string): Promise<string> {
  return new SignJWT({ org_id: orgId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(getSecret());
}

async function mintUserToken(userId: string): Promise<string> {
  // Org-less variant for endpoints that span multiple workspaces — namely
  // /me/account-teardown. The FastAPI side validates this with the
  // `principal_user_only` dep (no org_id claim required).
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(getSecret());
}

/**
 * Fetch the API as the currently signed-in user, scoped to their active workspace.
 * Throws if the user isn't signed in or has no active workspace.
 */
export async function backendFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    throw new NotAuthenticatedError();
  }

  // Don't read session.activeOrganizationId directly: Better Auth's cookieCache
  // (5-min TTL) holds a snapshot of the session, and on fresh login that
  // snapshot has activeOrganizationId=null. Server-side setActiveOrganization
  // calls from RSC update the DB but can't re-issue the cookie, so the cache
  // stays stale until the next client-driven setActive. resolveActiveOrgId
  // falls back to listing orgs when the cached value is null.
  const orgId = await resolveActiveOrgId(session);
  if (!orgId) {
    throw new NoActiveOrgError();
  }

  const token = await mintToken(session.user.id, orgId);

  const url = new URL(path, apiBase).toString();
  const extraHeaders = init.headers ? new Headers(init.headers) : new Headers();
  extraHeaders.set("Authorization", `Bearer ${token}`);
  if (!extraHeaders.has("Content-Type") && init.body) {
    extraHeaders.set("Content-Type", "application/json");
  }

  return fetch(url, { ...init, headers: extraHeaders, cache: "no-store" });
}

export async function backendJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await backendFetch(path, init);
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<T>;
}

/**
 * Fetch the API as the currently signed-in user, without an active-workspace
 * scope. Use only for endpoints that legitimately span multiple workspaces
 * (account teardown, future exports, etc.).
 */
export async function backendUserFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user) {
    throw new NotAuthenticatedError();
  }
  const token = await mintUserToken(session.user.id);
  const url = new URL(path, apiBase).toString();
  const extraHeaders = init.headers ? new Headers(init.headers) : new Headers();
  extraHeaders.set("Authorization", `Bearer ${token}`);
  if (!extraHeaders.has("Content-Type") && init.body) {
    extraHeaders.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers: extraHeaders, cache: "no-store" });
}

/**
 * Fetch the API as a super-admin. Reuses the org-less user JWT and lets
 * FastAPI re-verify the allowlist server-side from sub → user.email. Don't
 * mint a token with an `is_admin: true` claim here — any leaked user token
 * with that claim would become an admin token. Defense in depth: refuse to
 * mint at all unless the caller is also in the web-side allowlist.
 */
export async function backendAdminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user || !isSuperAdmin(session.user.email)) {
    throw new NotAuthenticatedError();
  }
  const token = await mintUserToken(session.user.id);
  const url = new URL(path, apiBase).toString();
  const extraHeaders = init.headers ? new Headers(init.headers) : new Headers();
  extraHeaders.set("Authorization", `Bearer ${token}`);
  if (!extraHeaders.has("Content-Type") && init.body) {
    extraHeaders.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, headers: extraHeaders, cache: "no-store" });
}

export async function backendAdminJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await backendAdminFetch(path, init);
  if (!res.ok) throw new Error(await parseApiError(res));
  return res.json() as Promise<T>;
}
