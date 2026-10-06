import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "./use-auth";
import { queryClient } from "@/lib/queryClient";
import type { NotificationAudience, NotificationListResponse } from "@shared/notifications";

const NOTIFICATIONS_KEY = "/api/notifications";

/** How often an open page asks whether anything new arrived. */
const POLL_MS = 30_000;

/**
 * The signed-in user's stored notifications.
 *
 * The server scopes every row to the session's own user id, so this hook never
 * sends one. `audience` only narrows what the caller wants to look at (the
 * account page shows the customer's own order history, not the shop's order
 * feed an admin also receives); it cannot widen what the role is allowed.
 *
 * Read state lives in the database, so the badge survives a refresh, another
 * tab and another device. The list is polled and refetched on focus because
 * the events that create notifications happen in somebody else's session - an
 * admin confirming an order - and nothing in this tab would otherwise know.
 */
export function useNotifications({
  limit = 10,
  audience,
}: { limit?: number; audience?: NotificationAudience } = {}) {
  const { user } = useAuth();

  const query = useQuery<NotificationListResponse>({
    // The user id is part of the key so one account's cached list can never be
    // shown to the next person who signs in on the same browser.
    queryKey: [NOTIFICATIONS_KEY, user?.id, audience ?? "all", limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (audience) params.set("audience", audience);
      const response = await fetch(`${NOTIFICATIONS_KEY}?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return await response.json();
    },
    enabled: !!user,
    staleTime: 0,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
  });

  // Every view of the list (bell, account page, any limit) shares the prefix,
  // so marking something read in one place updates the badge in the other.
  const refresh = () => queryClient.invalidateQueries({ queryKey: [NOTIFICATIONS_KEY] });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`${NOTIFICATIONS_KEY}/${id}/read`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Failed to mark notification as read");
    },
    onSuccess: refresh,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const response = await fetch(`${NOTIFICATIONS_KEY}/read-all`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(audience ? { audience } : {}),
      });
      if (!response.ok) throw new Error("Failed to mark notifications as read");
    },
    onSuccess: refresh,
  });

  return {
    items: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    unreadCount: query.data?.unreadCount ?? 0,
    isLoading: query.isLoading,
    error: query.error,
    markRead,
    markAllRead,
  };
}
