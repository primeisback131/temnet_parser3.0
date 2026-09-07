import type {
  ActiveSession,
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

/**
 * Base of the API. Relative by default (`/api`): the dev server proxies it and
 * a reverse proxy does the same in production, so the SPA and the API share
 * one origin and the session cookie needs no cross-site setup. An absolute
 * URL still works for a split deployment (the backend then needs CORS_ORIGIN).
 */
const BASE = import.meta.env.VITE_API_BASE || "/api";

/** Any non-2xx answer; `message` is what the backend said, when it said anything. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** 401: no valid session (or wrong credentials on the login call). */
export class UnauthorizedError extends ApiError {
  constructor(message = "Требуется вход") {
    super(401, message);
    this.name = "UnauthorizedError";
  }
}

/** 403: the account exists but lacks rights for this data. */
export class ForbiddenError extends ApiError {
  constructor(message = "Нет доступа к этим данным") {
    super(403, message);
    this.name = "ForbiddenError";
  }
}

/** 409: the server refuses because the same work is already running. */
export class ConflictError extends ApiError {
  constructor(message = "Операция уже выполняется") {
    super(409, message);
    this.name = "ConflictError";
  }
}

/** 429: the login rate limiter kicked in. */
export class TooManyRequestsError extends ApiError {
  constructor(message = "Слишком много попыток, попробуйте позже") {
    super(429, message);
    this.name = "TooManyRequestsError";
  }
}

/**
 * Fired on `window` when the backend answers 401 to a call made on behalf of
 * a signed-in user: the session has expired or the account was disabled.
 * The auth provider listens and shows the login screen.
 */
export const SESSION_EXPIRED_EVENT = "temnet:session-expired";

/** The CSRF token Spring publishes in a readable cookie. */
function csrfToken(): string {
  const match = document.cookie.match(/(?:^|; )XSRF-TOKEN=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

/** The `message` of an error body, when the backend sent one. */
async function errorMessage(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    if (!text) return null;
    const body: unknown = JSON.parse(text);
    return typeof body === "object" && body !== null && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : null;
  } catch {
    return null;
  }
}

async function request<T>(path: string, init: RequestInit, params?: Record<string, string>): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
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
  if (!res.ok) {
    const message = await errorMessage(res);
    switch (res.status) {
      case 401:
        // Wrong credentials on the login call and "not signed in yet" on the
        // startup check are expected; anything else means the session died.
        if (path !== "/auth/login" && path !== "/auth/me") {
          window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        }
        throw new UnauthorizedError(message ?? undefined);
      case 403:
        throw new ForbiddenError(message ?? undefined);
      case 409:
        throw new ConflictError(message ?? undefined);
      case 429:
        throw new TooManyRequestsError(message ?? undefined);
      default:
        throw new ApiError(res.status, message ?? `Запрос ${path} вернул ${res.status}`);
    }
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
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
  /** The caller's own password; the current one proves ownership. */
  changePassword: (currentPassword: string, newPassword: string) =>
    send<void>("/auth/password", "POST", { currentPassword, newPassword }),

  // ---- account administration ----
  listUsers: () => getJson<UserAccount[]>("/admin/users"),
  listGrantableHelpAccounts: () => getJson<HelpAccountScope[]>("/admin/users/help-accounts"),
  createUser: (body: UserCreateRequest) => send<number>("/admin/users", "POST", body),
  updateUser: (id: number, body: UserUpdateRequest) => send<void>(`/admin/users/${id}`, "PUT", body),
  /** Issues a temporary password the user has to replace at next login. */
  setUserPassword: (id: number, password: string) =>
    send<void>(`/admin/users/${id}/password`, "PUT", { password }),
  deleteUser: (id: number) => send<void>(`/admin/users/${id}`, "DELETE"),
  listSessions: () => getJson<ActiveSession[]>("/admin/sessions"),
  terminateSession: (id: string) => send<void>(`/admin/sessions/${encodeURIComponent(id)}`, "DELETE"),
  unlockSession: (username: string, ip: string) =>
    send<void>("/admin/sessions/unlock", "POST", { username, ip }),

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

  /** Correspondence of one group; `user` narrows it to a single client's conversation. */
  getChats: (start: string, end: string, groupName: string, user?: string) =>
    getJson<ChatMessage[]>("/chat", { start, end, groupName, ...(user ? { user } : {}) }),

  /** Clients of the group that talked to support in the period (chat access). */
  getChatParticipants: (start: string, end: string, groupName: string) =>
    getJson<string[]>("/chat/chatlist", { start, end, groupName }),

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
