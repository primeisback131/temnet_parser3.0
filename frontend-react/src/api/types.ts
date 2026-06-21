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
}

export interface CategoryCount {
  category: string;
  requests: number;
}
