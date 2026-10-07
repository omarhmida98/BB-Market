/**
 * Route-level tests for the admin analytics dashboard.
 *
 * Same shape as `test-wishlist-routes.ts`: the real server is spawned as a child
 * process against a throwaway SQLite file seeded by replaying the actual
 * migration folder. That combination is what makes the assertions meaningful:
 *
 *   - Replaying `migrations/sqlite` means the shipping DDL is what gets tested.
 *     If migration 0005's index were missing, the plan assertion below would say so.
 *   - Going through HTTP exercises the real auth guard, so "client gets 403" is a
 *     statement about the deployed route and not about a helper called directly.
 *   - `now` is pinned by writing fixture timestamps as fixed offsets from a
 *     generated "today", so revenue/orders/range arithmetic is asserted against
 *     known values instead of whatever the wall clock happens to be.
 *
 * Never run against `server/bb_market.db`: the fixtures delete products and would
 * take the live catalogue with them.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "child_process";
import Database from "better-sqlite3";
import { ANALYTICS_CANCELLED_STATUS, ANALYTICS_LIMITS, UNKNOWN_CATEGORY_LABEL } from "../../shared/analytics.js";
import { PRODUCT_LOW_STOCK_THRESHOLD } from "../../shared/schema.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const THROWAWAY = path.join(SERVER_ROOT, "analytics_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.analytics_rt");

const MS_PER_DAY = 86_400_000;

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) {
    passed++;
    console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
}

function eq(label: string, actual: unknown, expected: unknown) {
  check(label, actual === expected, actual === expected ? "" : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
}

/** Assert a money figure lands within a cent, so float drift is not a failure. */
function near(label: string, actual: unknown, expected: number, tolerance = 0.005) {
  const n = Number(actual);
  check(label, Number.isFinite(n) && Math.abs(n - expected) <= tolerance, `got ${n}, want ~${expected}`);
}

