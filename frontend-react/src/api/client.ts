import type {
  Bucket,
  CategoryCount,
  ChatMessage,
  Company,
  Group,
  HeatmapCell,
  MetricPoint,
  OperatorStat,
  SlaPoint,
  UserStat,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

async function getJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Запрос ${path} вернул ${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getGroups: () => getJson<Group[]>("/groups"),

  getCompanies: (start: string, end: string) =>
    getJson<Company[]>("/companies", { start, end }),

  getUsers: (start: string, end: string, groupName: string) =>
    getJson<UserStat[]>("/users", { start, end, groupName }),

  getChats: (start: string, end: string, groupName: string) =>
    getJson<ChatMessage[]>("/chat", { start, end, groupName }),

  getTimeseries: (start: string, end: string, bucket: Bucket, groupName?: string) =>
    getJson<MetricPoint[]>("/metrics/timeseries", {
      start,
      end,
      bucket,
      ...(groupName ? { groupName } : {}),
    }),

  getHeatmap: (start: string, end: string, groupName?: string) =>
    getJson<HeatmapCell[]>("/metrics/heatmap", {
      start,
      end,
      ...(groupName ? { groupName } : {}),
    }),

  getSla: (start: string, end: string, bucket: Bucket, groupName?: string) =>
    getJson<SlaPoint[]>("/metrics/sla", {
      start,
      end,
      bucket,
      ...(groupName ? { groupName } : {}),
    }),

  getCategories: (start: string, end: string, groupName?: string) =>
    getJson<CategoryCount[]>("/metrics/categories", {
      start,
      end,
      ...(groupName ? { groupName } : {}),
    }),

  getOperators: (start: string, end: string, groupName?: string) =>
    getJson<OperatorStat[]>("/metrics/operators", {
      start,
      end,
      ...(groupName ? { groupName } : {}),
    }),
};
