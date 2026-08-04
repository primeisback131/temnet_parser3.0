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
  sender: string;
  recipient: string;
  message: string;
  createdAt: string;
}

/** Tickets still open at the end of the period, and the moment it describes. */
export interface BacklogReport {
  asOf: string; // ISO datetime — period end, or the freshest message if earlier
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
