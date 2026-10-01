/**
 * Shared analytics vocabulary: date ranges, response shapes, and the pure
 * aggregation helpers behind them.
 *
 * Like `shared/orders.ts`, this lives in `shared/` so that the server, which
 * computes the numbers, and the client, which renders them, are working from one
 * definition of what a "range" or a "top product" is. It holds no SQL: the
 * dialect-specific queries live in `server/analytics.ts`.
 *
 * Everything here is pure and unit-testable without a database, which is the
 * point. The arithmetic that decides whether the dashboard shows 240 DT or 0 DT
 * should not be reachable only by booting a server.
 */
import { z } from "zod";

/**
 * Why every money figure on this dashboard comes from the order row.
 *
 * `orders.total` is the amount actually charged at checkout, delivery fee
 * included, written once by `POST /api/orders`. Recomputing revenue from the live
 * catalogue would rewrite history every time a price changed: a product repriced
 * last week would retroactively alter last month's revenue, and a deleted
 * product would erase the sales that referenced it. Order history is a snapshot
 * for the same reason `OrderItemSnapshot` is - see `shared/orders.ts`.
 *
 * The money columns are TEXT in the schema, so every aggregation that touches
 * them must CAST before summing. PostgreSQL raises `function sum(text) does not
 * exist` rather than coercing, which makes this a hard error, not a warning.
 */
export const ANALYTICS_CANCELLED_STATUS = "cancelled";

/**
 * SQL predicate fragment excluding cancelled orders.
 *
 * Every sales figure on the dashboard must use this same predicate. A cancelled
 * order was never collected, so counting it as revenue would overstate turnover,
 * and counting it in the order total while leaving it out of revenue would make
 * AOV inconsistent with both.
 *
 * It is exported as a fragment rather than applied inside a query builder so the
 * same rule can be pasted into a raw `json_each` join, which the query builder
 * cannot express. Callers pass the aliased column (`o.status`) because the
 * aggregate queries alias `orders` as `o`.
 */
export const NON_CANCELLED_PREDICATE = (column = "status"): string =>
  `${column} <> '${ANALYTICS_CANCELLED_STATUS}'`;

/** Milliseconds in one day. The unit the date range helpers work in. */
export const MS_PER_DAY = 86_400_000;

/** Preset ranges offered by the date filter. */
export const ANALYTICS_RANGES = ["today", "last7", "last30", "thisMonth", "custom"] as const;

export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: unknown): value is AnalyticsRange {
  return typeof value === "string" && (ANALYTICS_RANGES as readonly string[]).includes(value);
}

/**
 * Longest custom window the dashboard will aggregate.
 *
 * The daily series is one bucket per day, so an unbounded range is both a
 * meaningless chart (10 000 points on a 600 px axis) and a cheap way to ask the
 * server for a full table scan. Two years comfortably covers every seasonal
 * question a shop actually asks.
 */
export const ANALYTICS_MAX_RANGE_DAYS = 730;

/**
 * A resolved, half-open instant range: `[from, to)`.
 *
 * Half-open rather than inclusive because it makes "the last 7 days ending now"
 * and "every day in a custom window" fall out of the same comparison without an
 * off-by-one at the boundary - an order placed exactly at midnight belongs to
 * the day that just started, not to both days.
 */
export type AnalyticsWindow = {
  range: AnalyticsRange;
  /** Inclusive lower bound, epoch milliseconds. */
  fromMs: number;
  /** Exclusive upper bound, epoch milliseconds. */
  toMs: number;
};

/** Start of the UTC day containing `ms`. Buckets are UTC days, matching the DB. */
export function startOfUtcDay(ms: number): number {
  return Math.floor(ms / MS_PER_DAY) * MS_PER_DAY;
}

/** UTC calendar day of an instant, as `YYYY-MM-DD`. The chart's x-axis key. */
export function utcDayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Parse `YYYY-MM-DD` into the UTC midnight epoch, rejecting anything looser.
 *
 * Deliberately not `new Date(string)`: that constructor accepts "March 3" and
 * "2024-3-1", interprets bare dates as *local* time on some engines, and turns
 * an invalid input into an Invalid Date that only fails later when it is
 * formatted. A date filter that silently shifted a range by the server's
 * timezone offset would be very hard to notice and worse to explain.
 */
export function parseUtcDayStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, y, m, d] = match;
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (!Number.isFinite(ms)) return null;
  // Reject overflow like 2024-02-31, which Date.UTC would roll forward to March.
  const parsed = new Date(ms);
  if (parsed.getUTCFullYear() !== Number(y) || parsed.getUTCMonth() !== Number(m) - 1 || parsed.getUTCDate() !== Number(d)) {
    return null;
  }
  return ms;
}

/**
 * Resolve the presets against an explicit "now".
 *
 * `now` is a parameter rather than a call to `Date.now()` inside so the boundaries
 * are reproducible: a test can pass a fixed instant and assert exact edges, and
 * the server can resolve a range once and reuse those bounds for every query in
 * the response, so a request that straddles midnight cannot mix two days.
 */
