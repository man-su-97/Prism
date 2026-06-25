import "server-only";

let cached: Set<string> | null = null;

function readEnvAllowlist(): Set<string> {
  const raw = process.env.SUPERADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function getSuperAdminEmails(): Set<string> {
  // Cached per-process. In dev with the file mount, a Node restart picks up env
  // changes; in prod the container restart does the same.
  if (cached === null) cached = readEnvAllowlist();
  return cached;
}

export function isSuperAdmin(email: string | null | undefined): boolean {
  if (!email) return false;
  return getSuperAdminEmails().has(email.toLowerCase());
}
