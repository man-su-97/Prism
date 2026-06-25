"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConnectSheetForm } from "@/components/datasets/ConnectSheetForm";
import { UploadDatasetForm } from "@/components/datasets/UploadDatasetForm";

export default function GenerateDashboardDialog({
  children,
}: {
  children?: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"upload" | "sheet">("upload");

  function close() {
    setOpen(false);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button>
            <Plus className="size-4" />
            Generate dashboard
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Generate dashboard</DialogTitle>
          <DialogDescription>
            Upload a CSV/XLSX or connect a Google Sheet. We&apos;ll profile
            schema and auto-build a dashboard.
          </DialogDescription>
        </DialogHeader>
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "upload" | "sheet")}
          className="min-w-0"
        >
          <TabsList className="w-full">
            <TabsTrigger value="upload" className="flex-1">Upload file</TabsTrigger>
            <TabsTrigger value="sheet" className="flex-1">Connect Google Sheet</TabsTrigger>
          </TabsList>
          <div className="mt-4 border-t border-border/40" />
          <TabsContent value="upload" className="min-w-0 pt-4">
            <UploadDatasetForm
              onSuccess={(ds) => {
                toast.success(`Dataset "${ds.name}" queued for processing.`);
                close();
              }}
              onError={(msg) => toast.error(msg)}
            />
          </TabsContent>
          <TabsContent value="sheet" className="min-w-0 pt-4">
            <ConnectSheetForm
              onSuccess={() => {
                toast.success("Google Sheet connected.");
                close();
              }}
              onError={(msg) => toast.error(msg)}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