export function resolveAnalyticsWindow(
  range: AnalyticsRange,
  now: number,
  from?: string,
  to?: string,
): AnalyticsWindow {
  const todayStart = startOfUtcDay(now);
  switch (range) {
    case "today":
      return { range, fromMs: todayStart, toMs: todayStart + MS_PER_DAY };
    case "last7":
      return { range, fromMs: todayStart - 6 * MS_PER_DAY, toMs: todayStart + MS_PER_DAY };
    case "last30":
      return { range, fromMs: todayStart - 29 * MS_PER_DAY, toMs: todayStart + MS_PER_DAY };
    case "thisMonth": {
      const d = new Date(todayStart);
      const monthStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
      return { range, fromMs: monthStart, toMs: todayStart + MS_PER_DAY };
    }
    case "custom": {
      // Callers validate with `analyticsQuerySchema` first; these fallbacks keep
      // this function total so a direct call can never produce NaN bounds.
      const parsedFrom = from ? parseUtcDayStart(from) : null;
      const parsedTo = to ? parseUtcDayStart(to) : null;
      const fromMs = parsedFrom ?? todayStart - 29 * MS_PER_DAY;
      const toMs = parsedTo ?? todayStart;
      // `to` is inclusive of that whole day, hence the extra day of range.
      return { range, fromMs, toMs: toMs + MS_PER_DAY };
    }
  }
}

/** Whole days the window covers, at least 1. Drives the daily-series bucket count. */
export function analyticsWindowDayCount(window: AnalyticsWindow): number {
  return Math.max(1, Math.round((window.toMs - window.fromMs) / MS_PER_DAY));
}

/**
 * Every UTC day in the window, oldest first, as `YYYY-MM-DD`.
 *
 * The database only returns days that have orders, so without this the chart
 * would silently skip a day with no sales and compress the x-axis, making a
 * steady week look like a spike. Generating the axis here keeps a gap an honest
 * zero at its true position.
 */
export function analyticsDaySeries(window: AnalyticsWindow): string[] {
  const days: string[] = [];
  const step = MS_PER_DAY;
  for (let t = startOfUtcDay(window.fromMs); t < window.toMs; t += step) days.push(utcDayKey(t));
  return days;
}

/**
 * Round money to 2 decimals.
 *
 * Floating-point sums of prices like 0.1 are not exact, so an unguarded sum can
 * render as 239.99999999999997. Rounding at the edge keeps that arithmetic detail
 * out of the UI; the underlying sum is still the true value.
 */
export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

/** Guard for aggregate output: SQL SUM over no rows returns NULL, not 0. */
export function toFiniteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Average order value: revenue divided by non-cancelled order count.
 *
 * Returns 0 rather than a division by zero for an empty range, so a new shop with
 * no orders yet shows "0 DT" instead of NaN.
 */
export function averageOrderValue(revenue: number, orderCount: number): number {
  if (!orderCount) return 0;
  return roundMoney(revenue / orderCount);
}

// ---------------------------------------------------------------------------
// Request contract
// ---------------------------------------------------------------------------

/**
 * Query parameters accepted by every analytics endpoint.
 *
 * The same object drives all of them so switching tabs or presets never mixes
 * two different windows into one screen.
 */
export const analyticsQuerySchema = z
  .object({
    range: z.enum(ANALYTICS_RANGES).default("last30"),
    /** `YYYY-MM-DD`, required when `range` is `custom`. */
    from: z.string().optional(),
    /** `YYYY-MM-DD`, required when `range` is `custom`. */
    to: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.range !== "custom") return;
    const from = value.from ? parseUtcDayStart(value.from) : null;
    const to = value.to ? parseUtcDayStart(value.to) : null;
    if (!value.from || from === null) {
      ctx.addIssue({ code: "custom", path: ["from"], message: "from must be a YYYY-MM-DD date" });
      return;
    }
    if (!value.to || to === null) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "to must be a YYYY-MM-DD date" });
      return;
    }
    if (to < from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "to must not be before from" });
      return;
    }
    if (analyticsWindowDayCount({ range: "custom", fromMs: from, toMs: to + MS_PER_DAY }) > ANALYTICS_MAX_RANGE_DAYS) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: `range must not exceed ${ANALYTICS_MAX_RANGE_DAYS} days`,
      });
    }
  });

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

// ---------------------------------------------------------------------------
// Response contract
// ---------------------------------------------------------------------------

/** Money/total for a single non-cancelled order, plus how many units it carried. */
export const analyticsOrderSummarySchema = z.object({
  id: z.number(),
  orderNumber: z.string(),
  customerName: z.string(),
  createdAt: z.string(),
  status: z.string(),
  total: z.number(),
  itemCount: z.number().int().min(0),
});

