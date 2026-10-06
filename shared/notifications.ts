/**
 * Shared notification vocabulary and response contract.
 *
 * A notification is one stored row per recipient (migration 0008). It carries
 * facts - which order, which status, what total - and no sentence. The sentence
 * is built in the reader's language on the client, so the same row reads
 * "Commande confirmée" to a French customer and "تم تأكيد الطلب" to an Arabic
 * one, and a customer who switches language sees their whole history follow.
 *
 * Two audiences share the table:
 *
 *   admin    - "a new order came in". One row is written for every admin, so
 *              each admin has their own read state.
 *   customer - "your order was received / its status changed". Written only for
 *              orders that belong to an account; a guest order has nobody to
 *              notify.
 *
 * An admin is also a possible customer (they can place orders from their own
 * account), so an admin may hold rows of both audiences. A customer can only
 * ever hold `customer` rows, and the read endpoint enforces that again by role,
 * so a demoted admin stops seeing the shop's order feed.
 */

export const NOTIFICATION_AUDIENCES = ["admin", "customer"] as const;
export type NotificationAudience = (typeof NOTIFICATION_AUDIENCES)[number];

/**
 * `order_new`      - admin: an order was placed.
 * `order_received` - customer: their order was recorded.
 * `order_status`   - customer: an admin moved their order to `orderStatus`.
 */
export const NOTIFICATION_TYPES = ["order_new", "order_received", "order_status"] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** One notification as the API returns it. */
export type AppNotification = {
  id: number;
  audience: NotificationAudience;
  type: NotificationType;
  orderId: number | null;
  /** Display form of the order id, e.g. the same number the order pages show. */
  orderNumber: string | null;
  /** The order's status at the moment the notification was written. */
  orderStatus: string | null;
  orderTotal: number | null;
  /** Admin rows only: the customer's name as typed at checkout. */
  customerName: string | null;
  read: boolean;
  createdAt: string | null;
};

export type NotificationListResponse = {
  items: AppNotification[];
  /** Rows matching the request, ignoring `limit`. */
  total: number;
  /** Unread rows matching the request, ignoring `limit`. Drives the badge. */
  unreadCount: number;
};

export const NOTIFICATION_PAGE_DEFAULT = 10;
export const NOTIFICATION_PAGE_MAX = 100;

/** Rows per page of the admin history. Fixed by the server, not by the caller. */
export const ADMIN_NOTIFICATION_PAGE_SIZE = 20;

/**
 * Filters of the admin history: everything, unread only, or one admin-side
 * type. A new admin type becomes filterable by adding it here - the endpoint
 * accepts any entry of this list and nothing else.
 */
export const ADMIN_NOTIFICATION_FILTERS = ["all", "unread", "order_new"] as const;
export type AdminNotificationFilter = (typeof ADMIN_NOTIFICATION_FILTERS)[number];

/** One server page of the admin history. */
export type NotificationPageResponse = NotificationListResponse & {
  page: number;
  pageSize: number;
  totalPages: number;
};
