export type PlanLimits = {
  name: string;
  max_workspaces: number;
  max_datasets: number;
  row_cap: number;
  max_widgets_per_dashboard: number;
  max_dashboards_per_dataset: number;
  chat_per_hour: number;
  chat_tokens_per_month: number;
  monthly_price_usd: number;
  stripe_price_id: string | null;
};

export type PlanResponse = {
  plan: PlanLimits;
  usage: {
    datasets: number;
    chat_tokens_used: number;
    chat_tokens_remaining: number;
    chat_tokens_period_end: string | null;
  };
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  available_plans: PlanLimits[];
};
