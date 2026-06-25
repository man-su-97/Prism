// Mirrors apps/api/app/routers/admin.py Pydantic models. Hand-maintained —
// the project doesn't generate from OpenAPI yet.

export type AdminOverview = {
  total_users: number;
  total_workspaces: number;
  workspaces_by_plan: Record<string, number>;
  active_sessions_24h: number;
  chat_messages_30d: number;
  datasets_total: number;
  datasets_in_error: number;
  new_users_7d: number;
  new_workspaces_7d: number;
  generated_at: string;
};

export type AdminUserListItem = {
  id: string;
  email: string;
  name: string | null;
  email_verified: boolean;
  created_at: string;
  last_active_at: string | null;
  workspace_count: number;
};

export type AdminUserList = {
  items: AdminUserListItem[];
  next_cursor: string | null;
};

export type AdminMembership = {
  organization_id: string;
  name: string;
  slug: string;
  role: string;
  joined_at: string;
};

export type AdminUserSession = {
  created_at: string;
  updated_at: string;
  expires_at: string;
  ip_address: string | null;
  user_agent: string | null;
};

export type AdminUserDetail = {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  email_verified: boolean;
  created_at: string;
  updated_at: string;
  memberships: AdminMembership[];
  recent_sessions: AdminUserSession[];
};

export type AdminWorkspaceListItem = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  plan: string;
  status: string | null;
  member_count: number;
  dataset_count: number;
  dashboard_count: number;
  chat_tokens_used: number;
  chat_tokens_limit: number;
  current_period_end: string | null;
  chat_tokens_period_end: string | null;
};

export type AdminWorkspaceList = {
  items: AdminWorkspaceListItem[];
  next_cursor: string | null;
};

export type AdminWorkspaceMember = {
  user_id: string;
  email: string;
  name: string | null;
  role: string;
  joined_at: string;
};

export type AdminWorkspaceDataset = {
  id: string;
  name: string;
  status: string;
  row_count: number | null;
  size_bytes: number | null;
  created_at: string;
};

export type AdminWorkspaceDashboard = {
  id: string;
  name: string;
  kind: string;
  widget_count: number;
  created_at: string;
};

export type AdminWorkspaceDetail = {
  workspace: AdminWorkspaceListItem;
  members: AdminWorkspaceMember[];
  recent_datasets: AdminWorkspaceDataset[];
  recent_dashboards: AdminWorkspaceDashboard[];
};

export type AdminTimeSeries = {
  points: { bucket: string; value: number }[];
  total: number;
  days: number;
};

export type AdminSystemHealth = {
  redis_ok: boolean;
  postgres_ok: boolean;
  arq_queue_depth: number;
  arq_in_progress: number;
  datasets_error_count: number;
  pg_connection_count: number;
  generated_at: string;
};
