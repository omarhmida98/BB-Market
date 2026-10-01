/**
 * Shared order vocabulary: statuses, the timeline, and the item snapshot format.
 *
 * This lives in `shared/` for two reasons:
 *
 *   - the server serialises orders for `/api/my-orders` with it, and the client
 *     renders the same timeline from the same list, so a status can never be
 *     labelled "unknown" on one side and "delivered" on the other;
 *   - it is pure, so the rules below (which statuses form a progression, what a
 *     cancelled order is *not* allowed to claim) are unit-testable without a
 *     database.
 */
import { z } from "zod";
import type { FulfillmentMethod, Order } from "./schema.js";

/**
 * Every status an admin can put an order into. This mirrors the allow-list in
 * `PATCH /api/orders/:id/status`; keep the two in step.
 */
export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
  "cancelled",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * The happy path, in order. `cancelled` is deliberately absent: it is an exit
 * from the flow, not a step in it, so a cancelled order must never render the
 * later steps as if they had happened.
 */
export const ORDER_STATUS_FLOW = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "delivered",
] as const;

export type OrderStatusFlow = (typeof ORDER_STATUS_FLOW)[number];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === "string" && (ORDER_STATUSES as readonly string[]).includes(value);
}

/**
 * A status the database does not know about (a hand-edited row, or one written
 * by a newer server version). Rendering it as "pending" would be a lie, so the
 * UI shows the raw value instead.
 */
export function normalizeOrderStatus(value: unknown): OrderStatus | "unknown" {
  return isOrderStatus(value) ? value : "unknown";
}

export function isOrderCancelled(status: unknown): boolean {
  return status === "cancelled";
}

/**
 * Index of `status` within the happy path, or -1 when the order is cancelled or
 * in an unknown state. The timeline uses this to decide which steps are done,
 * current, or still ahead.
 */
export function orderFlowIndex(status: unknown): number {
  const index = (ORDER_STATUS_FLOW as readonly string[]).indexOf(String(status));
  return index;
}

/**
 * One line of an order, as it was at checkout.
 *
 * These are *snapshots*. `price` is what was actually charged, which may differ
 * from the product's current price and from `originalPrice` when a promotion
 * applied. Order history must render exactly these values and must never re-read
 * the live product: a renamed, repriced, discounted or deleted product must not
 * rewrite what a customer was billed.
 */
