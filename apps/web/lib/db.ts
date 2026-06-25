import "server-only";

import { Pool } from "pg";

// Shared pg pool for direct queries that bypass Better Auth — e.g. the
// /settings/security page needs to know whether the user has a credential
// account and whether 2FA is enabled. Connection string falls through the
// same chain Better Auth itself uses (lib/auth.ts).
const databaseUrl =
  process.env.AUTH_DATABASE_URL ??
  process.env.DATABASE_URL_SYNC ??
  "postgresql://strata:strata@postgres:5432/strata";

let _pool: Pool | null = null;

export function pool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: databaseUrl });
  return _pool;
}
