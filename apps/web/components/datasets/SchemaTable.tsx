import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type SchemaColumn = {
  name: string;
  position: number;
  kind: string;
  dtype: string;
  nullable: boolean;
  null_count: number;
  distinct_count: number | null;
  min_value: string | null;
  max_value: string | null;
  sample: unknown[];
  stats: Record<string, unknown>;
};

export function SchemaTable({ columns }: { columns: SchemaColumn[] }) {
  if (columns.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Schema will appear here once ingestion completes.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Column</TableHead>
            <TableHead>Kind</TableHead>
            <TableHead>Dtype</TableHead>
            <TableHead className="text-right">Nulls</TableHead>
            <TableHead className="text-right">Distinct</TableHead>
            <TableHead>Min</TableHead>
            <TableHead>Max</TableHead>
            <TableHead>Sample</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {columns.map((c) => (
            <TableRow key={c.position} className="align-top">
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="text-muted-foreground capitalize">
                {c.kind}
              </TableCell>
              <TableCell className="text-muted-foreground font-mono text-xs">
                {c.dtype}
              </TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {c.null_count}
              </TableCell>
              <TableCell className="text-muted-foreground text-right tabular-nums">
                {c.distinct_count ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.min_value ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {c.max_value ?? "—"}
              </TableCell>
              <TableCell className="text-muted-foreground max-w-xs truncate text-xs">
                {c.sample
                  .slice(0, 3)
                  .map((v) => String(v))
                  .join(", ")}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
