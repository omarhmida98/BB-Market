/**
 * Server-side analytics aggregation.
 *
 * Everything the dashboard shows is computed here, in SQL, and returned as a
 * fixed-size payload. Nothing fetches the order table into the browser: with a
 * few thousand orders an `/api/orders`-style response would be megabytes of JSON
 * re-aggregated in JavaScript on every tab switch.
 *
 * DUAL-DIALECT NOTES
 * ------------------
 * One Drizzle shim serves two engines, and four things differ in ways that are
 * easy to get wrong:
 *
 *  1. MONEY IS TEXT. `orders.total` / `subtotal` / `delivery_fee` are `text` in
 *     both dialects. SQLite coerces silently; PostgreSQL raises
 *     `function sum(text) does not exist`. Every aggregate casts explicitly via
 *     `moneySum()` so both engines run identical logic and neither relies on
 *     implicit coercion.
 *
 *  2. TIMESTAMPS DIFFER. `orders.created_at` is `integer(... { mode:
 *     "timestamp" })` - unix SECONDS - on SQLite, and a real `timestamp` on
 *     PostgreSQL. `tsParam()` converts a bound millisecond value to whichever the
 *     column holds. Writing milliseconds to SQLite would date every order in 1970.
 *
 *  3. DAY BUCKETS. `dayExpr()` produces the same `YYYY-MM-DD` UTC key on both
 *     engines, so a chart point means the same calendar day either way.
 *
 *  4. JSON ACCESS. `items_json` is `text` holding a JSON array. `snapshotJoin()`
 *     builds the expansion for each engine - `json_each` on SQLite,
 *     `jsonb_array_elements` on PostgreSQL - and `itemElement()` yields the matching
 *     reference for one line. Both read the same snapshot keys via `->>'key'`, which
 *     SQLite also supports.
 *
 * Raw SQL is used only where the query builder cannot express the shape - the
 * table-valued JSON function, a dialect-specific date function, and a cast on an
 * aggregate. The dynamic fragments are identifiers, function names and enum
 * literals, all generated internally from closed sets, so none of them can carry
 * user input. The one place a VALUE is rendered into the statement instead of bound
 * is `tsLiteral()`, which documents why, and what it is and is not allowed to be
 * given.
 */
import { sql, and, eq, desc, count as drizzleCount } from "drizzle-orm";
import { db, orders, products, users } from "./db.js";
import { resolveDbTarget } from "./db-target.js";
import { PRODUCT_LOW_STOCK_THRESHOLD } from "shared/schema.js";
import { parseOrderItems, formatOrderNumber } from "shared/orders.js";
import {
  ANALYTICS_LIMITS,
  MS_PER_DAY,
  NON_CANCELLED_PREDICATE,
  UNKNOWN_CATEGORY_LABEL,
  analyticsDaySeries,
  averageOrderValue,
  resolveAnalyticsWindow,
  roundMoney,
  startOfUtcDay,
  toFiniteNumber,
  utcDayKey,
  type AnalyticsCategoryRow,
  type AnalyticsCustomerRow,
  type AnalyticsDailyPoint,
  type AnalyticsDashboard,
  type AnalyticsOrderSummary,
  type AnalyticsQuery,
  type AnalyticsStockAlert,
  type AnalyticsSummary,
  type AnalyticsTopProduct,
  type AnalyticsWindow,
} from "shared/analytics.js";

const dialect = resolveDbTarget().dialect;
const isPg = dialect === "postgresql";

/**
 * Cancelled-order filter for a query that aliases `orders` as `o`.
 *
 * Aliased because both the revenue aggregate and the snapshot joins are written as
 * raw SQL against `orders o`; a bare `status` would resolve, but only by accident
 * of SQLite's name resolution, and would break outright on PostgreSQL.
 */
const NON_CANCELLED = NON_CANCELLED_PREDICATE("o.status");

/** CAST an order money column before summing. See the note on money-as-TEXT. */
function moneySum(column: string): string {
  return isPg ? `SUM(CAST(${column} AS double precision))` : `SUM(CAST(${column} AS REAL))`;
}

/** Bind a millisecond instant in whatever unit the timestamp column stores. */
function tsParam(ms: number): number | Date {
  return isPg ? new Date(ms) : Math.floor(ms / 1000);
}

