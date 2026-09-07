import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { Bucket } from "./types";

/** Groups the signed-in user may see in the given area. */
export function useGroups(area: "metrics" | "chats" = "metrics") {
  return useQuery({
    queryKey: ["groups", area],
    queryFn: () => api.getGroups(area),
    staleTime: 5 * 60 * 1000,
  });
}

/** Desks the user may report on; closed to read-only accounts, hence `enabled`. */
export function useHelpAccounts(enabled = true) {
  return useQuery({
    queryKey: ["helpAccounts"],
    queryFn: api.getHelpAccounts,
    staleTime: 5 * 60 * 1000,
    enabled,
  });
}

export function useCompanies(start: string, end: string) {
  return useQuery({
    queryKey: ["companies", start, end],
    queryFn: () => api.getCompanies(start, end),
  });
}

export function useUsers(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["users", start, end, groupName],
    queryFn: () => api.getUsers(start, end, groupName!),
    enabled: Boolean(groupName),
  });
}

/** One client's conversation with support; nothing is fetched until both are chosen. */
export function useChats(start: string, end: string, groupName: string | null, user: string | null) {
  return useQuery({
    queryKey: ["chats", start, end, groupName, user],
    queryFn: () => api.getChats(start, end, groupName!, user!),
    enabled: Boolean(groupName) && Boolean(user),
  });
}

/** Clients of the group who talked to support in the period (the chat list). */
export function useChatParticipants(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["chatParticipants", start, end, groupName],
    queryFn: () => api.getChatParticipants(start, end, groupName!),
    enabled: Boolean(groupName),
  });
}

export function useTimeseries(
  start: string,
  end: string,
  bucket: Bucket,
  groupName: string | null,
) {
  return useQuery({
    queryKey: ["timeseries", start, end, bucket, groupName],
    queryFn: () => api.getTimeseries(start, end, bucket, groupName ?? undefined),
  });
}

/** Tickets still open at the end of the period (the real backlog). */
export function useBacklog(end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["backlog", end, groupName],
    queryFn: () => api.getBacklog(end, groupName ?? undefined),
  });
}

/** The individual tickets behind the backlog count; fetched on demand. */
export function useBacklogTickets(end: string, groupName: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["backlogTickets", end, groupName],
    queryFn: () => api.getBacklogTickets(end, groupName ?? undefined),
    enabled,
  });
}

export function useHeatmap(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["heatmap", start, end, groupName],
    queryFn: () => api.getHeatmap(start, end, groupName ?? undefined),
  });
}

export function useSla(start: string, end: string, bucket: Bucket, groupName: string | null) {
  return useQuery({
    queryKey: ["sla", start, end, bucket, groupName],
    queryFn: () => api.getSla(start, end, bucket, groupName ?? undefined),
  });
}

export function useResolution(
  start: string,
  end: string,
  bucket: Bucket,
  groupName: string | null,
) {
  return useQuery({
    queryKey: ["resolution", start, end, bucket, groupName],
    queryFn: () => api.getResolution(start, end, bucket, groupName ?? undefined),
  });
}

export function useReopens(
  start: string,
  end: string,
  bucket: Bucket,
  groupName: string | null,
) {
  return useQuery({
    queryKey: ["reopens", start, end, bucket, groupName],
    queryFn: () => api.getReopens(start, end, bucket, groupName ?? undefined),
  });
}

export function useAlerts() {
  return useQuery({
    queryKey: ["alerts"],
    queryFn: api.getAlerts,
  });
}

export function useCategories(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["categories", start, end, groupName],
    queryFn: () => api.getCategories(start, end, groupName ?? undefined),
  });
}

export function useOperators(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["operators", start, end, groupName],
    queryFn: () => api.getOperators(start, end, groupName ?? undefined),
  });
}

/**
 * State of the analytics sync for the maintenance screen. While a run is in
 * flight it is polled every 2 s, so a rebuild finishing is visible without a
 * page reload; when nothing is running the polling stops.
 */
export function useSyncStatus() {
  return useQuery({
    queryKey: ["syncStatus"],
    queryFn: api.getSyncStatus,
    refetchInterval: (query) => (query.state.data?.run?.running ? 2000 : false),
  });
}

/**
 * The LLM step for the maintenance screen: counters, usage of the
 * subscription window, last runs, settings. Polled quickly while a run is
 * in flight (the counters move), slowly otherwise (the window resets on its own).
 */
export function useLlmStatus() {
  return useQuery({
    queryKey: ["llmStatus"],
    queryFn: api.getLlmStatus,
    refetchInterval: (query) => (query.state.data?.run?.running ? 3000 : 30000),
  });
}

/** Signed-in sessions and lockouts, refreshed while the maintenance screen is open. */
export function useSessions() {
  return useQuery({
    queryKey: ["sessions"],
    queryFn: api.listSessions,
    refetchInterval: 15_000,
  });
}
