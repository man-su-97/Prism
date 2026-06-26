"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  const uid = useId();
  const gid    = `prism-grad-${uid.replace(/:/g, "")}`;
  const clipId = `prism-clip-${uid.replace(/:/g, "")}`;
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
        {/* Brand gradient: indigo → violet → pink, bottom-left to top-right */}
        <linearGradient id={gid} x1="1" y1="27" x2="27" y2="1" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--brand-from)" />
          <stop offset="0.5" stopColor="var(--brand-via)" />
          <stop offset="1"   stopColor="var(--brand-to)"  />
        </linearGradient>
        {/* Clip to triangle so the beam line stays inside */}
        <clipPath id={clipId}>
          <polygon points="14,1.5 26.5,25.5 1.5,25.5" />
        </clipPath>
      </defs>

      {/* Prism body */}
      <polygon points="14,1.5 26.5,25.5 1.5,25.5" fill={`url(#${gid})`} />

      {/* Light beam — enters bottom-left vertex, exits the apex */}
      <line
        x1="1.5" y1="25.5"
        x2="14"   y2="1.5"
        stroke="white"
        strokeWidth="2.2"
        strokeOpacity="0.38"
        clipPath={`url(#${clipId})`}
      />

      {/* Spectrum rays fanning out below the prism */}
      <line x1="1.5" y1="25.5" x2="0"   y2="28" stroke="#818cf8" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="1.5" y1="25.5" x2="2.5" y2="28" stroke="#a78bfa" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="1.5" y1="25.5" x2="5"   y2="28" stroke="#c084fc" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="1.5" y1="25.5" x2="7.5" y2="28" stroke="#e879f9" strokeWidth="1.4" strokeLinecap="round" />
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