/** SQL producing the UTC `YYYY-MM-DD` day key for an order timestamp. */
function dayExpr(column: string): string {
  return isPg
    ? `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD')`
    : `date(${column}, 'unixepoch')`;
}

/**
 * How each snapshot line is referenced once expanded out of its array.
 *
 * PostgreSQL exposes each element directly as the alias, so `j` *is* the element;
 * SQLite nests it under `.value`, hence `itemElement()`.
 *
 * There is deliberately no helper that builds the `json_each(...)`/`jsonb_array_...
 *` source expression: the two dialects need different corrupt-row guards, so the
 * call belongs in `snapshotJoin` where both variants sit side by side.
 */
function itemElement(): string {
  return isPg ? "j" : "j.value";
}

/** Numeric cast for a JSON value, which may be a JSON number or a JSON string. */
function jsonNumber(expr: string): string {
  return `CAST(${expr} AS ${isPg ? "double precision" : "REAL"})`;
}

/** 1 when the snapshot line has a positive quantity, else 0. Guards bad data. */
function positiveQty(expr: string): string {
  return `CASE WHEN ${expr} >= 1 THEN 1 ELSE 0 END`;
}

/**
 * Run a raw SQL string and return its rows on either dialect.
 *
 * Drizzle 0.39 does not expose one uniform raw-query method across both drivers:
 * the PostgreSQL database has `execute()`, while the SQLite database only offers
 * `all()` / `get()` / `run()`. Calling `db.execute` unconditionally fails with
 * `db.execute is not a function` on SQLite - which is the local default - so this
 * branch is necessary, not stylistic.
 *
 * `db` is typed `any` in `server/db.ts` because it is one variable holding two
 * different database classes; this helper is where that gap is contained.
 *
 * SQLite's `all()` returns rows directly and PostgreSQL's `execute()` returns a
 * `QueryResult` whose rows live on `.rows`; both are normalised to an array.
 */
