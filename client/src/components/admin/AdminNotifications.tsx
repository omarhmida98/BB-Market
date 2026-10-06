import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Bell, Check, ChevronRight, Loader2 } from "lucide-react";
import { queryClient } from "@/lib/queryClient";
import { formatDate } from "@/lib/format";
import { describeNotification } from "@/lib/notifications";
import {
  ADMIN_NOTIFICATION_FILTERS,
  type AdminNotificationFilter,
  type AppNotification,
  type NotificationPageResponse,
} from "@shared/notifications";

/** Same cadence as the bell, so the two never disagree for long. */
const POLL_MS = 30_000;

/**
 * The full stored history of the signed-in admin's notifications.
 *
 * The bell shows the latest few; this is everything, one server page at a time.
 * Filtering and paging both happen in SQL - the browser never holds more than
 * the page on screen, however long the shop has been taking orders.
 *
 * The query key starts with `/api/notifications`, the prefix the bell and the
 * customer history invalidate, so marking something read anywhere refreshes
 * this list and marking it read here refreshes the bell's badge.
 */
export default function AdminNotifications({ onOpenOrder }: { onOpenOrder: (orderId: number) => void }) {
  const { t, i18n } = useTranslation();
  const [filter, setFilter] = useState<AdminNotificationFilter>("all");
  const [page, setPage] = useState(1);

  const history = useQuery<NotificationPageResponse>({
    queryKey: ["/api/notifications", "admin-history", filter, page],
    queryFn: async () => {
      const params = new URLSearchParams({ filter, page: String(page) });
      const response = await fetch(`/api/admin/notifications?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch notifications");
      return await response.json();
    },
    staleTime: 0,
    refetchInterval: POLL_MS,
    refetchOnWindowFocus: true,
    // Keep the previous page on screen while the next one loads, so paging
    // does not flash an empty list.
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });

  const markRead = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" });
      if (!response.ok) throw new Error("Failed to mark notification as read");
    },
    onSuccess: refresh,
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // Only the admin feed: an admin's own customer-side entries are theirs
        // to clear from their account page.
        body: JSON.stringify({ audience: "admin" }),
      });
      if (!response.ok) throw new Error("Failed to mark notifications as read");
    },
    onSuccess: refresh,
  });

  const data = history.data;
  const items = data?.items ?? [];
  const totalPages = data?.totalPages ?? 1;
  const unreadCount = data?.unreadCount ?? 0;

  // Marking things read under the "unread" filter can empty the page being
  // viewed; step back to the last page that still exists.
  useEffect(() => {
    if (data && page > data.totalPages) setPage(data.totalPages);
  }, [data, page]);

  const filterLabel = (value: AdminNotificationFilter) => {
    switch (value) {
      case "unread":
        return t("admin.notifications_filter_unread");
      case "order_new":
        return t("admin.notifications_filter_new_orders");
      default:
        return t("admin.notifications_filter_all");
    }
  };

  const open = (item: AppNotification) => {
    if (!item.read) markRead.mutate(item.id);
    if (item.orderId !== null) onOpenOrder(item.orderId);
  };

  return (
    <div data-testid="admin-notifications">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div role="tablist" aria-label={t("admin.nav_notifications")} className="flex flex-wrap gap-2">
          {ADMIN_NOTIFICATION_FILTERS.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              onClick={() => {
                setFilter(value);
                setPage(1);
              }}
              data-testid={`admin-notifications-filter-${value}`}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border transition-colors ${
                filter === value
                  ? "bg-[#ff6200] text-white border-[#ff6200]"
                  : "border-border hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {filterLabel(value)}
              {value === "unread" && unreadCount > 0 && (
                <span className={`rounded-full px-1.5 text-[11px] font-black ${filter === value ? "bg-white/25" : "bg-red-500 text-white"}`}>
                  {unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => markAllRead.mutate()}
          disabled={unreadCount === 0 || markAllRead.isPending}
          data-testid="admin-notifications-mark-all"
          className="text-sm font-bold text-primary hover:underline disabled:opacity-40 disabled:no-underline"
        >
          {t("notifications.mark_all_read", "Marquer toutes comme lues")}
        </button>
      </div>

      {history.isLoading ? (
        <div className="py-10 text-center text-muted-foreground"><Loader2 className="w-6 h-6 mx-auto animate-spin" /></div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground" data-testid="admin-notifications-empty">
          <Bell className="w-8 h-8 mx-auto mb-3 opacity-40" />
          {filter === "all" ? t("admin.notifications_empty") : t("admin.notifications_empty_filtered")}
        </div>
      ) : (
        <ul className="space-y-3" data-testid="admin-notifications-list">
          {items.map((item) => {
            const { title, total } = describeNotification(item, t, i18n.language);
            return (
              <li
                key={item.id}
                data-testid="admin-notification-row"
                data-read={item.read ? "true" : "false"}
                className={`rounded-2xl border border-border bg-background flex flex-wrap items-center gap-x-4 gap-y-2 p-4 ${item.read ? "" : "ring-1 ring-primary/30"}`}
              >
                <button
                  type="button"
                  onClick={() => open(item)}
                  className="flex min-w-0 flex-1 basis-64 items-start gap-3 text-start"
                  data-testid="admin-notification-open"
                >
                  <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${item.read ? "bg-muted-foreground/25" : "bg-primary"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className={item.read ? "font-semibold" : "font-black"}>{title}</span>
                      {item.orderNumber && <span className="text-sm font-bold text-primary"><bdi>{item.orderNumber}</bdi></span>}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${item.read ? "bg-slate-500/10 text-muted-foreground" : "bg-primary/10 text-primary"}`}>
                        {item.read ? t("admin.notifications_read") : t("notifications.unread_label")}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-muted-foreground">
                      {item.customerName && <span><bdi>{item.customerName}</bdi></span>}
                      {total && <span className="font-bold text-foreground"><bdi>{total}</bdi></span>}
                      {item.createdAt && (
                        <span>
                          {formatDate(item.createdAt, i18n.language, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      )}
                    </span>
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1 ms-auto">
                  {!item.read && (
                    <button
                      type="button"
                      onClick={() => markRead.mutate(item.id)}
                      disabled={markRead.isPending}
                      data-testid="admin-notification-mark-read"
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
                    >
                      <Check className="w-3.5 h-3.5" /> {t("admin.notifications_mark_read")}
                    </button>
                  )}
                  {item.orderId !== null && (
                    <button
                      type="button"
                      onClick={() => open(item)}
                      aria-label={t("notifications.view_order")}
                      title={t("notifications.view_order")}
                      className="p-2 rounded-xl text-primary hover:bg-black/5 dark:hover:bg-white/10"
                    >
                      <ChevronRight className="w-4 h-4 rtl:rotate-180" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {data && data.total > 0 && (
        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground" data-testid="admin-notifications-page">
            {t("admin.pagination", { page: data.page, total: totalPages })} · {t("admin.notifications_total", { count: data.total })}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page <= 1}
              data-testid="admin-notifications-prev"
              className="px-4 py-2 rounded-xl border border-border font-bold disabled:opacity-40"
            >
              {t("admin.products_prev")}
            </button>
            <button
              type="button"
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page >= totalPages}
              data-testid="admin-notifications-next"
              className="px-4 py-2 rounded-xl border border-border font-bold disabled:opacity-40"
            >
              {t("admin.products_next")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
