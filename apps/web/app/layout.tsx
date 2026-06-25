import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Inter, JetBrains_Mono } from "next/font/google";

import { MotionProvider } from "@/components/motion/MotionProvider";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import "./globals.css";

const fontSans = Inter({
  subsets: ["latin"],
  variable: "--font-sans-pjs",
  display: "swap",
});

const fontMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jbm",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Prism",
  description: "AI-powered analytics dashboard platform",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Density is a personalization knob persisted as a cookie (see
  // PersonalizationCard). Default to comfortable when absent.
  const density =
    (await cookies()).get("prism_density")?.value === "compact"
      ? "compact"
      : "comfortable";

  return (
    <html
      lang="en"
      className={cn(fontSans.variable, fontMono.variable)}
      suppressHydrationWarning
    >
      <body
        className="min-h-screen bg-background font-sans text-foreground antialiased"
        data-density={density}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <MotionProvider>
            <TooltipProvider delayDuration={150}>{children}</TooltipProvider>
            <Toaster richColors closeButton />
          </MotionProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
