import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function NotFound() {
  return (
    <main className="bg-muted/30 flex min-h-screen items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="text-muted-foreground flex items-center gap-2">
            <FileQuestion className="size-5" />
            <CardTitle>Not found.</CardTitle>
          </div>
          <CardDescription>
            The page you&apos;re looking for moved or never existed.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/">Back to dashboards</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
