"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlState } from "@/lib/use-url-state";

import { DataTable } from "./DataTable";
import { SchemaTable, type SchemaColumn } from "./SchemaTable";

export function DatasetTabs({
  datasetId,
  status,
  rowCount,
  columns,
}: {
  datasetId: string;
  status: string;
  rowCount: number | null;
  columns: SchemaColumn[];
}) {
  const [tab, setTab] = useUrlState("tab", "schema");
  const active = tab === "table" ? "table" : "schema";
  const columnNames = columns.map((c) => c.name);

  return (
    <Tabs value={active} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="schema">Schema</TabsTrigger>
        <TabsTrigger value="table">Table</TabsTrigger>
      </TabsList>

      <TabsContent value="schema" className="space-y-3">
        <SchemaTable columns={columns} />
      </TabsContent>

      <TabsContent value="table" className="space-y-3">
        <DataTable
          datasetId={datasetId}
          status={status}
          rowCount={rowCount}
          fallbackColumns={columnNames}
        />
      </TabsContent>
    </Tabs>
  );
}
