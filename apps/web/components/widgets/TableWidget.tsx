import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { Widget, WidgetDataResponse } from "./types";

export function TableWidget({
  data,
}: {
  widget: Widget;
  data: WidgetDataResponse;
}) {
  const rows = data.rows;
  const cols = rows.length > 0 ? Object.keys(rows[0]) : [];

  if (rows.length === 0) {
    return <p className="text-muted-foreground text-xs">No rows.</p>;
  }

  return (
    <div className="h-full overflow-auto">
      <Table>
        <TableHeader className="bg-muted/40 sticky top-0">
          <TableRow>
            {cols.map((c) => (
              <TableHead key={c} className="text-xs">
                {c}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {cols.map((c) => (
                <TableCell key={c} className="text-xs align-top">
                  {String((r as Record<string, unknown>)[c] ?? "")}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
