import type { CurrentUser } from "../api/types";

/**
 * The group whose chat shows this client, or null when the account may not
 * read it. Metrics and chats are granted apart. A client can belong to
 * several groups (groupNames, sorted); the selected group wins, otherwise the
 * first one whose chats are granted.
 */
export function chatGroupFor(
  user: CurrentUser | null,
  groupNames: string | null,
  selected: string | null,
): string | null {
  const candidates = selected ? [selected] : (groupNames ?? "").split(",").map((g) => g.trim());
  return candidates.find((g) => g && (user?.unrestricted || user?.chatGroups.includes(g))) ?? null;
}
