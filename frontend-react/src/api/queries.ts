import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import type { Bucket } from "./types";

export function useGroups() {
  return useQuery({
    queryKey: ["groups"],
    queryFn: api.getGroups,
    staleTime: 5 * 60 * 1000,
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

export function useChats(start: string, end: string, groupName: string | null) {
  return useQuery({
    queryKey: ["chats", start, end, groupName],
    queryFn: () => api.getChats(start, end, groupName!),
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
