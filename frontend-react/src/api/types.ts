/**
 * Account role. `admin` sees and manages everything, `manager` gets the
 * metrics of the groups granted to them, `user` is read-only: only the company
 * and per-user statistics, without metrics, chats or Excel export.
 */
export type Role = "admin" | "manager" | "user";

/** The signed-in user and what they may see. */
export interface CurrentUser {
  username: string;
  fullName: string | null;
  role: Role;
  /** A temporary password is still in place: nothing but changing it is allowed. */
  mustChangePassword: boolean;
  unrestricted: boolean; // administrator: every group, present and future
  metricsGroups: string[];
  chatGroups: string[];
  helpAccounts: string[];
}

/** A help account and the groups a grant on it expands to. */
export interface HelpAccountScope {
  account: string;
  groups: string[];
}

/** One granted scope: a whole help account, or a single client group. */
export interface Grant {
  scopeType: "help_account" | "group";
  scopeValue: string;
  canMetrics: boolean;
  canChats: boolean;
}

export interface UserAccount {
  id: number;
  username: string;
  fullName: string | null;
  role: Role;
  enabled: boolean;
  /** The user has not yet replaced the temporary password an administrator issued. */
  mustChangePassword: boolean;
  createdAt: string;
  grants: Grant[];
}

export interface UserCreateRequest {
  username: string;
  password: string;
  fullName: string | null;
  role: Role;
  enabled: boolean;
  grants: Grant[];
}

export interface UserUpdateRequest {
  fullName: string | null;
  role: Role;
  enabled: boolean;
  grants: Grant[];
}

export interface Group {
  groupName: string;
}

export interface Company {
  groupName: string;
  activeUsers: number;
  totalUsers: number;
  closedRequests: number;
  rejectedRequests: number;
  openRequests: number;
  totalMessages: number;
}

export interface HelpAccount {
  account: string;
}

export interface GroupUserStat {
  groupName: string;
  userName: string;
  closedRequests: number;
  rejectedRequests: number;
  totalMessages: number;
}

export interface GroupSlaStat {
  groupName: string;
  responses: number;
  avgSeconds: number;
  p50Seconds: number;
  p90Seconds: number;
}

export interface GroupResolutionStat {
  groupName: string;
  resolved: number;
  avgSeconds: number;
  p50Seconds: number;
  p90Seconds: number;
}

export interface GroupReopenStat {
  groupName: string;
  closed: number;
  probable: number;
  confirmed: number;
}

export interface GroupDailyPoint {
  groupName: string;
  bucket: string; // ISO date
  messages: number;
  closed: number;
  rejected: number;
}

export interface GroupCategoryCount {
  groupName: string;
  category: string;
  requests: number;
}

/** Every implemented metric for one help account, broken down by group. */
export interface HelpAccountReport {
  users: GroupUserStat[];
  sla: GroupSlaStat[];
  resolution: GroupResolutionStat[];
  reopens: GroupReopenStat[];
  timeseries: GroupDailyPoint[];
  categories: GroupCategoryCount[];
}

export interface UserStat {
  userName: string;
  closedRequests: number;
  rejectedRequests: number;
  openRequests: number;
  totalMessages: number;
}

export interface ChatMessage {
  /** The client side of the conversation, whoever wrote this message. */
  client: string;
  sender: string;
  recipient: string;
  /** `in` — the client wrote, `out` — support answered. Decides the bubble side. */
  direction: "in" | "out";
  message: string;
  createdAt: string;
}

/** Tickets still open at the end of the period, and the moment it describes. */
export interface BacklogReport {
  asOf: string; // ISO datetime - period end, or the freshest message if earlier
  openTickets: number;
}

/** One ticket behind the backlog count. */
export interface OpenTicket {
  client: string;
  groupNames: string | null;
  openedAt: string;
  lastActivity: string;
  category: string;
  messagesIn: number;
  messagesOut: number;
  firstResponder: string | null;
  finalStatus: "open" | "closed" | "rejected" | "expired"; // what happened later
  closedAt: string | null;
}

export type Bucket = "day" | "week" | "month";

export interface MetricPoint {
  bucket: string; // ISO date (start of the bucket)
  messages: number;
  closed: number;
  rejected: number;
  backlog: number; // tickets still open at the END of the bucket
}

export interface HeatmapCell {
  weekday: number; // 0 = Monday .. 6 = Sunday
  hour: number; // 0..23
  messages: number;
}

export interface SlaPoint {
  bucket: string; // ISO date
  responses: number;
  avgSeconds: number;
  p50Seconds: number;
  p90Seconds: number;
}