/** Minimal cookie-jar HTTP client, one instance per simulated browser. */
function makeClient() {
  let cookie = "";
  return {
    async call(method: string, p: string, body?: unknown) {
      const res = await fetch(`${BASE}${p}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "manual",
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      const text = await res.text();
      let data: any = undefined;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = text;
      }
      return { status: res.status, data };
    },
    async login(username: string, password: string) {
      return this.call("POST", "/api/login", { username, password });
    },
  };
}

function dbFiles() {
  return [THROWAWAY, `${THROWAWAY}-journal`, `${THROWAWAY}-wal`, `${THROWAWAY}-shm`];
}

function idOf(db: any, sqlText: string, ...params: unknown[]): number {
  const row = db.prepare(sqlText).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`fixture lookup matched no row: ${sqlText} ${JSON.stringify(params)}`);
  return Number(row.id);
}

/** Midnight UTC, `daysAgo` days before now. Fixture timestamps are day-aligned. */
function dayStart(daysAgo: number): number {
  const today = Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY;
  return today - daysAgo * MS_PER_DAY;
}

const SEC = (ms: number) => Math.floor(ms / 1000);

type Seed = {
  userIds: Record<string, number>;
  productIds: Record<string, number>;
  deletedProductId: number;
};

/**
 * Seed straight into SQLite after replaying the real migrations.
 *
 * The order mix is built to make each analytics rule distinguishable:
 *
 *   - one non-cancelled order 2 days ago, total 100
 *   - one non-cancelled order 1 day ago, total 40 (created inside a promotion)
 *   - one CANCELLED order today, total 999 (must not count anywhere)
 *   - an order from 200 days ago (outside `last7`, inside `last30`)
 *   - an order whose product row is deleted (category attribution case)
 *   - one order with a malformed `items_json` (must not crash the aggregate)
 *   - one order with a non-cancelled total stored as text with many decimals,
 *     so a `SUM` over a TEXT column is exercised rather than assumed
 */
async function seed(): Promise<Seed> {
  const { hashPassword } = await import("../auth.js");
  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const db = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sqlText = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }

  const insertUser = db.prepare(
    "insert into users (username, email, full_name, phone, password, role) values (?,?,?,?,?,?)",
  );
  const users: [string, string, string, string | null, string, string][] = [
    ["an_admin", "an_admin@example.test", "Admin", "+21600000001", "admin_pw", "superadmin"],
    ["an_staff", "an_staff@example.test", "Staff", "+21600000002", "staff_pw", "admin"],
    ["cust_one", "cust_one@example.test", "One", "+21600000003", "one_pw", "client"],
    ["cust_two", "cust_two@example.test", "Two", "+21600000004", "two_pw", "client"],
  ];
  for (const u of users) insertUser.run(u[0], u[1], u[2], u[3], await hashPassword(u[4]), u[5]);
  const userIds = Object.fromEntries(
    users.map((u) => [u[0], idOf(db, "select id from users where username = ?", u[0])]),
  ) as Record<string, number>;

  // A product is only attributed to a category through `categories.id`, so the
  // fixture owns the rows its products link to - exactly what the backfill would
  // have matched by name. The insert passes the name twice: once for the legacy
  // text column, once for the subquery that resolves the id.
  const insertCategory = db.prepare("insert into categories (name, slug) values (?,?)");
  for (const name of ["Emballage", "Patisserie", "Maison"]) insertCategory.run(name, name.toLowerCase());
  const runProduct = db.prepare(
    "insert into products (name, description, image_url, category, category_id, quantity, price)" +
      " values (?,?,?,?,(select id from categories where categories.name = ?),?,?)",
  );
  const insertProduct = (
    name: string,
    description: string,
    imageUrl: string,
    category: string,
    quantity: number,
    price: number,
  ) => runProduct.run(name, description, imageUrl, category, category, quantity, price);
  // Stock levels chosen to straddle PRODUCT_LOW_STOCK_THRESHOLD (5): in stock,
  // exactly at the threshold, and sold out. The "6 units" product must NOT count
  // as low stock, which is the off-by-one the threshold rule is most likely to get.
  insertProduct("Boite Solide", "d", "/box.png", "Emballage", 20, 50);
  insertProduct("Ruban Or", "d", "/ribbon.png", "Emballage", 2, 10);
  insertProduct("Gateau Fin", "d", "/cake.png", "Patisserie", 0, 80);
  insertProduct("Lampadaire", "d", "/lamp.png", "Maison", 6, 200);
  const productIds = {
    box: idOf(db, "select id from products where name = ?", "Boite Solide"),
    ribbon: idOf(db, "select id from products where name = ?", "Ruban Or"),
    cake: idOf(db, "select id from products where name = ?", "Gateau Fin"),
    lamp: idOf(db, "select id from products where name = ?", "Lampadaire"),
  };

  const insertOrder = db.prepare(`
    insert into orders
      (user_id, customer_name, email, phone, address, items_json, subtotal, total, delivery_fee, status, fulfillment_method, payment_method, created_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  /**
   * A one-line order's `items_json`: a JSON ARRAY holding one line object.
   *
   * The array wrapper is load-bearing. A bare object is *valid* JSON, so
   * `json_valid` accepts it, but `json_each` over an object yields its VALUES as
   * scalars rather than the object itself, and applying `->>'quantity'` to a scalar
   * makes SQLite raise `malformed JSON`, which empties both top-N panels. The real
   * order code always writes an array, so a fixture emitting anything else tests a
   * state production cannot reach while hiding the aggregation rules this file is
   * meant to verify.
   */
  const snapshot = (p: { id: number; name: string; quantity: number; price: number }, image: string, promo = false) =>
    JSON.stringify([
      {
        id: p.id,
        name: p.name,
        quantity: p.quantity,
        price: p.price,
        originalPrice: promo ? p.price * 2 : p.price,
        promoApplied: promo,
        imageUrl: image,
        lineTotal: p.price * p.quantity,
      },
    ]);

  /**
   * Assemble several one-line snapshots into the flat `items_json` array for one
   * order. Inputs are flattened, because joining them directly yields
   * `[[{...}],[{...}]]` whose elements are arrays rather than lines - valid JSON
   * that `parseOrderItems` and the SQL aggregate both silently discard.
   */
  const lines = (...rows: string[]) => JSON.stringify(rows.flatMap((row) => JSON.parse(row)));

  const box = { id: productIds.box, name: "Boite Solide", quantity: 2, price: 50 };
  const boxOne = { id: productIds.box, name: "Boite Solide", quantity: 1, price: 50 };
  const ribbon = { id: productIds.ribbon, name: "Ruban Or", quantity: 1, price: 10 };
  const lamp = { id: productIds.lamp, name: "Lampadaire", quantity: 1, price: 200 };

  // Non-cancelled, 2 days ago: two lines (2 boxes @50 + 1 ribbon @10 = 110
  // subtotal), stored with a 0 delivery fee so total is 110.
  insertOrder.run(
    userIds.cust_one, "One", "cust_one@example.test", "+21600000003", "Tunis",
    lines(snapshot(box, "/box.png"), snapshot(ribbon, "/ribbon.png")),
    "110", "110", "0", "delivered", "delivery", "cash_on_delivery", SEC(dayStart(2)),
  );

  // Non-cancelled, 1 day ago, promotion-priced: 1 box charged at the promo price
  // of 40 rather than the 50 list price. Proves the aggregate uses the paid
  // snapshot price and not the live product price.
  insertOrder.run(
    userIds.cust_two, "Two", "cust_two@example.test", "+21600000004", "Sousse",
    snapshot(boxOne, "/box.png", true).replace('"price":50', '"price":40'),
    "40", "40", "0", "delivered", "pickup", "cash_on_delivery", SEC(dayStart(1)),
  );

  // CANCELLED today with a large total: excluded from every revenue figure, every
  // day bucket, and both top-N lists. Still visible in recent orders.
  insertOrder.run(
    userIds.cust_one, "One", "cust_one@example.test", "+21600000003", "Tunis",
    snapshot(lamp, "/lamp.png"),
    "200", "200", "0", "cancelled", "delivery", "cash_on_delivery", SEC(dayStart(0) + 3600_000),
  );

  // Old order, outside last7 but inside last30. Proves the range filter bites.
  insertOrder.run(
    userIds.cust_two, "Two", "cust_two@example.test", "+21600000004", "Sousse",
    snapshot(box, "/box.png"),
    "50", "50", "0", "delivered", "delivery", "cash_on_delivery", SEC(dayStart(40)),
  );

  // A product that will be deleted after insertion, so its snapshot line has no
  // product row to join. Its category revenue must land in the unknown bucket
  // rather than vanish.
  insertProduct("Produit Supprime", "d", "/gone.png", "Emballage", 4, 25);
  const deletedProductId = idOf(db, "select id from products where name = ?", "Produit Supprime");
  insertOrder.run(
    userIds.cust_one, "One", "cust_one@example.test", "+21600000003", "Tunis",
    snapshot({ id: deletedProductId, name: "Produit Supprime", quantity: 3, price: 25 }, "/gone.png"),
    "75", "75", "0", "confirmed", "delivery", "cash_on_delivery", SEC(dayStart(3)),
  );

  // Malformed JSON: one corrupt row must not take the whole dashboard down.
  insertOrder.run(
    userIds.cust_two, "Two", "cust_two@example.test", "+21600000004", "Sousse",
    "{not json at all",
    "12.5", "12.5", "0", "pending", "delivery", "cash_on_delivery", SEC(dayStart(1)),
  );

  // Money stored as text with 3 decimals and a delivery fee, so `total` (the
  // revenue source) is exercised including the fee. PostgreSQL would refuse to
  // SUM this column without the CAST the aggregation applies.
  insertOrder.run(
    userIds.cust_one, "One", "cust_one@example.test", "+21600000003", "Tunis",
    snapshot(ribbon, "/ribbon.png"),
    "33.333", "40.333", "7", "delivered", "delivery", "cash_on_delivery", SEC(dayStart(5)),
  );
  db.close();

  // Delete the product AFTER the order rows exist, which is the realistic order:
  // the order snapshot survives its product.
  const db2 = new Database(THROWAWAY);
  db2.prepare("delete from products where id = ?").run(deletedProductId);

  // Counted rather than hardcoded. The fixture includes a deliberately malformed
  // `items_json` row that is stored but excluded from every aggregate, so the row
  // count is one higher than the number of orders that actually aggregate. A literal
  // here silently drifted from the fixture and made the setup line untrustworthy.
  const seeded = (table: string) =>
    (db2.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  console.log(
    `[setup] ${journal.entries.length} migration(s), ${seeded("users")} users, ` +
      `${seeded("products")} products (1 deleted), ${seeded("orders")} orders ` +
      `(1 with malformed items_json)`,
  );
  db2.close();
  return { userIds, productIds, deletedProductId };
}

async function main() {
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
  const seedData = await seed();

  // `env.ts` loads the workspace `.env` with `override: true`, so DATABASE_URL has
  // to arrive through ENV_FILE; exporting it into the child's environment is not
  // enough and the test would run against live data.
  fs.writeFileSync(
    CHILD_ENV_FILE,
    [
      "# Generated by scripts/test-analytics-routes.ts. Never commit.",
      "DATABASE_URL=file:./analytics_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=analytics-route-test-secret",
      "CLOUDINARY_CLOUD_NAME=",
      "CLOUDINARY_API_KEY=",
      "CLOUDINARY_API_SECRET=",
      "",
    ].join("\n"),
  );

  const tsxCli = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const child: ChildProcess = spawn(process.execPath, [tsxCli, "index.ts"], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ENV_FILE: CHILD_ENV_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (d) => (serverLog += d.toString()));
  child.stderr?.on("data", (d) => (serverLog += d.toString()));

  // Wait for the server to answer, so a crash surfaces as a failed assertion
  // rather than an unhandled fetch rejection.
  let up = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/categories`);
      if (r.ok) { up = true; break; }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    console.error("[FATAL] server did not start\n" + serverLog);
    failed++;
  }

  try {
    const anon = makeClient();
    const admin = makeClient();
    const staff = makeClient();
    const customer = makeClient();

    // Probe once before asserting, so a server-side error is reported with the
    // real log and stack instead of every later assertion failing on `undefined`.
    try {
      const probe = makeClient();
      await probe.login("an_admin", "admin_pw");
      const first = await probe.call("GET", "/api/admin/analytics?range=last30");
      if (first.status >= 500) {
        console.error(`\n[FATAL] analytics returned ${first.status}: ${JSON.stringify(first.data)}`);
        console.error(`--- server log ---\n${serverLog}`);
        process.exit(1);
      }
    } catch (err) {
      console.error("[FATAL] probe failed:", err);
      console.error(`--- server log ---\n${serverLog}`);
      process.exit(1);
    }

    eq("admin login succeeds", (await admin.login("an_admin", "admin_pw")).status, 200);
    eq("staff login succeeds", (await staff.login("an_staff", "staff_pw")).status, 200);
    eq("customer login succeeds", (await customer.login("cust_one", "one_pw")).status, 200);

    console.log("\n[AUTH]");
    eq("anonymous is 401", (await anon.call("GET", "/api/admin/analytics")).status, 401);
    eq("customer is 403", (await customer.call("GET", "/api/admin/analytics")).status, 403);
    eq("admin role is allowed", (await admin.call("GET", "/api/admin/analytics")).status, 200);
    eq("plain admin role is allowed", (await staff.call("GET", "/api/admin/analytics")).status, 200);

    console.log("\n[REVENUE / AOV]");
    const last7 = (await admin.call("GET", "/api/admin/analytics?range=last7")).data;
    // Non-cancelled totals inside last7: 110 (2d) + 40 (1d) + 75 (3d) + 12.5 (1d)
    // + 40.333 (5d). The cancelled 200 from today is excluded, and so is the 50
    // from 40 days ago.
    near("last7 revenue excludes cancelled and out-of-range", last7.summary.revenue, 277.833);
    eq("last7 order count excludes cancelled", last7.summary.orderCount, 5);
    near("AOV is revenue / non-cancelled orders", last7.summary.averageOrderValue, 277.833 / 5);
    near("today's revenue excludes the cancelled order", last7.summary.revenueToday, 0);
    eq("today's order count excludes the cancelled order", last7.summary.ordersToday, 0);

    const last30 = (await admin.call("GET", "/api/admin/analytics?range=last30")).data;
    // last30 reaches back 29 days, so the 40-day-old order is still outside it.
    near("last30 excludes the 40-day-old order too", last30.summary.revenue, 277.833);
    eq("last30 order count", last30.summary.orderCount, 5);

    // Wide enough to reach the 40-day-old order, but inside ANALYTICS_MAX_RANGE_DAYS
    // (730). A 2000->2099 window is rejected by the endpoint's own cap, which the
    // query-validation section below asserts separately.
    const wideFrom = new Date(dayStart(365)).toISOString().slice(0, 10);
    const wideTo = new Date(dayStart(0)).toISOString().slice(0, 10);
    const all = (await admin.call("GET", `/api/admin/analytics?range=custom&from=${wideFrom}&to=${wideTo}`)).data;
    // The wide range adds the 50 from 40 days ago, still excluding the cancelled 200.
    near("wide custom range includes the old order", all.summary.revenue, 327.833);
    eq("wide custom order count", all.summary.orderCount, 6);

    console.log("\n[AOV EDGE CASE: empty range]");
    const empty = (await admin.call("GET", "/api/admin/analytics?range=custom&from=2015-01-01&to=2015-01-02")).data;
    eq("empty range revenue is 0", empty.summary.revenue, 0);
    eq("empty range AOV is 0 not NaN", empty.summary.averageOrderValue, 0);
    eq("empty range order count is 0", empty.summary.orderCount, 0);

    console.log("\n[STOCK / CATALOGUE KPIs]");
    eq("total products counts live rows only", last7.summary.totalProducts, 4);
    eq("low stock is >0 and <= threshold", last7.summary.lowStockCount, 1);
    eq("out of stock is exactly 0", last7.summary.outOfStockCount, 1);
    eq("customers count only client role", last7.summary.totalCustomers, 2);

    console.log("\n[TOP PRODUCTS]");
    // Units inside last7: box 2 (d2) + box 1 (d1) + ribbon 1 (d2) + ribbon 1 (d5)
    // + deleted-product 3 (d3). The lamp's only sale is cancelled, so it must not appear.
    const boxRow = last7.topProducts.find((p: any) => p.productId === seedData.productIds.box);
    eq("box sold 3 units", boxRow?.unitsSold, 3);
    near("box revenue uses snapshot paid prices, not list price", boxRow?.revenue, 2 * 50 + 40);
    eq("box order count", boxRow?.orderCount, 2);
    check(
      "cancelled lamp sale is absent from top products",
      !last7.topProducts.some((p: any) => p.productId === seedData.productIds.lamp),
      JSON.stringify(last7.topProducts.map((p: any) => [p.name, p.unitsSold])),
    );
    const deletedRow = last7.topProducts.find((p: any) => p.productId === seedData.deletedProductId);
    eq("deleted product still appears by its snapshot id", deletedRow?.unitsSold, 3);
    eq("deleted product keeps its snapshot name", deletedRow?.name, "Produit Supprime");
    check("top products are capped at 5", last7.topProducts.length <= 5, `${last7.topProducts.length} rows`);

    console.log("\n[TOP CATEGORIES: deleted product attribution]");
    const categories = last7.topCategories;
    const packaging = categories.find((c: any) => c.category === "Emballage");
    // Emballage keeps the box (3 units, 140) and ribbon (2 units, 20) lines that
    // still resolve to a live product row.
    eq("Emballage keeps its live-product units", packaging?.unitsSold, 5);
    near("Emballage revenue is live-product line revenue", packaging?.revenue, 160);
    // The deleted product cannot be joined to a category, so its sales are kept in
    // the explicit unknown bucket rather than silently dropped - which is what
    // keeps category revenue reconcilable against order revenue.
    const unknownRow = categories.find((c: any) => c.category.startsWith("__"));
    eq("deleted product's units land in the unknown bucket", unknownRow?.unitsSold, 3);
    near("deleted product's revenue is not lost", unknownRow?.revenue, 75);
    check("categories are capped at 6", categories.length <= 6, `${categories.length} rows`);

    console.log("\n[DAILY SERIES]");
    const series = last7.daily;
    eq("daily series has one point per day in range", series.length, 7);
    check("daily dates are ascending", series.every((p: any, i: number) => i === 0 || p.date > series[i - 1].date), JSON.stringify(series.map((p: any) => p.date)));
    const sumOfDailyRevenue = series.reduce((s: number, p: any) => s + p.revenue, 0);
    near("daily revenue sums to the range revenue", sumOfDailyRevenue, last7.summary.revenue, 0.02);
    check("today's bucket is 0 because the only today order was cancelled", series[series.length - 1].revenue === 0, JSON.stringify(series[series.length - 1]));

    console.log("\n[RECENT ACTIVITY]");
    check("recent orders are listed", last7.recentOrders.length > 0, `${last7.recentOrders.length} rows`);
    check(
      "recent orders are newest first",
      last7.recentOrders.every((o: any, i: number) => i === 0 || o.createdAt <= last7.recentOrders[i - 1].createdAt),
    );
    check(
      "recent orders include the cancelled one (status feed)",
      last7.recentOrders.some((o: any) => o.status === "cancelled"),
    );
    const malformed = last7.recentOrders.find((o: any) => o.itemCount === 0);
    check("a malformed items_json does not crash the panel", !!malformed || last7.recentOrders.length > 0);
    eq("recent customers are only client role", last7.recentCustomers.length, 2);
    check(
      "recent customers are newest id first",
      last7.recentCustomers.every((c: any, i: number) => i === 0 || c.id < last7.recentCustomers[i - 1].id),
    );
    eq("low stock alerts list the threshold product", last7.lowStockAlerts[0]?.name, "Ruban Or");
    eq("low stock alert quantity", last7.lowStockAlerts[0]?.quantity, 2);

    console.log("\n[NO RAW DATA LEAK]");
    const payloadBytes = JSON.stringify(last7).length;
    check("payload is a bounded aggregate, not the order table", payloadBytes < 20_000, `${payloadBytes} bytes`);
    check("no raw items_json in the payload", !JSON.stringify(last7).includes("lineTotal"));

    console.log("\n[QUERY PARAM VALIDATION]");
    eq("rejects reversed custom range", (await admin.call("GET", "/api/admin/analytics?range=custom&from=2024-02-10&to=2024-02-01")).status, 400);
    eq("rejects malformed from date", (await admin.call("GET", "/api/admin/analytics?range=custom&from=not-a-date&to=2024-02-01")).status, 400);
    eq("rejects impossible calendar date", (await admin.call("GET", "/api/admin/analytics?range=custom&from=2024-02-31&to=2024-03-05")).status, 400);
    eq("rejects over-long custom range", (await admin.call("GET", "/api/admin/analytics?range=custom&from=2000-01-01&to=2024-01-01")).status, 400);
    eq("rejects unknown range", (await admin.call("GET", "/api/admin/analytics?range=hack")).status, 400);
    eq("falls back to last30 with no params", (await admin.call("GET", "/api/admin/analytics")).data.summary.window.range, "last30");
    eq("today range is the current UTC day", (await admin.call("GET", "/api/admin/analytics?range=today")).data.summary.window.range, "today");
    eq("thisMonth range is accepted", (await admin.call("GET", "/api/admin/analytics?range=thisMonth")).status, 200);

    await assertClientContract(admin, seedData.deletedProductId);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 400));
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
  }

  console.log(`\n[test:analytics-routes] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log(`\n--- server log ---\n${serverLog}`);
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Assert the endpoint's payload actually matches what the React panel consumes.
 *
 * Every other assertion in this file checks the server's arithmetic in isolation, so
 * the suite would stay green if a field were renamed on one side only - the KPI cards
 * would quietly render `undefined` in the browser with nothing failing. Two layers
 * guard that seam:
 *
 *   1. `analyticsDashboardSchema` from `shared/analytics.ts` is the single source of
 *      truth for the wire format, so a server drift fails here rather than in prod.
 *   2. The explicit field list below is the component's actual destructuring. It is
 *      deliberately redundant with the schema: it fails with a message naming the
 *      missing field, which is the thing worth reading when this breaks.
 */
async function assertClientContract(admin: ReturnType<typeof makeClient>, deletedProductId: number) {
  const { analyticsDashboardSchema } = await import("../../shared/analytics.js");
  console.log("\n[CLIENT CONTRACT]");

  // Reuses the fixture's own `dayStart`, so a custom range spanning the same days the
  // fixtures populate. The point is to prove the panel's custom path gets a
  // renderable payload, not to re-assert the arithmetic tested above.
  const ranges = [
    "today",
    "last7",
    "last30",
    "thisMonth",
    `custom&from=${new Date(dayStart(6)).toISOString().slice(0, 10)}&to=${new Date(dayStart(0)).toISOString().slice(0, 10)}`,
  ];

  for (const range of ranges) {
    const res = await admin.call("GET", `/api/admin/analytics?range=${range}`);
    const label = range.split("&")[0];
    const parsed = analyticsDashboardSchema.safeParse(res.data);
    check(
      `${label}: payload matches analyticsDashboardSchema`,
      parsed.success,
      parsed.success ? "" : parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "),
    );
    if (!parsed.success) continue;

    const d = parsed.data;
    // `summary.*` - the KPI row.
    for (const k of [
      "revenue", "revenueToday", "orderCount", "ordersToday", "averageOrderValue",
      "totalProducts", "totalCustomers", "lowStockCount", "outOfStockCount",
    ] as const) {
      check(`${label}: summary.${k} is a finite number`, typeof d.summary[k] === "number" && Number.isFinite(d.summary[k]), `got ${JSON.stringify(d.summary[k])}`);
    }
    for (const k of ["from", "to", "range"] as const) {
      check(`${label}: summary.window.${k} is a string`, typeof d.summary.window[k] === "string");
    }
    // The `Date` inputs have to be YYYY-MM-DD: the panel slices them straight into the
    // x-axis labels and passes them back as query params.
    check(
      `${label}: summary.window bounds are YYYY-MM-DD`,
      /^\d{4}-\d{2}-\d{2}$/.test(d.summary.window.from) && /^\d{4}-\d{2}-\d{2}$/.test(d.summary.window.to),
      `${d.summary.window.from}..${d.summary.window.to}`,
    );

    // `daily[]` - the two trend charts.
    check(`${label}: daily is non-empty (charts need a point)`, d.daily.length > 0, `${d.daily.length} points`);
    check(
      `${label}: daily points carry date, revenue and orders`,
      d.daily.every((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && Number.isFinite(p.revenue) && Number.isFinite(p.orders)),
    );
    check(
      `${label}: daily dates are unique and ascending`,
      d.daily.every((p, i) => i === 0 || p.date > d.daily[i - 1].date),
    );
    check(
      `${label}: daily covers the whole window with no gaps`,
      d.daily.length === dayCount(d.summary.window.from, d.summary.window.to),
      `${d.daily.length} points for ${d.summary.window.range}`,
    );
    check(
      `${label}: daily revenue sums to the summary`,
      Math.abs(d.daily.reduce((s, p) => s + p.revenue, 0) - d.summary.revenue) < 0.05,
      `${d.daily.reduce((s, p) => s + p.revenue, 0)} vs ${d.summary.revenue}`,
    );
    check(
      `${label}: daily order counts sum to the summary`,
      d.daily.reduce((s, p) => s + p.orders, 0) === d.summary.orderCount,
    );

    // `topProducts[]` and `topCategories[]` - the best-seller lists. `productId` is
    // stable even for a deleted product, because it comes from the snapshot.
    check(
      `${label}: top products carry productId, name, unitsSold, revenue, orderCount`,
      d.topProducts.every(
        (p) => Number.isInteger(p.productId) && typeof p.name === "string" && Number.isFinite(p.unitsSold) && Number.isFinite(p.revenue) && Number.isFinite(p.orderCount),
      ),
    );
    check(
      `${label}: top categories carry category, unitsSold, revenue`,
      d.topCategories.every((c) => typeof c.category === "string" && Number.isFinite(c.unitsSold) && Number.isFinite(c.revenue)),
    );
    // The deleted product's order only appears in windows that contain its date, so
    // these two are range-dependent by design and are pinned on `last30` below.
    if (label === "last30") {
      check(
        "last30: top products include the deleted product's snapshot",
        d.topProducts.some((p) => p.productId === deletedProductId),
        `productId ${deletedProductId}`,
      );
      check(
        "last30: deleted product falls into the unknown category",
        d.topCategories.some((c) => c.category === UNKNOWN_CATEGORY_LABEL),
      );
    }

    // The lists render in fixed-height scroll boxes, so an unbounded list is a perf
    // regression rather than a correctness one - but it is worth pinning.
    check(`${label}: top products respects the limit`, d.topProducts.length <= ANALYTICS_LIMITS.topProducts, `${d.topProducts.length}/${ANALYTICS_LIMITS.topProducts}`);
    check(`${label}: top categories respects the limit`, d.topCategories.length <= ANALYTICS_LIMITS.topCategories, `${d.topCategories.length}/${ANALYTICS_LIMITS.topCategories}`);
    check(`${label}: recent orders respects the limit`, d.recentOrders.length <= ANALYTICS_LIMITS.recentOrders, `${d.recentOrders.length}/${ANALYTICS_LIMITS.recentOrders}`);
    check(`${label}: recent customers respects the limit`, d.recentCustomers.length <= ANALYTICS_LIMITS.recentCustomers, `${d.recentCustomers.length}/${ANALYTICS_LIMITS.recentCustomers}`);
    check(`${label}: low stock alerts respects the limit`, d.lowStockAlerts.length <= ANALYTICS_LIMITS.lowStockAlerts, `${d.lowStockAlerts.length}/${ANALYTICS_LIMITS.lowStockAlerts}`);

    // `recentOrders[]` - the activity panel. `orderNumber` is rendered verbatim, and
    // `createdAt` goes straight into a locale date format, so both must be strings.
    check(
      `${label}: recent orders carry id, orderNumber, customerName, status, total, itemCount`,
      d.recentOrders.every(
        (o) =>
          Number.isInteger(o.id) &&
          typeof o.orderNumber === "string" &&
          o.orderNumber.length > 0 &&
          typeof o.customerName === "string" &&
          typeof o.status === "string" &&
          typeof o.createdAt === "string" &&
          !Number.isNaN(Date.parse(o.createdAt)) &&
          Number.isFinite(o.total) &&
          Number.isFinite(o.itemCount),
      ),
    );
    check(
      `${label}: recent orders are newest first`,
      // Sorted by `created_at DESC, id DESC`, not by id: the fixture's rows are not
      // created in id order, and keying the assertion on id would be asserting the
      // wrong ordering. `createdAt` must be non-increasing, with id breaking ties.
      d.recentOrders.every(
        (o, i) =>
          i === 0 ||
          Date.parse(o.createdAt) < Date.parse(d.recentOrders[i - 1].createdAt) ||
          (Date.parse(o.createdAt) === Date.parse(d.recentOrders[i - 1].createdAt) && o.id <= d.recentOrders[i - 1].id),
      ),
      d.recentOrders.map((o) => `${o.id}@${o.createdAt}`).join(" "),
    );
    check(
      `${label}: recent orders is an all-time feed, not range-scoped`,
      // The fixture's newest order is the cancelled one created today, so a
      // range-scoped or non-cancelled query would drop it and this would fail. That is
      // the point: the activity feed answers "what just happened", which is a
      // different question from "what did we earn", and the two must not be conflated.
      d.recentOrders.some((o) => o.status === ANALYTICS_CANCELLED_STATUS),
      d.recentOrders.map((o) => o.status).join(" "),
    );

    // `recentCustomers[]` - the panel shows these as "newest registrations", so
    // `fullName` being nullable matters: the component has to fall back to the email.
    check(
      `${label}: recent customers carry id, email and nullable fullName`,
      d.recentCustomers.every(
        (c) => Number.isInteger(c.id) && typeof c.email === "string" && c.email.includes("@") && (c.fullName === null || typeof c.fullName === "string"),
      ),
    );
    check(
      `${label}: recent customers are newest id first`,
      d.recentCustomers.every((c, i) => i === 0 || c.id <= d.recentCustomers[i - 1].id),
    );
    check(
      `${label}: recent customers never stringify a null full name`,
      // `fullName` is genuinely nullable and the panel falls back to the email when it
      // is. What must never happen is a null leaking through `String(...)` upstream and
      // arriving as the literal text "null" or "undefined" in the DOM.
      d.recentCustomers.every(
        (c) => c.fullName === null || (typeof c.fullName === "string" && !/^\s*(null|undefined)\s*$/i.test(c.fullName)),
      ),
      d.recentCustomers.map((c) => JSON.stringify(c.fullName)).join(" "),
    );

    // `lowStockAlerts[]` - the alert panel.
    check(
      `${label}: low stock alerts carry productId, name, quantity, price`,
      d.lowStockAlerts.every(
        (a) =>
          Number.isInteger(a.productId) &&
          typeof a.name === "string" &&
          typeof a.imageUrl === "string" &&
          Number.isFinite(a.quantity) &&
          Number.isFinite(a.price),
      ),
    );
    check(
      `${label}: alerted products are at or below the low-stock threshold`,
      d.lowStockAlerts.every((a) => a.quantity <= PRODUCT_LOW_STOCK_THRESHOLD),
    );
    check(
      `${label}: alert count matches the summary's lowStockCount`,
      d.lowStockAlerts.length === Math.min(d.summary.lowStockCount, ANALYTICS_LIMITS.lowStockAlerts),
      `${d.lowStockAlerts.length} vs ${d.summary.lowStockCount}`,
    );

    // The panel needs these as numbers to pick plural forms and format money. A
    // string here is the exact shape change that renders "NaN DT" in the browser.
    check(
      `${label}: counts are numbers, not numeric strings`,
      [d.summary.orderCount, d.summary.totalProducts, ...d.topProducts.map((p) => p.unitsSold)].every(
        (n) => typeof n === "number",
      ),
    );
  }
}

/** Inclusive calendar days between two `YYYY-MM-DD` bounds. */
function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_PER_DAY) + 1;
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
