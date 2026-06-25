export type WidgetKind = "kpi" | "line" | "bar" | "pie" | "table" | "overview";

export type Widget = {
  id: string;
  kind: WidgetKind;
  title: string;
  config: Record<string, unknown>;
};

export type WidgetDataResponse = {
  kind: WidgetKind;
  status?: string;
  rows: Record<string, unknown>[];
  config?: Record<string, unknown>;
};
