"use client";

import { useEffect } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Sentry, if loaded, picks this up via captureException in instrumentation.
    console.error(error);
  }, [error]);

  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-destructive flex items-center gap-2">
            <AlertCircle className="size-5" />
            <CardTitle>Something broke.</CardTitle>
          </div>
          <CardDescription>
            An unexpected error happened. You can try again, or come back later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error.digest ? (
            <p className="text-muted-foreground font-mono text-xs">
              Reference: {error.digest}
            </p>
          ) : null}
          <Button onClick={reset}>
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
