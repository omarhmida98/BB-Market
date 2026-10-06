import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Bell, X, CheckCircle, Package, ShoppingBag, XCircle } from "lucide-react";
import { useNotifications } from "@/hooks/use-notifications";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
import { formatDate } from "@/lib/format";
import { ACCOUNT_NOTIFICATIONS_ANCHOR, ADMIN_OPEN_ORDER_EVENT, describeNotification } from "@/lib/notifications";
import type { AppNotification } from "@shared/notifications";

export function NotificationDropdown() {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { unreadCount, items, markRead, markAllRead } = useNotifications();
  const { user } = useAuth();
  const [, setLocation] = useLocation();

  const panelRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<{ top: number; left: number; width: number } | null>(null);

  // Close dropdown when clicking outside. The panel is rendered in a portal, so
  // it is not a DOM child of the bell and has to be checked separately.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (dropdownRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setIsOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Where the panel goes: under the bell, aligned to the bell's trailing edge,
  // then clamped inside the screen. It is measured rather than done in CSS
  // because the bell lives in three different layouts (desktop bar, mobile bar,
  // admin dashboard) and in two reading directions, and an anchored panel runs
  // off one side or the other in some combination of them.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const place = () => {
      const bell = dropdownRef.current?.getBoundingClientRect();
      if (!bell) return;
      const gutter = 12;
      const viewport = document.documentElement.clientWidth;
      const width = Math.min(384, viewport - gutter * 2);
      const rtl = document.documentElement.dir === "rtl";
      const wanted = rtl ? bell.left : bell.right - width;
      setPlacement({
        top: bell.bottom + 8,
        left: Math.max(gutter, Math.min(wanted, viewport - width - gutter)),
        width,
      });
    };
    place();
    window.addEventListener("resize", place);
    // Capture, so scrolling any ancestor keeps the panel under the bell.
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen]);

  if (!user) return null;

  const isAdmin = user.role === "admin" || user.role === "superadmin";

  const handleItemClick = (item: AppNotification) => {
    setIsOpen(false);
    if (!item.read) markRead.mutate(item.id);

    const { href } = describeNotification(item, t, i18n.language);
    if (!href) return;
    setLocation(href);
    // The admin page may already be open, in which case the URL change alone
    // does not remount it; the event tells it which order to show.
    if (item.audience === "admin" && item.orderId !== null) {
      window.dispatchEvent(new CustomEvent(ADMIN_OPEN_ORDER_EVENT, { detail: { orderId: item.orderId } }));
    }
  };

  const handleViewAll = () => {
    setIsOpen(false);
    setLocation(`/account#${ACCOUNT_NOTIFICATIONS_ANCHOR}`);
    // Same reason as above: if the account page is already open, ask it to scroll.
    window.dispatchEvent(new Event("notifications:show-history"));
  };

  const getTypeIcon = (item: AppNotification) => {
    if (item.type === "order_new") return <ShoppingBag className="w-3.5 h-3.5" />;
    if (item.orderStatus === "cancelled") return <XCircle className="w-3.5 h-3.5" />;
    if (item.orderStatus === "delivered" || item.orderStatus === "confirmed") return <CheckCircle className="w-3.5 h-3.5" />;
    return <Package className="w-3.5 h-3.5" />;
  };

  const getTimeAgo = (dateStr: Date | string | null) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return t("notifications.time_just_now", "À l'instant");
    if (diffMins < 60) return t("notifications.time_minutes", "Il y a {{count}} min", { count: diffMins });
    if (diffHours < 24) return t("notifications.time_hours", "Il y a {{count}}h", { count: diffHours });
    if (diffDays < 7) return t("notifications.time_days", "Il y a {{count}}j", { count: diffDays });
    return formatDate(date, i18n.language, { day: "2-digit", month: "short" });
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-muted-foreground hover:text-primary transition-colors rounded-full hover:bg-primary/5"
        aria-label={t("notifications.aria", "Notifications")}
        title={t("notifications.aria", "Notifications")}
        aria-expanded={isOpen}
        data-testid="notification-bell"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span
            className="absolute -top-0.5 -end-0.5 flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[9px] font-bold border-2 border-background animate-in zoom-in-50 duration-300"
            data-testid="notification-badge"
          >
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {isOpen && placement && createPortal(
        // Rendered on <body> so `fixed` means the screen. Inside the page it
        // would be measured from whichever ancestor has a blur or a transform.
        <div
          ref={panelRef}
          style={placement}
          className="fixed bg-card text-foreground rounded-2xl shadow-2xl border border-border overflow-hidden z-[60] animate-in slide-in-from-top-2 duration-200"
          data-testid="notification-panel"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-primary/5 to-transparent">
            <div>
              <h3 className="font-bold text-foreground text-sm">{t("notifications.title", "Notifications")}</h3>
              <p className="text-[11px] text-muted-foreground">
                {unreadCount > 0
                  ? unreadCount > 1
                    ? t("notifications.unread_plural", "{{count}} non lues", { count: unreadCount })
                    : t("notifications.unread_singular", "{{count}} non lue", { count: unreadCount })
                  : ""}
              </p>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              aria-label={t("notifications.close")}
              className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Notification List */}
          <div className="max-h-80 overflow-y-auto">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center text-muted-foreground mb-3">
                  <Bell className="w-6 h-6" />
                </div>
                <p className="text-sm font-medium text-muted-foreground">{t("notifications.empty", "Aucune notification")}</p>
                <p className="text-xs text-muted-foreground/80 mt-1 text-center">{t("notifications.empty_hint", "Vous serez notifié en cas de nouvelle activité.")}</p>
              </div>
            ) : (
              items.map((item) => {
                const { title, detail } = describeNotification(item, t, i18n.language);
                return (
                  <button
                    key={item.id}
                    onClick={() => handleItemClick(item)}
                    data-testid="notification-item"
                    data-read={item.read ? "true" : "false"}
                    className={`w-full flex items-start gap-3 px-4 py-3.5 text-start hover:bg-secondary/60 transition-colors border-b border-border/60 last:border-b-0 ${
                      !item.read ? "bg-primary/[0.04]" : ""
                    }`}
                  >
                    {/* Icon */}
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                      !item.read
                        ? "bg-primary/10 text-primary"
                        : "bg-secondary text-muted-foreground"
                    }`}>
                      {getTypeIcon(item)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${!item.read ? "font-bold text-foreground" : "font-medium text-foreground/80"}`}>
                        {title}
                      </p>
                      {detail && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          <bdi>{detail}</bdi>
                        </p>
                      )}
                      <p className="text-[10px] text-muted-foreground/80 mt-1.5 font-medium">
                        {getTimeAgo(item.createdAt)}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!item.read && (
                      <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-2" />
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {items.length > 0 && (
            <div className="border-t border-border p-2 flex gap-2">
              <button
                onClick={() => markAllRead.mutate()}
                disabled={unreadCount === 0 || markAllRead.isPending}
                data-testid="notification-mark-all"
                className="flex-1 py-2.5 text-center text-sm font-bold text-primary hover:bg-primary/5 rounded-xl transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {t("notifications.mark_all_read", "Marquer toutes comme lues")}
              </button>
              {/* The full history lives on the account page, which is the
                  customer's own. An admin's order feed is the Orders tab. */}
              {!isAdmin && (
                <button
                  onClick={handleViewAll}
                  data-testid="notification-view-all"
                  className="flex-1 py-2.5 text-center text-sm font-bold text-foreground hover:bg-secondary rounded-xl transition-colors"
                >
                  {t("notifications.view_all")}
                </button>
              )}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
