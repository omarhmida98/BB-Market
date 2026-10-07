import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { AlertTriangle, RefreshCw, ShoppingBag, TrendingUp, Users } from "lucide-react";
import {
  ANALYTICS_LIMITS,
  ANALYTICS_MAX_RANGE_DAYS,
  MS_PER_DAY,
  UNKNOWN_CATEGORY_LABEL,
  type AnalyticsDashboard,
  type AnalyticsRange,
} from "@shared/analytics";
import { BarChart, ShareBar, TrendChart, type ChartPoint } from "./AnalyticsCharts";

/**
 * Admin analytics dashboard.
 *
 * One request per selected range drives the whole page. The alternative - one
 * request per panel - would multiply the same `orders` scan by six and let the
 * panels disagree: a range that changes between two in-flight requests would show
 * a revenue total from one window next to a best-seller list from another. The
 * server resolves the window once and returns every figure against those bounds.
 *
 * The existing `/api/orders` and `/api/products` calls in AdminMarket are
 * deliberately left in place. The order table on this page needs a status control
 * and full line items, neither of which the bounded analytics payload carries, and
 * re-fetching a whole table to render six rows would defeat the point of the caps.
 */

type Range = AnalyticsRange;

const RANGE_BUTTONS: Range[] = ["today", "last7", "last30", "thisMonth"];

/** Today in UTC as `YYYY-MM-DD`, matching the server's `YYYY-MM-DD` day keys. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoKey(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * Render a `YYYY-MM-DD` calendar day in the active locale.
 *
 * `new Date("2026-09-30")` is specified as UTC midnight, so formatting it with the
 * default (local) time zone shows the previous day for anyone west of Greenwich. The
 * day is rebuilt at *local* midnight instead, which prints the same calendar date in
 * every zone - these are calendar days, not instants, and the server buckets them in
 * UTC only because that is what the SQL does.
 */
function formatDayKey(dayKey: string, locale: string): string {
  const [y, m, d] = dayKey.split("-").map(Number);
  if (!y || !m || !d) return dayKey;
  return new Date(y, m - 1, d).toLocaleDateString(locale);
}

type BuiltQuery = { url: string | null; error: "reversed" | "tooLong" | "incomplete" | null };

/**
 * Build the request URL, or the reason it cannot be built.
 *
 * The custom range is validated here as well as on the server. The server has to
 * validate regardless, but a 730-day cap that only surfaces as a 400 leaves the
 * admin staring at an error panel with no indication of which date is wrong; a
 * client-side check can put the message next to the inputs that caused it.
 *
 * Both fields are always present rather than modelled as a union: a discriminated
 * union would not narrow across the `useQuery` options object, and `url: null` is
 * the same signal anyway - it disables the request.
 */
function buildQuery(range: Range, from: string, to: string): BuiltQuery {
  if (range !== "custom") return { url: `/api/admin/analytics?range=${range}`, error: null };
  if (!from || !to) return { url: null, error: "incomplete" };
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { url: null, error: "incomplete" };
  if (end < start) return { url: null, error: "reversed" };
  // Inclusive days, so a same-day range is 1 and not 0.
  if ((end - start) / MS_PER_DAY + 1 > ANALYTICS_MAX_RANGE_DAYS) return { url: null, error: "tooLong" };
  return { url: `/api/admin/analytics?range=custom&from=${from}&to=${to}`, error: null };
}