export type OrderItemSnapshot = {
  id: number;
  name: string;
  quantity: number;
  /** Unit price actually charged. */
  price: number;
  /** List price before the promotion. Equals `price` when no promo applied. */
  originalPrice: number;
  /** True when `price` is a promotional price. */
  promoApplied: boolean;
  /** Image as it was at checkout; may be null for very old rows. */
  imageUrl: string | null;
  /** quantity * price. */
  lineTotal: number;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Parse `items_json` into typed snapshots.
 *
 * Rows written before the promotion feature have no `originalPrice` /
 * `promoApplied`, so those default to "no promotion" rather than to 0/true.
 * Returns an empty list for malformed JSON instead of throwing: one corrupt row
 * must not take down the whole order history page.
 */
export function parseOrderItems(itemsJson: string | null | undefined): OrderItemSnapshot[] {
  if (!itemsJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(itemsJson);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  return parsed
    .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === "object")
    .map((raw) => {
      const quantity = Math.max(1, Math.trunc(toNumber(raw.quantity, 1)));
      const price = toNumber(raw.price);
      // `originalPrice` was added alongside promotions; older rows fall back to
      // the paid price so the UI shows no strike-through and no savings claim.
      const hasOriginal = raw.originalPrice !== undefined && raw.originalPrice !== null;
      const originalPrice = hasOriginal ? toNumber(raw.originalPrice) : price;
      const promoApplied = raw.promoApplied === true && originalPrice > price;

      return {
        id: toNumber(raw.id),
        name: typeof raw.name === "string" ? raw.name : "",
        quantity,
        price,
        originalPrice,
        promoApplied,
        imageUrl: typeof raw.imageUrl === "string" && raw.imageUrl ? raw.imageUrl : null,
        lineTotal: price * quantity,
      };
    })
    .filter((item) => item.id !== 0 || item.name !== "");
}

/** Total number of units, not total distinct lines. */
export function countOrderUnits(items: OrderItemSnapshot[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/** Order as sent to the customer's own account area. */
export type CustomerOrder = {
  id: number;
  orderNumber: string;
  createdAt: string | null;
  status: OrderStatus | "unknown";
  fulfillmentMethod: FulfillmentMethod;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  total: number;
  customerName: string;
  email: string | null;
  phone: string;
  address: string | null;
  notes: string | null;
  items: OrderItemSnapshot[];
  itemCount: number;
};

/**
 * Stable, human-quotable order reference, e.g. `#BBM-1042`.
 *
 * It is derived from the row id rather than stored, so existing orders get one
 * for free and there is no column to keep in sync. It is a *label*, not a
 * secret: ownership is always checked server-side by user id, never by matching
 * this string.
 */
export function formatOrderNumber(id: number): string {
  return `BBM-${String(id).padStart(4, "0")}`;
}

/**
 * Serialise a row for the customer account.
 *
 * `itemsJson` is parsed here rather than in the browser so the client never has
 * to `JSON.parse` trusted-shaped-but-untyped data, and so list and detail
 * responses are guaranteed to agree.
 */
export function toCustomerOrder(order: Order): CustomerOrder {
  const items = parseOrderItems(order.itemsJson);
  return {
    id: order.id,
    orderNumber: formatOrderNumber(order.id),
    createdAt: order.createdAt ? new Date(order.createdAt as any).toISOString() : null,
    status: normalizeOrderStatus(order.status),
    fulfillmentMethod: order.fulfillmentMethod,
    paymentMethod: order.paymentMethod,
    subtotal: toNumber(order.subtotal),
    deliveryFee: toNumber(order.deliveryFee),
    total: toNumber(order.total),
    customerName: order.customerName,
    email: order.email ?? null,
    phone: order.phone,
    address: order.address ?? null,
    notes: order.notes ?? null,
    items,
    itemCount: countOrderUnits(items),
  };
}

/**
 * Thin out a list response: the detail page shows everything, the list only
 * needs a preview. Thumbnails are kept (capped) so the card can show what was
 * ordered without a second request.
 */
export const ORDER_LIST_PREVIEW_LIMIT = 4;

export type CustomerOrderSummary = Omit<CustomerOrder, "items"> & {
  items: OrderItemSnapshot[];
};

export function toCustomerOrderSummary(order: Order): CustomerOrderSummary {
  const full = toCustomerOrder(order);
  return { ...full, items: full.items.slice(0, ORDER_LIST_PREVIEW_LIMIT) };
}

/**
 * Response contract for `/api/my-orders*`, kept next to the serialiser that
 * produces it so the two cannot drift. `status` allows "unknown" because a row
 * written by a newer server must not break an older client's type check.
 */
export const orderItemSnapshotSchema = z.object({
  id: z.number(),
  name: z.string(),
  quantity: z.number().int().min(1),
  price: z.number(),
  originalPrice: z.number(),
  promoApplied: z.boolean(),
  imageUrl: z.string().nullable(),
  lineTotal: z.number(),
});

export const customerOrderSchema = z.object({
  id: z.number(),
  orderNumber: z.string(),
  createdAt: z.string().nullable(),
  status: z.union([z.enum(ORDER_STATUSES), z.literal("unknown")]),
  fulfillmentMethod: z.enum(["delivery", "pickup"]),
  paymentMethod: z.string(),
  subtotal: z.number(),
  deliveryFee: z.number(),
  total: z.number(),
  customerName: z.string(),
  email: z.string().nullable(),
  phone: z.string(),
  address: z.string().nullable(),
  notes: z.string().nullable(),
  items: z.array(orderItemSnapshotSchema),
  itemCount: z.number().int().min(0),
});