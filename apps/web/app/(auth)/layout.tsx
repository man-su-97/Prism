import Link from "next/link";
import { LogoMark } from "@/components/layout/Logo";

// Login/signup read query params and call the auth handler — don't prerender.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="bg-background relative flex min-h-dvh flex-col items-center justify-center gap-6 overflow-hidden p-4 sm:p-6">
      {/* Aurora wash + soft dot grid backdrop. Animation is GPU-cheap and pauses
       * under prefers-reduced-motion via the keyframe guard in globals.css. */}
      <div className="bg-aurora animate-aurora pointer-events-none absolute inset-0 opacity-90" aria-hidden />
      <div className="bg-grid pointer-events-none absolute inset-0 opacity-50" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-primary/50 to-transparent" aria-hidden />

      <Link
        href="/"
        aria-label="Prism home"
        className="group inline-flex items-center gap-2.5 transition-opacity hover:opacity-75"
      >
        <LogoMark size={32} />
        <span className="text-gradient-brand text-xl font-semibold tracking-tight">
          Prism
        </span>
      </Link>
      <div className="relative w-full max-w-sm">{children}</div>
      <p className="text-muted-foreground relative text-xs">
        Multi-tenant analytics, built for teams.
      </p>
    </main>
  );
}
