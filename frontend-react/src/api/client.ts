import type {
  AlertsReport,
  CurrentUser,
  HelpAccountScope,
  UserAccount,
  UserCreateRequest,
  UserUpdateRequest,
  BacklogReport,
  Bucket,
  CategoryCount,
  ChatMessage,
  Company,
  Group,
  HeatmapCell,
  HelpAccount,
  HelpAccountReport,
  MetricPoint,
  OpenTicket,
  OperatorStat,
  ReopenPoint,
  ResolutionPoint,
  SlaPoint,
  SyncRun,
  SyncStatus,
  UserStat,
} from "./types";

const BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

/** Thrown on 401 so the app can show the login screen instead of an error. */
export class UnauthorizedError extends Error {
  constructor() {
    super("Требуется вход");
  }
}

/** Thrown on 403 - the account exists but lacks rights for this data. */
export class ForbiddenError extends Error {
  constructor() {
    super("Нет доступа к этим данным");
  }
}

/** Thrown on 409 - the server refuses because the same work is already running. */
export class ConflictError extends Error {
  constructor() {
    super("Синхронизация уже выполняется");
  }
}

/** The CSRF token Spring publishes in a readable cookie. */
function csrfToken(): string {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function request<T>(path: string, init: RequestInit, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
  }
  const method = init.method ?? "GET";
  const res = await fetch(url.toString(), {
    ...init,
    // The session rides in a cookie, so every call must carry credentials.
    credentials: "include",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(method === "GET" ? {} : { "X-XSRF-TOKEN": csrfToken() }),
      ...init.headers,
    },
  });
  if (res.status === 401) {
    throw new UnauthorizedError();
  }
  if (res.status === 403) {
    throw new ForbiddenError();
  }
  if (res.status === 409) {
    throw new ConflictError();
  }
  if (!res.ok) {
    throw new Error((await problemDetail(res)) ?? `Запрос ${path} вернул ${res.status} ${res.statusText}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

/** A rejected request carries its human-readable reason in the problem body. */
async function problemDetail(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null && "detail" in body && typeof body.detail === "string") {
      return body.detail;
    }
  } catch {
    // Not a JSON body - fall back to the status line.
  }
  return undefined;
}

async function getJson<T>(path: string, params?: Record<string, string>): Promise<T> {
  return request<T>(path, { method: "GET" }, params);
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return request<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
}

export const api = {
  // ---- authentication ----
  login: (username: string, password: string) =>
    send<CurrentUser>("/auth/login", "POST", { username, password }),
  logout: () => send<void>("/auth/logout", "POST"),
  me: () => getJson<CurrentUser>("/auth/me"),

  // ---- account administration ----
  listUsers: () => getJson<UserAccount[]>("/admin/users"),
  listGrantableHelpAccounts: () => getJson<HelpAccountScope[]>("/admin/users/help-accounts"),
  createUser: (body: UserCreateRequest) => send<number>("/admin/users", "POST", body),
  updateUser: (id: number, body: UserUpdateRequest) => send<void>(`/admin/users/${id}`, "PUT", body),
  setUserPassword: (id: number, password: string) =>
    send<void>(`/admin/users/${id}/password`, "PUT", { password }),
  deleteUser: (id: number) => send<void>(`/admin/users/${id}`, "DELETE"),

  // ---- analytics DB maintenance (admins only) ----
  getSyncStatus: () => getJson<SyncStatus>("/admin/sync/status"),
  /** Both starts return at once; the run itself is polled via getSyncStatus. */
  startSync: () => send<SyncRun>("/admin/sync", "POST"),
  startRebuild: () => send<SyncRun>("/admin/sync/rebuild", "POST"),

  /** `area` picks which grant decides the list: metrics (default) or chats. */
  getGroups: (area: "metrics" | "chats" = "metrics") => getJson<Group[]>("/groups", { area }),

  getCompanies: (start: string, end: string) =>
    getJson<Company[]>("/companies", { start, end }),

  getHelpAccounts: () => getJson<HelpAccount[]>("/help-accounts"),

  getHelpAccountReport: (start: string, end: string, account: string) =>
    getJson<HelpAccountReport>("/help-accounts/report", { start, end, account }),

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

  getBacklog: (end: string, groupName?: string) =>
    getJson<BacklogReport>("/metrics/backlog", {
      end,
      ...(groupName ? { groupName } : {}),
    }),

  getBacklogTickets: (end: string, groupName?: string) =>
    getJson<OpenTicket[]>("/metrics/backlog/tickets", {
      end,
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

  getResolution: (start: string, end: string, bucket: Bucket, groupName?: string) =>
    getJson<ResolutionPoint[]>("/metrics/resolution", {
      start,
      end,
      bucket,
      ...(groupName ? { groupName } : {}),
    }),

  getReopens: (start: string, end: string, bucket: Bucket, groupName?: string) =>
    getJson<ReopenPoint[]>("/metrics/reopens", {
      start,
      end,
      bucket,
      ...(groupName ? { groupName } : {}),
    }),

  getAlerts: () => getJson<AlertsReport>("/metrics/alerts"),

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