/** One day's totals. `revenue` is the sum of `orders.total`, delivery included. */
export const analyticsDailyPointSchema = z.object({
  /** `YYYY-MM-DD` in UTC. */
  date: z.string(),
  revenue: z.number(),
  orders: z.number().int().min(0),
});

/**
 * One row of "what actually sold", aggregated from order snapshots.
 *
 * `revenue` is the sum of item line revenue at the price charged, and excludes
 * delivery fees: a fee is not attributable to one product, so charging it to the
 * top seller would inflate that row and distort the ranking.
 */
export const analyticsTopProductSchema = z.object({
  productId: z.number(),
  name: z.string(),
  imageUrl: z.string().nullable(),
  /** Total units sold across non-cancelled orders in the range. */
  unitsSold: z.number().int().min(0),
  /** Sum of line revenue. Delivery fees excluded. */
  revenue: z.number(),
  /** Distinct orders the product appeared in. */
  orderCount: z.number().int().min(0),
});

/**
 * Category rollup.
 *
 * `unknownCategory` marks lines whose product no longer exists in the catalogue.
 * The snapshot has no category field, so attribution requires joining the live
 * product; a deleted product leaves nothing to join to. Rather than dropping
 * those sales - which would make category revenue contradict total order revenue -
 * they are collected under one explicit bucket.
 */
export const analyticsCategoryRowSchema = z.object({
  category: z.string(),
  unitsSold: z.number().int().min(0),
  revenue: z.number(),
});

/** Low-stock alert row, limited to a handful. */
export const analyticsStockAlertSchema = z.object({
  productId: z.number(),
  name: z.string(),
  imageUrl: z.string(),
  category: z.string(),
  quantity: z.number().int(),
  price: z.number(),
});

/** Newest registered customer. `users` has no created_at, so ordered by id. */
export const analyticsCustomerRowSchema = z.object({
  id: z.number(),
  fullName: z.string().nullable(),
  email: z.string(),
  phone: z.string().nullable(),
  createdAt: z.string().nullable(),
});

export const analyticsSummarySchema = z.object({
  window: z.object({
    range: z.enum(ANALYTICS_RANGES),
    /**
     * Inclusive calendar bounds as `YYYY-MM-DD`, in the same format as
     * `analyticsQuery.from`/`to` and `analyticsDailyPointSchema.date`.
     *
     * Inclusive, unlike the internal `AnalyticsWindow`: that models `toMs` as
     * exclusive so the SQL can use `created_at < to`, which is a query concern and
     * would otherwise leak into the label the admin reads as "one day too wide".
     */
    from: z.string(),
    to: z.string(),
  }),
  revenue: z.number(),
  orderCount: z.number().int().min(0),
  averageOrderValue: z.number(),
  /** Current catalogue counts. Not affected by the date range. */
  totalCustomers: z.number().int().min(0),
  totalProducts: z.number().int().min(0),
  lowStockCount: z.number().int().min(0),
  outOfStockCount: z.number().int().min(0),
  /** Revenue in the current UTC day, regardless of the selected range. */
  revenueToday: z.number(),
  /** Non-cancelled order count in the current UTC day. */
  ordersToday: z.number().int().min(0),
});

export const analyticsDashboardSchema = z.object({
  summary: analyticsSummarySchema,
  daily: z.array(analyticsDailyPointSchema),
  topProducts: z.array(analyticsTopProductSchema),
  topCategories: z.array(analyticsCategoryRowSchema),
  recentOrders: z.array(analyticsOrderSummarySchema),
  recentCustomers: z.array(analyticsCustomerRowSchema),
  lowStockAlerts: z.array(analyticsStockAlertSchema),
});

export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
export type AnalyticsDailyPoint = z.infer<typeof analyticsDailyPointSchema>;
export type AnalyticsTopProduct = z.infer<typeof analyticsTopProductSchema>;
export type AnalyticsCategoryRow = z.infer<typeof analyticsCategoryRowSchema>;
export type AnalyticsStockAlert = z.infer<typeof analyticsStockAlertSchema>;
export type AnalyticsCustomerRow = z.infer<typeof analyticsCustomerRowSchema>;
export type AnalyticsOrderSummary = z.infer<typeof analyticsOrderSummarySchema>;
export type AnalyticsDashboard = z.infer<typeof analyticsDashboardSchema>;

/** Row caps. The browser never receives an unbounded list from these endpoints. */
export const ANALYTICS_LIMITS = {
  topProducts: 5,
  topCategories: 6,
  recentOrders: 8,
  recentCustomers: 5,
  lowStockAlerts: 6,
} as const;

/** Bucket for snapshot lines whose product row no longer exists. */
export const UNKNOWN_CATEGORY_LABEL = "__unknown__";

/**
 * Order number label, matching the customer-facing `#BBM-1042` format.
 *
 * Re-derived from the id rather than stored, so it cannot drift from the row it
 * names; `formatOrderNumber` in `shared/orders.ts` is the same function.
 */
export { formatOrderNumber } from "./orders.js";