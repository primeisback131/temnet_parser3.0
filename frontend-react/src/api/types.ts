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

/** A row of the chat screen's conversation list, freshest first. */
export interface ChatParticipant {
  client: string;
  lastAt: string;
  messages: number;
  lastText: string;
  lastDirection: "in" | "out";
}

/** A ticket of the conversation on screen, drawn as markers between messages. */
export interface ChatTicket {
  openedAt: string;
  inProgressAt: string | null;
  closedAt: string | null;
  lastActivity: string;
  status: "open" | "closed" | "rejected" | "expired";
  category: string;
  frtSeconds: number | null;
  resolutionSeconds: number | null;
  closedBy: string | null;
  reopen: boolean;
  thanked: boolean;
}

/**
 * Tickets still open at the end of the period, and the moment it describes.
 * The age buckets (calendar days since opening) sum to openTickets.
 */
export interface BacklogReport {
  asOf: string; // ISO datetime - period end, or the freshest message if earlier
  openTickets: number;
  ageDay: number; // up to 1 day
  ageThreeDays: number; // 2-3 days
  ageWeek: number; // 4-7 days
  ageMonth: number; // 8-30 days
  ageOlder: number; // more than 30 days
  oldestOpenedAt: string | null;
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
  /** Medians in working seconds; null when nothing qualified. */
  p50FrtSeconds: number | null;
  p50ResolutionSeconds: number | null;
  avgMessages: number;
  reopens: number;
  unanswered: number;
}

/** Tickets of one category opened in one bucket. */
export interface CategoryPoint {
  bucket: string; // ISO date
  category: string;
  requests: number;
}

/**
 * Quality summary of the tickets opened in the period - counts only, the
 * screen turns them into shares. Durations are working seconds.
 */
export interface PeriodSummary {
  opened: number;
  closed: number;
  rejected: number;
  expired: number; // ended by silence, closing phrase never written
  stillOpen: number;
  unanswered: number; // ended without any operator message
  answered: number; // first response within the outlier cap
  answeredFast: number; // within 15 minutes
  answeredHour: number; // within one hour
  resolved: number; // closed within the outlier cap
  resolvedHour: number; // closed within one working hour
  resolvedDay: number; // closed within one working day
  inProgress: number; // "заявка в работе" was written
  avgPickupSeconds: number | null; // open -> in progress
  thanked: number; // client acknowledged the closure
  replies: number; // operator replies after the first one
  replySeconds: number; // their total wait
  avgMessages: number | null;
  p50Messages: number | null;
  p90Messages: number | null;
  handoffs: number; // tickets where more than one desk wrote
  clients: number;
  newClients: number; // no ticket before the period
  incoming: number; // incoming messages
  offHours: number; // of them outside Mon-Fri 08:00-18:00
}

/** A client ranked by tickets opened in the period. */
export interface ClientStat {
  client: string;
  groupNames: string | null;
  tickets: number;
  messages: number;
  reopens: number;
  newClient: boolean;
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
  reopened: number; // closures that came back as a repeat request
  thanked: number; // closures the client acknowledged
  clients: number;
  avgReplySeconds: number | null;
}

/** Result of one finished sync run. */
export interface SyncSummary {
  fullRebuild: boolean;
  scannedRows: number;
  newMessages: number;
  llmClassified: number;
  watermark: number;
  durationMs: number;
}

/** Current (or last) sync run - polled while a rebuild is in flight. */
export interface SyncRun {
  kind: "scheduled" | "incremental" | "rebuild";
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

/**
 * A row of the maintenance screen's session list: a signed-in session, or a
 * lockout with no session behind it (then loginAt/lastSeen are null).
 */
export interface ActiveSession {
  /** Handle for ending the session; null for a lockout row. */
  id: string | null;
  /** The caller's own session. */
  current: boolean;
  username: string;
  ip: string;
  userAgent: string;
  loginAt: string | null;
  lastSeen: string | null;
  blocked: boolean;
}