export interface CategoryCount {
  category: string;
  requests: number;
}

export interface ResolutionPoint {
  bucket: string; // ISO date (closing date)
  resolved: number;
  avgSeconds: number;
  p50Seconds: number;
  p90Seconds: number;
}

export interface ReopenPoint {
  bucket: string; // ISO date
  closed: number; // closures (rate denominator)
  probable: number; // reopens with any signal
  confirmed: number; // reopens with strong signal (marker words)
}

export interface Alert {
  type: "message_spike" | "sla_degradation";
  groupName: string;
  current: number;
  baseline: number;
  ratio: number;
}

export interface AlertsReport {
  asOf: string | null; // timestamp of the freshest ingested message
  weekStart: string | null;
  alerts: Alert[];
}

export interface OperatorStat {
  operator: string;
  messages: number;
  closed: number;
  rejected: number;
  clients: number;
  avgReplySeconds: number | null;
}

/** Result of one finished sync run. */
export interface SyncSummary {
  fullRebuild: boolean;
  scannedRows: number;
  newMessages: number;
  /** Reopen verdicts decided by the model this run. */
  llmClassified: number;
  /** Problem categories assigned by the model this run. */
  llmCategorized: number;
  watermark: number;
  durationMs: number;
}

/** Current (or last) sync run - polled while a rebuild is in flight. */
export interface SyncRun {
  kind: "scheduled" | "incremental" | "rebuild" | "llm";
  startedBy: string;
  startedAt: string;
  finishedAt: string | null;
  running: boolean;
  summary: SyncSummary | null;
  error: string | null;
}

/** GET /admin/sync/status - DB counters keep their SQL column names. */
export interface SyncStatus {
  last_archive_id: number;
  last_run_at: string | null;
  messages_total: number;
  tickets: { status: string; count: number }[];
  reopens: number;
  reopenLlm: { verdict: string; count: number }[];
  /** The configured cadence of the scheduled sync. */
  syncIntervalSeconds: number;
  run: SyncRun | null;
}

/** Runtime knobs of the LLM step; saved values override the environment. */
export interface LlmSettings {
  enabled: boolean;
  categories: "other" | "all" | "off";
  maxPerSync: number;
  requestsPerMinute: number;
  /** Fractions 0..1 of the subscription's 5-hour window (Claude CLI only). */
  ceilingIdle: number;
  ceilingBusy: number;
  busyWindowMinutes: number;
  model: string;
}

/** One classifier's last run. */
export interface LlmStep {
  at: string;
  decided: number;
  calls: number;
  pausedReason: string | null;
  error: string | null;
}

/** Claude CLI provider state; the http provider reports only its endpoint. */
export interface LlmTelemetry {
  loggedIn?: boolean;
  authMethod?: string | null;
  subscription?: string | null;
  authError?: string | null;
  authCheckedAt?: number | null;
  /** 0..1 of the rolling 5-hour window, null when unknown or reset. */
  fiveHourUtilization?: number | null;
  fiveHourResetsAt?: number | null;
  sevenDayUtilization?: number | null;
  readingAt?: number | null;
  ownerBusy?: boolean;
  ceilingNow?: number;
  overageSeen?: boolean;
  pausedReason?: string | null;
  command?: string;
  endpoint?: string;
  hasApiKey?: boolean;
}

export interface LlmStatus {
  provider: { kind: "claude-cli" | "http" | "off"; configured: boolean; description: string };
  settings: LlmSettings;
  defaults: LlmSettings;
  overriddenKeys: string[];
  overrides: Record<string, { value: string; updatedAt: string | null; updatedBy: string | null }>;
  telemetry: LlmTelemetry;
  stats: {
    lastRunAt: string | null;
    reopens: LlmStep | null;
    categories: LlmStep | null;
    totalCalls: number;
    totalReopensDecided: number;
    totalCategoriesDecided: number;
    averageCallMillis: number | null;
    lastCallAt: string | null;
  };
  counters: {
    reopens: { pending: number; same: number; new: number; heuristic: number };
    categories: {
      mode: "other" | "all" | "off";
      pending: number;
      openOther: number;
      otherTotal: number;
      ticketsTotal: number;
      classified: number;
      byCategory: { category: string; count: number }[];
    };
  };
  syncIntervalSeconds: number;
  run: SyncRun | null;
}

/**
 * A row of the maintenance screen's session list: a signed-in session, or a
 * lockout with no session behind it (then loginAt/lastSeen are null).
 */
export interface ActiveSession {
  username: string;
  ip: string;
  userAgent: string;
  loginAt: string | null;
  lastSeen: string | null;
  blocked: boolean;
}
