export interface Group {
  groupName: string;
}

export interface Company {
  groupName: string;
  activeUsers: number;
  totalUsers: number;
  closedRequests: number;
  rejectedRequests: number;
  requestsInProgress: number;
  totalMessages: number;
}

export interface UserStat {
  userName: string;
  closedRequests: number;
  rejectedRequests: number;
  requestsInProgress: number;
  totalMessages: number;
}

export interface ChatMessage {
  sender: string;
  recipient: string;
  message: string;
  createdAt: string;
}

export type Bucket = "day" | "week" | "month";

export interface MetricPoint {
  bucket: string; // ISO date (start of the bucket)
  messages: number;
  closed: number;
  rejected: number;
  inProgress: number;
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

export interface BacklogTicket {
  client: string;
  groups: string | null;
  category: string;
  openedAt: string;
  lastActivity: string;
  firstResponseAt: string | null;
  messagesIn: number;
  messagesOut: number;
  waitingSeconds: number; // working seconds, relative to `asOf`
}

export interface Backlog {
  asOf: string | null; // timestamp of the freshest ingested message
  tickets: BacklogTicket[];
}

export interface OperatorStat {
  operator: string;
  messages: number;
  closed: number;
  rejected: number;
  clients: number;
  avgReplySeconds: number | null;
}