export default function AdminAnalytics() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState<Range>("last30");
  const [from, setFrom] = useState(daysAgoKey(29));
  const [to, setTo] = useState(todayKey());

  const query = useMemo(() => buildQuery(range, from, to), [range, from, to]);

  // Keyed on the resolved URL so react-query treats a range change as new data
  // rather than a refetch of the previous range's cache entry.
  const analytics = useQuery<AnalyticsDashboard>({
    queryKey: ["/api/admin/analytics", query.url],
    queryFn: () =>
      fetch(query.url as string, { credentials: "include" }).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    enabled: query.url !== null,
    // Long enough that an admin switching tabs does not refetch, short enough that
    // a price change shows up within a session.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const locale = i18n.language.startsWith("ar") ? "ar-TN" : i18n.language.startsWith("en") ? "en-US" : "fr-TN";

  // Aggregates arrive rounded to the cent, so 2 decimals loses nothing and keeps
  // the axis labels readable. Unit prices use 3 because the catalogue stores 3.
  const money = (value: number) =>
    `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} DT`;
  const price = (value: number) =>
    `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 3 }).format(value)} DT`;
  const count = (value: number) => new Intl.NumberFormat(locale).format(value);
  const shortMoney = (value: number) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)}`;

  const data = analytics.data;
  const summary = data?.summary;

  const revenuePoints: ChartPoint[] = (data?.daily ?? []).map((d) => ({ date: d.date, value: d.revenue }));
  const orderPoints: ChartPoint[] = (data?.daily ?? []).map((d) => ({ date: d.date, value: d.orders }));

  const maxTopRevenue = Math.max(1, ...(data?.topProducts ?? []).map((p) => p.revenue));
  const maxCategoryRevenue = Math.max(1, ...(data?.topCategories ?? []).map((c) => c.revenue));

  const customError = query.error;

  return (
    <div className="space-y-6">
      {/* Range filter ------------------------------------------------- */}
      <section className="bg-white dark:bg-slate-900 border border-border rounded-3xl p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("analytics.range_custom")}>
            {RANGE_BUTTONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setRange(option)}
                aria-pressed={range === option}
                className={`px-3 py-2 rounded-xl text-sm font-bold transition ${
                  range === option ? "bg-[#ff6200] text-white" : "bg-muted hover:bg-muted/70"
                }`}
              >
                {t(`analytics.range_${option === "thisMonth" ? "thisMonth" : option}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setRange("custom")}
              aria-pressed={range === "custom"}
              className={`px-3 py-2 rounded-xl text-sm font-bold transition ${
                range === "custom" ? "bg-[#ff6200] text-white" : "bg-muted hover:bg-muted/70"
              }`}
            >
              {t("analytics.range_custom")}
            </button>
          </div>

          {range === "custom" && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("analytics.from")}
                </span>
                <input
                  type="date"
                  value={from}
                  max={to}
                  onChange={(e) => setFrom(e.target.value)}
                  className="field !w-auto"
                />
              </label>
              <label className="grid gap-1">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  {t("analytics.to")}
                </span>
                <input
                  type="date"
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                  className="field !w-auto"
                />
              </label>
            </div>
          )}

          <button
            type="button"
            onClick={() => analytics.refetch()}
            className="ms-auto flex items-center gap-2 text-sm font-bold text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className={`w-4 h-4 ${analytics.isFetching ? "animate-spin" : ""}`} />
            {t("analytics.retry")}
          </button>
        </div>

        {customError && (
          <p role="alert" className="mt-3 text-sm font-bold text-destructive">
            {customError === "reversed" && t("analytics.range_reversed")}
            {customError === "tooLong" && t("analytics.range_too_long")}
            {customError === "incomplete" && t("analytics.range_reversed")}
          </p>
        )}

        {summary && (
          <p className="mt-3 text-xs text-muted-foreground">
            {formatDayKey(summary.window.from, locale)} — {formatDayKey(summary.window.to, locale)} ·{" "}
            {t("analytics.revenue_note")}
          </p>
        )}
      </section>

      {analytics.isLoading && (
        <p role="status" className="text-sm text-muted-foreground py-10 text-center">
          {t("analytics.loading")}
        </p>
      )}

      {analytics.isError && (
        <div role="alert" className="rounded-3xl border border-destructive/40 bg-destructive/5 p-6 text-center">
          <p className="font-bold text-destructive">{t("analytics.error")}</p>
          <button type="button" onClick={() => analytics.refetch()} className="btn-primary mt-4">
            {t("analytics.retry")}
          </button>
        </div>
      )}

      {data && summary && (
        <>
          {/* KPI row ---------------------------------------------------- */}
          <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
            <Kpi
              title={t("analytics.revenue")}
              value={money(summary.revenue)}
              foot={
                <>
                  <TrendingUp className="w-3.5 h-3.5" />
                  {t("analytics.revenue_today")}: {money(summary.revenueToday)}
                </>
              }
              spark={revenuePoints}
            />
            <Kpi
              title={t("analytics.orders")}
              value={count(summary.orderCount)}
              foot={
                <>
                  <TrendingUp className="w-3.5 h-3.5" />
                  {t("analytics.orders_today")}: {count(summary.ordersToday)}
                </>
              }
              spark={orderPoints}
            />
            <Kpi
              title={t("analytics.average_order_value")}
              value={money(summary.averageOrderValue)}
              foot={<span className="opacity-80">{t("analytics.revenue_note")}</span>}
            />
            <Kpi
              title={t("analytics.total_customers")}
              value={count(summary.totalCustomers)}
              foot={
                <>
                  <Users className="w-3.5 h-3.5" />
                  {t("analytics.customers_note")}
                </>
              }
            />
            <Kpi
              title={t("analytics.total_products")}
              value={count(summary.totalProducts)}
              foot={
                <>
                  <ShoppingBag className="w-3.5 h-3.5" />
                  {t("analytics.low_stock")}: {count(summary.lowStockCount)}
                </>
              }
            />
            <Kpi
              title={t("analytics.out_of_stock")}
              value={count(summary.outOfStockCount)}
              warn={summary.outOfStockCount > 0}
              foot={
                <>
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {t("analytics.low_stock_note")}
                </>
              }
            />
          </div>

          {/* Charts ----------------------------------------------------- */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <ChartPanel
              title={t("analytics.revenue_by_day")}
              note={t("analytics.revenue_note")}
              isEmpty={revenuePoints.every((p) => p.value === 0)}
              emptyText={t("analytics.empty_range")}
            >
              <BarChart
                points={revenuePoints}
                format={shortMoney}
                ariaLabel={t("analytics.revenue_by_day")}
                emptyLabel={t("analytics.empty_chart")}
              />
            </ChartPanel>
            <ChartPanel
              title={t("analytics.orders_by_day")}
              note={t("analytics.revenue_note")}
              isEmpty={orderPoints.every((p) => p.value === 0)}
              emptyText={t("analytics.empty_range")}
            >
              <BarChart
                points={orderPoints}
                format={(v) => count(v)}
                ariaLabel={t("analytics.orders_by_day")}
                emptyLabel={t("analytics.empty_chart")}
              />
            </ChartPanel>
          </div>

          {/* Top sellers ------------------------------------------------ */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel title={t("analytics.top_products")} note={t("analytics.top_products_note")}>
              {data.topProducts.length === 0 ? (
                <Empty text={t("analytics.empty_range")} />
              ) : (
                <ul className="space-y-4">
                  {data.topProducts.map((product) => (
                    <li key={product.productId} className="grid gap-2">
                      <div className="flex items-center gap-3">
                        {product.imageUrl ? (
                          <img
                            src={product.imageUrl}
                            alt=""
                            loading="lazy"
                            className="w-10 h-10 rounded-xl object-cover border border-border shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-muted shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold truncate text-sm">{product.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {count(product.unitsSold)} {t("analytics.units_sold")} ·{" "}
                            {/* `count` is passed as a number so i18next can pick the
                                plural form; formatting it here would force one wording
                                for every quantity, which is wrong in Arabic. */}
                            {t("analytics.in_orders", { count: product.orderCount })}
                          </div>
                        </div>
                        <div className="text-end shrink-0">
                          <div className="font-black text-sm">{money(product.revenue)}</div>
                        </div>
                      </div>
                      <ShareBar value={product.revenue} max={maxTopRevenue} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title={t("analytics.top_categories")} note={t("analytics.top_products_note")}>
              {data.topCategories.length === 0 ? (
                <Empty text={t("analytics.empty_range")} />
              ) : (
                <ul className="space-y-4">
                  {data.topCategories.map((row) => {
                    const unknown = row.category === UNKNOWN_CATEGORY_LABEL;
                    return (
                      <li key={row.category} className="grid gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm truncate">
                            {unknown ? t("analytics.unknown_category") : row.category}
                          </span>
                          {unknown && <AlertTriangle className="w-3.5 h-3.5 text-orange-600 shrink-0" />}
                          <span className="ms-auto font-black text-sm shrink-0">{money(row.revenue)}</span>
                        </div>
                        <ShareBar value={row.revenue} max={maxCategoryRevenue} tone="muted" />
                        <div className="text-xs text-muted-foreground -mt-2">
                          {count(row.unitsSold)} {t("analytics.units_sold")}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
          </div>

          {/* Recent activity -------------------------------------------- */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <Panel title={t("analytics.recent_orders")} note={t("analytics.revenue_note")}>
              {data.recentOrders.length === 0 ? (
                <Empty text={t("analytics.no_recent_orders")} />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-start text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="text-start py-2 pe-3">{t("analytics.order_number")}</th>
                        <th className="text-start py-2 pe-3">{t("analytics.customer")}</th>
                        <th className="text-start py-2 pe-3">{t("analytics.date")}</th>
                        <th className="text-start py-2 pe-3">{t("analytics.status")}</th>
                        <th className="text-end py-2">{t("analytics.revenue")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentOrders.map((order) => (
                        <tr key={order.id} className="border-t border-border">
                          <td className="py-2 pe-3 font-bold whitespace-nowrap rtl:direction-ltr">
                            {order.orderNumber}
                          </td>
                          <td className="py-2 pe-3 truncate max-w-[10rem]">{order.customerName}</td>
                          <td className="py-2 pe-3 text-muted-foreground whitespace-nowrap">
                            {new Date(order.createdAt).toLocaleDateString(locale, {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </td>
                          <td className="py-2 pe-3">
                            <span className="text-xs font-bold text-muted-foreground">
                              {t(`account.status.${order.status}`, { defaultValue: order.status })}
                            </span>
                          </td>
                          <td className="py-2 text-end font-black whitespace-nowrap">{money(order.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>

            <div className="space-y-6">
              <Panel title={t("analytics.recent_customers")} note={t("analytics.customers_note")}>
                {data.recentCustomers.length === 0 ? (
                  <Empty text={t("analytics.no_recent_customers")} />
                ) : (
                  <ul className="space-y-3">
                    {data.recentCustomers.map((customer) => (
                      <li key={customer.id} className="flex items-center gap-3">
                        <div
                          className="w-9 h-9 rounded-full bg-[#063f2e] dark:bg-emerald-500 text-white grid place-items-center font-black text-sm shrink-0"
                          aria-hidden="true"
                        >
                          {(customer.fullName || customer.email).trim().charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm truncate">{customer.fullName || "—"}</div>
                          <div className="text-xs text-muted-foreground truncate rtl:direction-ltr">{customer.email}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title={t("analytics.low_stock_alerts")} note={t("analytics.low_stock_note")}>
                {data.lowStockAlerts.length === 0 ? (
                  <Empty text={t("analytics.no_low_stock")} />
                ) : (
                  <ul className="space-y-3">
                    {data.lowStockAlerts.map((row) => (
                      <li key={row.productId} className="flex items-center gap-3">
                        <img
                          src={row.imageUrl}
                          alt=""
                          loading="lazy"
                          className="w-9 h-9 rounded-xl object-cover border border-border shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-sm truncate">{row.name}</div>
                          <div className="text-xs text-muted-foreground truncate">
                            {row.category === UNKNOWN_CATEGORY_LABEL ? t("analytics.unknown_category") : row.category}
                          </div>
                        </div>
                        <div className="text-end shrink-0">
                          <div
                            className={`font-black text-sm ${row.quantity <= 0 ? "text-destructive" : "text-orange-600"}`}
                          >
                            {count(row.quantity)}
                          </div>
                          <div className="text-xs text-muted-foreground whitespace-nowrap">{price(row.price)}</div>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            </div>
          </div>

          <p className="text-xs text-muted-foreground text-center pt-2">
            {t("analytics.top_products")}: {ANALYTICS_LIMITS.topProducts} · {t("analytics.top_categories")}:{" "}
            {ANALYTICS_LIMITS.topCategories} · {t("analytics.recent_orders")}: {ANALYTICS_LIMITS.recentOrders}
          </p>
        </>
      )}
    </div>
  );
}

function Kpi({
  title,
  value,
  foot,
  warn,
  spark,
}: {
  title: string;
  value: string;
  foot?: React.ReactNode;
  warn?: boolean;
  spark?: ChartPoint[];
}) {
  const { t } = useTranslation();
  return (
    <div className="bg-white dark:bg-slate-900 border border-border rounded-3xl p-5 shadow-sm flex flex-col">
      <div className="text-xs uppercase tracking-wider font-bold text-muted-foreground">{title}</div>
      <div className={`text-2xl font-black mt-2 tabular-nums ${warn ? "text-orange-600" : ""}`}>{value}</div>
      {foot && <div className="text-xs text-muted-foreground mt-2 flex items-center gap-1">{foot}</div>}
      {spark && spark.length > 1 && (
        <div className="mt-3">
          <TrendChart
            points={spark}
            height={40}
            ariaLabel={title}
            emptyLabel={t("analytics.empty_chart")}
          />
        </div>
      )}
    </div>
  );
}

/**
 * A chart panel that swaps the chart for a message when the series is all zeros.
 *
 * A flat-zero bar chart is technically a valid chart but reads as a rendering bug,
 * which is why the "no sales in this period" message is chosen here rather than
 * leaving the axes empty. A range with no points at all is handled inside
 * `BarChart`, so both cases end up with a sentence instead of a blank box.
 */
function ChartPanel({
  title,
  note,
  isEmpty,
  emptyText,
  children,
}: {
  title: string;
  note: string;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-border rounded-3xl p-5 md:p-7 shadow-sm">
      <div className="mb-1">
        <h2 className="text-xl font-black">{title}</h2>
        <p className="text-xs text-muted-foreground">{note}</p>
      </div>
      <div className="mt-5">{isEmpty ? <Empty text={emptyText} /> : children}</div>
    </section>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-border rounded-3xl p-5 md:p-7 shadow-sm">
      <div className="mb-1">
        <h2 className="text-xl font-black">{title}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <p role="status" className="text-sm text-muted-foreground text-center py-6">
      {text}
    </p>
  );
}
