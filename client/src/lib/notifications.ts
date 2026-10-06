import type { TFunction } from "i18next";
import type { AppNotification } from "@shared/notifications";
import { formatMoney } from "@/lib/format";

/**
 * Turn a stored notification into what the reader sees.
 *
 * The row holds facts (type, order, status, total); the wording is chosen here
 * in the reader's language. The bell and the account history both go through
 * this one function so the same event can never be worded two ways.
 */
export function describeNotification(notification: AppNotification, t: TFunction, language: string) {
  return {
    title: notificationTitle(notification, t),
    /** The order total on its own, formatted for the reader, or `null`. */
    total: notification.orderTotal === null ? null : formatMoney(notification.orderTotal, language),
    /** e.g. "BBM-0012 · 25,000 DT", plus the customer's name on an admin row. */
    detail: [
      notification.orderNumber,
      notification.orderTotal === null ? null : formatMoney(notification.orderTotal, language),
      notification.audience === "admin" ? notification.customerName : null,
    ]
      .filter(Boolean)
      .join(" · "),
    href: notificationHref(notification),
  };
}

function notificationTitle(notification: AppNotification, t: TFunction): string {
  if (notification.type === "order_new") return t("notifications.order_new");
  if (notification.type === "order_received") return t("notifications.order_received");
  // Spelled out per status rather than built from a template, so every wording
  // is a literal key the i18n check can see.
  switch (notification.orderStatus) {
    case "pending":
      return t("notifications.order_status_pending");
    case "confirmed":
      return t("notifications.order_status_confirmed");
    case "preparing":
      return t("notifications.order_status_preparing");
    case "ready":
      return t("notifications.order_status_ready");
    case "delivered":
      return t("notifications.order_status_delivered");
    case "cancelled":
      return t("notifications.order_status_cancelled");
    default:
      return t("notifications.order_status_unknown");
  }
}

/**
 * Where a notification leads: the admin order for an admin row, the customer's
 * own order page otherwise. `null` when it is not about an order.
 */
function notificationHref(notification: AppNotification): string | null {
  if (notification.orderId === null) return null;
  return notification.audience === "admin"
    ? `/admin?order=${notification.orderId}`
    : `/account/orders/${notification.orderId}`;
}

/** Name of the DOM event that asks an already-open admin page to show an order. */
export const ADMIN_OPEN_ORDER_EVENT = "admin:open-order";

/** Anchor id of the notification history on the account page. */
export const ACCOUNT_NOTIFICATIONS_ANCHOR = "notifications";
