import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Bell, ChevronRight, Loader2 } from "lucide-react";
import { useNotifications } from "@/hooks/use-notifications";
import { formatDate } from "@/lib/format";
import { ACCOUNT_NOTIFICATIONS_ANCHOR, describeNotification } from "@/lib/notifications";

/** Rows shown at first, and how many more each "show more" adds. */
const PAGE_SIZE = 10;

/**
 * The customer's notification history, inside the account page.
 *
 * It asks for the `customer` audience only: this is the history of the signed-in
 * person's own orders. An admin looking at their own account sees their own
 * orders here too, not the shop-wide "new order" feed, which belongs to the bell
 * and the admin Orders tab.
 *
 * The server filters by the session's user id, so nothing here could show
 * another customer's entry even if this component asked for it.
 */
export function NotificationsSection() {
  const { t, i18n } = useTranslation();
  const [, setLocation] = useLocation();
  const [limit, setLimit] = useState(PAGE_SIZE);
  const { items, total, unreadCount, isLoading, markRead, markAllRead } = useNotifications({ limit, audience: "customer" });
  const sectionRef = useRef<HTMLElement>(null);

  // "See all" in the navbar bell lands here. The hash covers arriving from
  // another page; the event covers the case where this page is already open.
  useEffect(() => {
    const scroll = () => sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Delayed so the sections above have laid out, or the target moves under us.
    const timer =
      window.location.hash === `#${ACCOUNT_NOTIFICATIONS_ANCHOR}` ? window.setTimeout(scroll, 300) : undefined;
    window.addEventListener("notifications:show-history", scroll);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("notifications:show-history", scroll);
    };
  }, []);

  return (
    <motion.section
      ref={sectionRef}
      id={ACCOUNT_NOTIFICATIONS_ANCHOR}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="scroll-mt-28 rounded-[2.5rem] border border-border bg-card/80 backdrop-blur-md shadow-xl overflow-hidden"
      data-testid="notifications-section"
    >
      <div className="p-6 border-b border-border flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <Bell className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-display font-bold text-lg">{t("notifications.history_title")}</h2>
            <p className="text-sm text-muted-foreground">
              {unreadCount > 0
                ? unreadCount > 1
                  ? t("notifications.unread_plural", "{{count}} non lues", { count: unreadCount })
                  : t("notifications.unread_singular", "{{count}} non lue", { count: unreadCount })
                : t("notifications.history_subtitle")}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markAllRead.mutate()}
            disabled={markAllRead.isPending}
            className="text-sm font-bold text-primary hover:underline disabled:opacity-50"
            data-testid="notifications-mark-all"
          >
            {t("notifications.mark_all_read", "Marquer toutes comme lues")}
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-16 px-6 text-center" data-testid="notifications-empty">
          <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-6 text-primary">
            <Bell className="h-10 w-10" />
          </div>
          <h3 className="text-2xl font-display font-bold text-foreground mb-2">{t("notifications.history_empty_title")}</h3>
          <p className="text-muted-foreground max-w-md mx-auto">{t("notifications.history_empty_desc")}</p>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-border" data-testid="notifications-list">
            {items.map((item) => {
              const { title, detail, href } = describeNotification(item, t, i18n.language);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!item.read) markRead.mutate(item.id);
                      if (href) setLocation(href);
                    }}
                    className={`w-full text-start p-5 sm:p-6 flex items-start gap-4 hover:bg-secondary/40 transition-colors ${
                      item.read ? "" : "bg-primary/[0.04]"
                    }`}
                    data-testid="notification-row"
                    data-read={item.read ? "true" : "false"}
                  >
                    <span
                      aria-hidden
                      className={`mt-2 h-2.5 w-2.5 shrink-0 rounded-full ${item.read ? "bg-transparent" : "bg-primary"}`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className={item.read ? "font-semibold text-foreground" : "font-black text-foreground"}>{title}</span>
                        {!item.read && (
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
                            {t("notifications.unread_label")}
                          </span>
                        )}
                      </div>
                      {detail && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          <bdi>{detail}</bdi>
                        </p>
                      )}
                      {item.createdAt && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDate(item.createdAt, i18n.language, {
                            day: "2-digit",
                            month: "2-digit",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    {href && (
                      <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-bold text-primary">
                        <span className="hidden sm:inline">{t("notifications.view_order")}</span>
                        <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>

          {items.length < total && (
            <div className="p-4 text-center border-t border-border">
              <button
                type="button"
                onClick={() => setLimit((current) => current + PAGE_SIZE)}
                className="text-sm font-bold text-primary hover:underline"
                data-testid="notifications-more"
              >
                {t("notifications.show_more")}
              </button>
            </div>
          )}
        </>
      )}
    </motion.section>
  );
}
