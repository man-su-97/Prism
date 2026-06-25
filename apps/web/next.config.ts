import path from "node:path";
import type { NextConfig } from "next";

const apiBase = process.env.API_BASE_URL ?? "http://api:8000";
const workspaceRoot = path.resolve(process.cwd(), "..", "..");

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  typedRoutes: true,
  // Pin both Turbopack and the standalone-tracing roots to the pnpm workspace
  // root so they agree (Next 16 errors when they diverge) and so the build
  // picks up files from sibling workspace packages.
  turbopack: {
    root: workspaceRoot,
  },
  outputFileTracingRoot: workspaceRoot,
  async rewrites() {
    // Share-link endpoints are intentionally unauthenticated — proxy directly
    // to FastAPI instead of going through the JWT-bridge route handler.
    return [
      {
        source: "/api/share/:path*",
        destination: `${apiBase}/api/share/:path*`,
      },
    ];
  },
};

export default nextConfig;
