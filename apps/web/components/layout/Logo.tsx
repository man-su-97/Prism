"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const uid = useId();
  const gid = `ib-grad-${uid.replace(/:/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="28" x2="28" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-from)" />
          <stop offset="0.5" stopColor="var(--brand-via)" />
          <stop offset="1" stopColor="var(--brand-to)" />
        </linearGradient>
      </defs>
      {/* Three ascending bars: short · medium · tall */}
      <rect x="2"    y="16" width="7" height="10" rx="1.75" fill={`url(#${gid})`} opacity="0.60" />
      <rect x="10.5" y="9"  width="7" height="17" rx="1.75" fill={`url(#${gid})`} opacity="0.80" />
      <rect x="19"   y="2"  width="7" height="24" rx="1.75" fill={`url(#${gid})`} />
    </svg>
  );
}

export function LogoFull({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-gradient-brand text-[17px] font-semibold leading-none tracking-tight">
        Prism
      </span>
    </span>
  );
}