async function queryRaw<T = any>(text: string): Promise<T[]> {
  if (isPg) {
    const result = await db.execute(sql.raw(text));
    const rows = (result as any)?.rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  const rows = await db.all(sql.raw(text));
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Render a timestamp bound in the unit its column stores, as a SQL literal.
 *
 * This inlines values rather than using driver placeholders because the two
 * drivers disagree on how a bound value is typed: passing a JavaScript `Date` to
 * `db.all()` on better-sqlite3 binds it as a *string*, so `created_at >= ?`
 * would compare an integer column against a string and silently match nothing.
 *
 * The only callers pass `tsParam()` results - an integer second count or a `Date`
 * built from a validated numeric boundary. No user-supplied string ever reaches
 * this function, which is what keeps literal interpolation safe here.
 */
function tsLiteral(ms: number): string {
  const value = tsParam(ms);
  if (value instanceof Date) return `'${value.toISOString()}'`;
  return String(value);
}

/**
 * FROM + WHERE fragments that expand order snapshots into one row per line.
 *
 * Shared by `queryTopProducts` and `queryTopCategories` so the two cannot drift:
 * if they disagreed about which orders are included, category revenue would stop
 * reconciling with product revenue. They are returned separately because the
 * category query has to slot its own `LEFT JOIN products` between them - a JOIN
 * placed after the WHERE clause is a syntax error.
 *
 * CORRUPT ROWS
 * ------------
 * `parseOrderItems` treats an unparseable `items_json` as "no items" rather than
 * throwing, but neither JSON engine agrees: `json_each` raises `malformed JSON`
 * and `jsonb_array_elements` raises `invalid input syntax for type json`, and
 * either error aborts the whole aggregate - one bad row would take the entire
 * dashboard down.
 *
 * The guard therefore sits in the ARGUMENT to the JSON function, substituting an
 * empty array for anything that is not a JSON ARRAY. An earlier attempt filtered on
 * `json_valid(items_json)` in a WHERE clause instead, which does not work: SQLite
 * flattens the subquery into the outer query, so the filter is applied only after
 * the table-valued function has already been handed the bad value and raised.
 * Guarding the value itself is correct regardless of how the planner rearranges it.
 *
 * Two details make that guard behave, and both are specific to SQLite's JSON
 * functions:
 *
 *   - Requiring an ARRAY rather than merely valid JSON is not fussiness. A bare
 *     `{"id":1,...}` passes `json_valid`, but `json_each` then iterates the object's
 *     VALUES as scalars, and `->>'quantity'` on a scalar raises `malformed JSON` all
 *     the same.
 *   - `json_type` throws on unparseable text where `json_valid` returns 0, so the two
 *     predicates are NESTED rather than combined with `AND`. SQLite evaluates CASE
 *     lazily, which makes the inner `json_type` call unreachable for a corrupt row;
 *     `json_valid(x) AND json_type(x) = 'array'` would still run both.
 *
 * PostgreSQL needs neither guard: `jsonb_array_elements` is declared to take
 * `jsonb`, so the `CASE` around the cast rejects anything that is not a well-formed
 * array before the cast is attempted. A truncated array that does start with `[`
 * still throws there, which is what `runSnapshotAggregate` catches.
 */
function snapshotJoin(window: AnalyticsWindow): { el: string; from: string; where: string } {
  const el = itemElement();
  const where = `${NON_CANCELLED}
      AND o.created_at >= ${tsLiteral(window.fromMs)}
      AND o.created_at < ${tsLiteral(window.toMs)}
      AND ${positiveQty(jsonNumber(`${el}->>'quantity'`))} = 1`;

  if (isPg) {
    return {
      el,
      from: `FROM orders o
    LEFT JOIN LATERAL jsonb_array_elements(
      CASE WHEN o.items_json ~ '^\\s*\\[' THEN o.items_json::jsonb ELSE '[]'::jsonb END
    ) AS j ON true`,
      where,
    };
  }

  return {
    el,
    from: `FROM orders o
    LEFT JOIN json_each(
      CASE WHEN json_valid(o.items_json) = 1
        THEN CASE WHEN json_type(o.items_json) = 'array' THEN o.items_json ELSE '[]' END
        ELSE '[]' END
    ) AS j ON true`,
    where,
  };
}

/**
 * Run a snapshot aggregate, degrading to an empty list if it still fails.
 *
 * The SQL guards above cover the realistic cases. This is the backstop for the
 * residue - a row whose text starts with `[` but is truncated mid-array would
 * still throw on PostgreSQL - and it exists so that a single bad row degrades two
 * panels instead of returning 500 for the whole dashboard. The revenue, order
 * count and AOV KPIs do not read `items_json` at all, so they stay correct either
 * way; the reason is logged so the empty list is never silent.
 */
async function runSnapshotAggregate(
  label: string,
  build: (el: string) => string,
  el: string,
): Promise<any[]> {
  try {
    return await queryRaw(build(el));
  } catch (error) {
    console.error(`[ANALYTICS] ${label} aggregate failed, reporting no rows:`, error);
    return [];
  }
}

/**
 * Top products by units actually sold.
 *
 * Revenue is `quantity * price` at the price charged, excluding delivery fees: a
 * fee belongs to no single product, so attributing it would distort the ranking.
 *
 * Name and image come from the SNAPSHOT, not `products`, because a product
 * renamed or deleted after the sale must not rewrite history.
 */
async function queryTopProducts(window: AnalyticsWindow): Promise<AnalyticsTopProduct[]> {
  const { el, from, where } = snapshotJoin(window);
  const idExpr = jsonNumber(`${el}->>'id'`);
  const qtyExpr = jsonNumber(`${el}->>'quantity'`);
  const priceExpr = jsonNumber(`${el}->>'price'`);

  const rows = await runSnapshotAggregate(
    "top products",
    () => `
      SELECT
        ${idExpr} AS product_id,
        COALESCE(MAX(${el}->>'name'), '') AS name,
        MAX(${el}->>'imageUrl') AS image_url,
        SUM(${qtyExpr}) AS units_sold,
        SUM(${qtyExpr} * ${priceExpr}) AS revenue,
        COUNT(DISTINCT o.id) AS order_count
      ${from}
      WHERE ${where}
      GROUP BY ${idExpr}
      ORDER BY units_sold DESC, revenue DESC
      LIMIT ${ANALYTICS_LIMITS.topProducts}
    `,
    el,
  );

  return rows.map((r) => ({
    productId: Math.round(toFiniteNumber(r.product_id)),
    name: String(r.name ?? ""),
    imageUrl: r.image_url ? String(r.image_url) : null,
    unitsSold: Math.round(toFiniteNumber(r.units_sold)),
    revenue: roundMoney(toFiniteNumber(r.revenue)),
    orderCount: Math.round(toFiniteNumber(r.order_count)),
  }));
}

/**
 * Category rollup, built from the same snapshot expansion as `queryTopProducts`.
 *
 * Lines whose product row no longer exists land in one `__unknown__` bucket
 * instead of being dropped, which keeps category revenue reconcilable with total
 * order revenue rather than quietly losing deleted-product sales.
 */
async function queryTopCategories(window: AnalyticsWindow): Promise<AnalyticsCategoryRow[]> {
  const { el, from, where } = snapshotJoin(window);
  const idExpr = jsonNumber(`${el}->>'id'`);
  const qtyExpr = jsonNumber(`${el}->>'quantity'`);
  const priceExpr = jsonNumber(`${el}->>'price'`);
  const categoryExpr = `COALESCE(p.category, '${UNKNOWN_CATEGORY_LABEL}')`;

  const rows = await runSnapshotAggregate(
    "top categories",
    // The `products` join sits between the snapshot join and the WHERE clause:
    // it has to come after `from` (which ends in the JSON join) and before the
    // filter, because SQL requires all joins to precede the WHERE.
    () => `
      SELECT
        ${categoryExpr} AS category,
        SUM(${qtyExpr}) AS units_sold,
        SUM(${qtyExpr} * ${priceExpr}) AS revenue
      ${from}
      LEFT JOIN products p ON p.id = ${idExpr}
      WHERE ${where}
      GROUP BY ${categoryExpr}
      ORDER BY revenue DESC
      LIMIT ${ANALYTICS_LIMITS.topCategories}
    `,
    el,
  );

  return rows.map((r) => ({
    category: String(r.category ?? UNKNOWN_CATEGORY_LABEL),
    unitsSold: Math.round(toFiniteNumber(r.units_sold)),
    revenue: roundMoney(toFiniteNumber(r.revenue)),
  }));
}

/**
 * Money aggregates for the range and for the current day.
 *
 * Both use one aggregate query each rather than fetching rows to sum in JS.
 */
async function queryMoney(
  fromMs: number,
  toMs: number,
): Promise<{ revenue: number; orderCount: number }> {
  const rows = await queryRaw(`
    SELECT
      ${moneySum("o.total")} AS revenue,
      COUNT(*) AS order_count
    FROM orders o
    WHERE ${NON_CANCELLED}
      AND o.created_at >= ${tsLiteral(fromMs)}
      AND o.created_at < ${tsLiteral(toMs)}
  `);
  const row = rows[0] ?? {};
  return {
    revenue: roundMoney(toFiniteNumber(row.revenue)),
    orderCount: Math.round(toFiniteNumber(row.order_count)),
  };
}

/** Dashboard KPI card values. Catalogue counts are current, not range-scoped. */
async function querySummary(query: AnalyticsQuery, now: number): Promise<AnalyticsSummary> {
  const window = resolveAnalyticsWindow(query.range, now, query.from, query.to);
  const todayStart = startOfUtcDay(now);

  const [range, today, customers, productCount, lowStock, outOfStock] = await Promise.all([
    queryMoney(window.fromMs, window.toMs),
    // "Today" is always the current day, whatever range is selected: an admin
    // comparing months still wants to know what today did.
    queryMoney(todayStart, todayStart + MS_PER_DAY),
    db.select({ c: drizzleCount() }).from(users).where(eq(users.role, "client")),
    db.select({ c: drizzleCount() }).from(products),
    db
      .select({ c: drizzleCount() })
      .from(products)
      .where(and(sql`${products.quantity} > 0`, sql`${products.quantity} <= ${PRODUCT_LOW_STOCK_THRESHOLD}`)),
    db.select({ c: drizzleCount() }).from(products).where(sql`${products.quantity} = 0`),
  ]);

  return {
    window: {
      range: window.range,
      // Reported as inclusive `YYYY-MM-DD` day keys rather than the raw
      // fromMs/toMs instants. `AnalyticsWindow` models `toMs` as *exclusive* so the
      // SQL can use `created_at < to`, and serialising that verbatim made the panel
      // label one day too wide: `range=today` on the 30th read "30/09 - 01/10".
      // Day keys also match `daily[].date`, `analyticsQuery.from`/`to` and the
      // `<input type="date">` values the panel sends back, so one format covers the
      // whole round trip. `toMs - 1` lands inside the final day of the window.
      from: utcDayKey(window.fromMs),
      to: utcDayKey(window.toMs - 1),
    },
    revenue: range.revenue,
    orderCount: range.orderCount,
    averageOrderValue: averageOrderValue(range.revenue, range.orderCount),
    totalCustomers: Math.round(toFiniteNumber(customers[0]?.c)),
    totalProducts: Math.round(toFiniteNumber(productCount[0]?.c)),
    lowStockCount: Math.round(toFiniteNumber(lowStock[0]?.c)),
    outOfStockCount: Math.round(toFiniteNumber(outOfStock[0]?.c)),
    revenueToday: today.revenue,
    ordersToday: today.orderCount,
  };
}

/**
 * Daily revenue and order count, with days that had no orders filled as zeros.
 *
 * The GROUP BY only returns days that have rows, so `analyticsDaySeries`
 * supplies the rest. Without that, a day with no sales would be absent from the
 * axis and the chart would compress, making a steady week look like a spike.
 */
async function queryDaily(query: AnalyticsQuery, now: number): Promise<AnalyticsDailyPoint[]> {
  const window = resolveAnalyticsWindow(query.range, now, query.from, query.to);

  const rows = await queryRaw(`
    SELECT
      ${dayExpr("o.created_at")} AS day,
      ${moneySum("o.total")} AS revenue,
      COUNT(*) AS order_count
    FROM orders o
    WHERE ${NON_CANCELLED}
      AND o.created_at >= ${tsLiteral(window.fromMs)}
      AND o.created_at < ${tsLiteral(window.toMs)}
    GROUP BY ${dayExpr("o.created_at")}
    ORDER BY day ASC
  `);

  const byDay = new Map<string, { revenue: number; orders: number }>();
  for (const r of rows) {
    byDay.set(String(r.day), {
      revenue: roundMoney(toFiniteNumber(r.revenue)),
      orders: Math.round(toFiniteNumber(r.order_count)),
    });
  }
  return analyticsDaySeries(window).map((date) => ({
    date,
    revenue: byDay.get(date)?.revenue ?? 0,
    orders: byDay.get(date)?.orders ?? 0,
  }));
}

/**
 * Most recent orders across all statuses.
 *
 * A cancelled order is still shown here: the recent-activity panel is a status
 * feed, and hiding cancellations would leave an admin wondering where an order
 * went. Revenue maths excludes them; this list does not.
 */
async function queryRecentOrders(): Promise<AnalyticsOrderSummary[]> {
  const rows = await db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(ANALYTICS_LIMITS.recentOrders);

  return (rows as any[]).map((r) => {
    const items = parseOrderItems(r.itemsJson);
    return {
      id: Number(r.id),
      orderNumber: formatOrderNumber(Number(r.id)),
      customerName: r.customerName,
      createdAt: r.createdAt ? new Date(r.createdAt as any).toISOString() : new Date(0).toISOString(),
      status: r.status,
      total: roundMoney(toFiniteNumber(r.total)),
      itemCount: items.reduce((sum, i) => sum + i.quantity, 0),
    };
  });
}

/**
 * Newest customers, ordered by id.
 *
 * `users` has no `created_at` column, and ids are serial, so the highest id is
 * the most recently registered account. `createdAt` is reported as null rather
 * than invented from the id.
 */
async function queryRecentCustomers(): Promise<AnalyticsCustomerRow[]> {
  const rows = await db
    .select({ id: users.id, fullName: users.fullName, email: users.email, phone: users.phone })
    .from(users)
    .where(eq(users.role, "client"))
    .orderBy(desc(users.id))
    .limit(ANALYTICS_LIMITS.recentCustomers);

  return (rows as any[]).map((r) => ({
    id: Number(r.id),
    fullName: r.fullName ?? null,
    email: r.email,
    phone: r.phone ?? null,
    createdAt: null,
  }));
}

/** Products at or below the shared low-stock cutoff, emptiest first. */
async function queryLowStockAlerts(): Promise<AnalyticsStockAlert[]> {
  const rows = await db
    .select({
      productId: products.id,
      name: products.name,
      imageUrl: products.imageUrl,
      category: products.category,
      quantity: products.quantity,
      price: products.price,
    })
    .from(products)
    .where(and(sql`${products.quantity} > 0`, sql`${products.quantity} <= ${PRODUCT_LOW_STOCK_THRESHOLD}`))
    .orderBy(products.quantity)
    .limit(ANALYTICS_LIMITS.lowStockAlerts);

  return (rows as any[]).map((r) => ({
    productId: Math.round(toFiniteNumber(r.productId)),
    name: r.name,
    imageUrl: r.imageUrl,
    category: r.category,
    quantity: Math.round(toFiniteNumber(r.quantity)),
    price: roundMoney(toFiniteNumber(r.price)),
  }));
}

/**
 * Build the whole dashboard payload.
 *
 * `now` is injected once and threaded through every query so all panels describe
 * the same instant: without it, a request landing at 23:59:59.999 could put
 * "today" on one card and "yesterday" on another.
 *
 * The independent queries run concurrently and each is a single aggregate - no
 * query loads rows to count them, and none is issued per product or per order.
 */
export async function getAnalyticsDashboard(
  query: AnalyticsQuery,
  now: number = Date.now(),
): Promise<AnalyticsDashboard> {
  const window = resolveAnalyticsWindow(query.range, now, query.from, query.to);

  const [summary, daily, topProducts, topCategories, recentOrders, recentCustomers, lowStockAlerts] =
    await Promise.all([
      querySummary(query, now),
      queryDaily(query, now),
      queryTopProducts(window),
      queryTopCategories(window),
      queryRecentOrders(),
      queryRecentCustomers(),
      queryLowStockAlerts(),
    ]);

  return { summary, daily, topProducts, topCategories, recentOrders, recentCustomers, lowStockAlerts };
}

/**
 * Report the query plans for the two range queries.
 *
 * SQLite spells this `EXPLAIN QUERY PLAN <select>` and returns one row per plan
 * step; PostgreSQL spells it `EXPLAIN <select>` and returns one row per plan node
 * with the whole plan in `QUERY PLAN`. Both are read back as text so the
 * performance script can print them without a second dialect branch.
 *
 * The purpose is to let the index decision be made from what the engine actually
 * does, rather than from the assumption that `orders` being unindexed is slow.
 */
export async function explainAnalyticsQueries(window: AnalyticsWindow): Promise<string[]> {
  const { el, from, where } = snapshotJoin(window);
  const idExpr = jsonNumber(`${el}->>'id'`);
  const prefix = isPg ? "EXPLAIN " : "EXPLAIN QUERY PLAN ";

  const statements: [string, string][] = [
    [
      "daily",
      `SELECT ${dayExpr("o.created_at")} AS day, ${moneySum("o.total")} AS revenue, COUNT(*) AS order_count
       FROM orders o
       WHERE ${NON_CANCELLED}
         AND o.created_at >= ${tsLiteral(window.fromMs)}
         AND o.created_at < ${tsLiteral(window.toMs)}
       GROUP BY ${dayExpr("o.created_at")}`,
    ],
    [
      "topProducts",
      `SELECT ${idExpr} AS product_id, SUM(${jsonNumber(`${el}->>'quantity'`)}) AS units_sold
       ${from}
       WHERE ${where}
       GROUP BY ${idExpr}`,
    ],
    [
      "topCategories",
      `SELECT COALESCE(p.category, '${UNKNOWN_CATEGORY_LABEL}') AS category,
              SUM(${jsonNumber(`${el}->>'quantity'`)}) AS units_sold
       ${from}
       LEFT JOIN products p ON p.id = ${idExpr}
       WHERE ${where}
       GROUP BY COALESCE(p.category, '${UNKNOWN_CATEGORY_LABEL}')`,
    ],
  ];

  const plans: string[] = [];
  for (const [label, statement] of statements) {
    const rows = await queryRaw(`${prefix}${statement}`);
    const text = rows
      .map((r: any) => String(r["QUERY PLAN"] ?? r.detail ?? r.id ?? JSON.stringify(r)))
      .join(" | ");
    plans.push(`${label}: ${text}`);
  }
  return plans;
}

export const analyticsInternals = {
  moneySum,
  dayExpr,
  itemElement,
  jsonNumber,
  tsParam,
  dialect,
};