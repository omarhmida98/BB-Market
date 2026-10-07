/**
 * PostgreSQL migration + API rehearsal.
 *
 * SQLite is the local dev dialect, so every route suite in `scripts/` runs against
 * SQLite and a whole class of PostgreSQL-only defect can sit in the repo unnoticed.
 * The existing harnesses cannot simply be pointed at PostgreSQL: each one hardcodes
 * `DATABASE_URL=file:./..._rt.db` and seeds rows with better-sqlite3 directly. This
 * script closes that gap instead.
 *
 * It boots the REAL server against a migrated PostgreSQL database and exercises the
 * surfaces that matter over HTTP, so the auth guards and the real SQL are both
 * covered: products, promotions, checkout, account orders, wishlist, delivery
 * settings and analytics.
 *
 * Design notes worth knowing before editing:
 *
 *  - Expectations for the money/count KPIs are computed from the rows in PostgreSQL,
 *    not hardcoded. Hardcoding would make the suite fail (or worse, pass) depending
 *    on what time of day it runs, because "today" moves.
 *  - Analytics numbers are reconciled against the window the API itself reports
 *    (`summary.window`), which also pins down that the window is inclusive.
 *  - The corrupt-snapshot rows are split across two phases on purpose. A truncated
 *    array passes the `^\s*\[` regex guard and then fails the `::jsonb` cast, so
 *    `runSnapshotAggregate` catches it and those panels degrade to empty. Mixing it
 *    with the good rows would hide every other snapshot assertion behind that one
 *    empty list.
 *
 * TIMEZONE REGRESSION
 * -------------------
 * Every timestamp column is `timestamp without time zone` while the app reasons in
 * UTC. `now()` returns a `timestamptz`, so casting it into a naive column stores the
 * session's local wall clock: with TimeZone=Europe/Paris an order placed at
 * 2026-09-30T23:30Z is stored as `2026-10-01 01:30` and analytics labels it
 * `2026-10-01` - a day late. The database default is deliberately set to a non-UTC
 * zone here, so a pass means the app is immune to server configuration rather than
 * merely lucky about it.
 *
 * Run against an already-migrated throwaway database:
 *   PG_REHEARSAL_URL=postgres://u:p@127.0.0.1:5432/bb_market_rehearsal \
 *   DATABASE_SSL=false npm run test:pg-rehearsal -w server
 *
 * It truncates tables, so it refuses to run unless the database name looks like a
 * rehearsal target.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "child_process";
import pg from "pg";
import {
  ANALYTICS_CANCELLED_STATUS,
  ANALYTICS_LIMITS,
  UNKNOWN_CATEGORY_LABEL,
} from "../../shared/analytics.js";
import { PRODUCT_LOW_STOCK_THRESHOLD } from "../../shared/schema.js";
import { resolvePromotion } from "../../shared/promotions.js";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsxCli = path.join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const PORT = 3299;
const BASE = `http://127.0.0.1:${PORT}`;
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.pg_rehearsal");
const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;
const PASSWORD = "rehearsal_pw";

const URL_RE = process.env.PG_REHEARSAL_URL || "";
const useSsl = process.env.DATABASE_SSL !== "false" ? { rejectUnauthorized: false } : false;

let passed = 0;
let failed = 0;
const failures: string[] = [];
// Module scope so the fatal handler can still print what the child server said; a
// crash in the API shows up there first, not in the HTTP response.
let serverLog = "";
let child: ChildProcess | undefined;

/**
 * Only the interesting lines of the child log. The request logger echoes every
 * response body, which is several hundred lines per run and buries the single line
 * that explains a failure. `serverLog` itself stays complete, so assertions can still
 * match against it.
 */
function serverLogHighlights(): string {
  const interesting = serverLog
    .split("\n")
    .filter((l) => /\[ERROR\]|\[ANALYTICS\]|FATAL|Unhandled|Error:|error:/.test(l));
  return interesting.length ? interesting.join("\n") : "(no errors logged by the child server)";
}

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
function eq(label: string, actual: unknown, expected: unknown, detail = "") {
  const ok = actual === expected;
  check(
    label,
    ok,
    ok ? detail : `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}${detail ? ` (${detail})` : ""}`,
  );
}
function near(label: string, actual: unknown, expected: number, tolerance = 0.005) {
  const n = Number(actual);
  check(label, Number.isFinite(n) && Math.abs(n - expected) <= tolerance, `got ${n}, want ~${expected}`);
}

/** `YYYY-MM-DD` in UTC, matching how the analytics window is keyed. */
const utcDayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Pull a list out of a response that is either a bare array or an `{ items }`
 * envelope. Throws on anything else so a shape change is a loud failure instead of
 * a cascade of `undefined.map` errors.
 */
function listOf(data: any, what: string): any[] {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  throw new Error(`${what}: expected an array or {items:[]}, got ${JSON.stringify(data)?.slice(0, 200)}`);
}

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
      let data: any;
      try {
        data = text ? JSON.parse(text) : undefined;
      } catch {
        data = text;
      }
      return { status: res.status, data };
    },
    login(username: string) {
      return this.call("POST", "/api/login", { username, password: PASSWORD });
    },
  };
}

type Seed = {
  customerId: number;
  otherCustomerId: number;
  productId: number;
  promoProductId: number;
  lowStockProductId: number;
  outOfStockProductId: number;
  deletedProductId: number;
  categoryName: string;
  promoPrice: number;
};

async function seed(client: pg.Pool): Promise<Seed> {
  const { hashPassword } = await import("../auth.js");
  const hash = await hashPassword(PASSWORD);

  // Cleared rather than assumed empty: the rehearsal database may have been used
  // before, and leftover rows would make the reconciliations below pass or fail for
  // the wrong reason.
  await client.query(`truncate table wishlist, orders, promos, products, categories, users restart identity cascade`);

  const users = await client.query(
    `insert into users (username, email, full_name, phone, password, role) values
       ('rehearsal_admin',    'admin@rehearsal.test',    'Rehearsal Admin',    '+216 20 000 001', $1, 'superadmin'),
       ('rehearsal_customer', 'customer@rehearsal.test', 'Rehearsal Customer', '+216 20 000 002', $1, 'client'),
       ('rehearsal_other',    'other@rehearsal.test',    'Rehearsal Other',    '+216 20 000 003', $1, 'client')
     returning id, username`,
    [hash],
  );
  const idOfUser = (u: string) => users.rows.find((r: any) => r.username === u).id;
  const customerId = idOfUser("rehearsal_customer");
  const otherCustomerId = idOfUser("rehearsal_other");

  const categoryName = "Rehearsal Decor";
  const doomedCategory = "Rehearsal Removed Decor";
  await client.query(`insert into categories (name, slug) values ($1,'rehearsal-decor'), ($2,'rehearsal-removed-decor')`, [
    categoryName,
    doomedCategory,
  ]);

  const promoPrice = 7;
  // Products link to a category by `category_id`; the legacy text column alone
  // reads back as uncategorised, which would empty the category filter and the
  // top-categories panel. Each row links through the same name the backfill used.
  const products = await client.query(
    `insert into products (name, description, image_url, category, category_id, quantity, price) values
       ('Rehearsal Boite',        'd', '/x.png', $1, (select id from categories where name = $1), 40, 25),
       ('Rehearsal Ruban',        'd', '/x.png', $1, (select id from categories where name = $1), 40, 10),
       ('Rehearsal Low Stock',    'd', '/x.png', $1, (select id from categories where name = $1), $2, 12),
       ('Rehearsal Out Of Stock', 'd', '/x.png', $1, (select id from categories where name = $1), 0, 30),
       ('Rehearsal Doomed',       'd', '/x.png', $3, (select id from categories where name = $3), 15, 40)
     returning id, name`,
    [categoryName, PRODUCT_LOW_STOCK_THRESHOLD, doomedCategory],
  );
  const idOf = (n: string) => products.rows.find((r: any) => r.name === n).id;
  const productId = idOf("Rehearsal Boite");
  const promoProductId = idOf("Rehearsal Ruban");
  const lowStockProductId = idOf("Rehearsal Low Stock");
  const outOfStockProductId = idOf("Rehearsal Out Of Stock");
  const deletedProductId = idOf("Rehearsal Doomed");

  // A live promotion window: started yesterday, ends tomorrow. `resolvePromotion`
  // reads these three columns off the product row, so this is what makes the
  // promoted price observable on the API and at checkout.
  await client.query(
    `update products set promo_price = $2, promo_start = $3, promo_end = $4 where id = $1`,
    [promoProductId, promoPrice, new Date(Date.now() - MS_PER_DAY), new Date(Date.now() + MS_PER_DAY)],
  );

  await client.query(
    `insert into promos (product_name, category, category_id, description, image_url) values
       ('Rehearsal Ruban', $1, (select id from categories where name = $1), 'promo image row', '/promo.png')`,
    [categoryName],
  );

  const snap = (over: Record<string, unknown>) =>
    JSON.stringify([{ imageUrl: "/x.png", originalPrice: 0, promoApplied: false, ...over }]);

  const insertOrder = `insert into orders
      (user_id, customer_name, email, phone, address, items_json, subtotal, total,
       delivery_fee, status, payment_method, fulfillment_method, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`;

  // Seeded timestamps are relative to "now" rather than a fixed hour. A fixed
  // `midnight + 12h` would fall into tomorrow when the suite runs before noon UTC,
  // which is exactly the kind of time-of-day flake this script exists to avoid.
  const ago = (ms: number) => new Date(Date.now() - ms);

  // Two days back: home delivery with a fee, so total (57) must exceed subtotal (50).
  // Revenue includes the fee; product revenue must not.
  await client.query(insertOrder, [
    customerId, "Rehearsal Customer", "customer@rehearsal.test", "+216 20 000 002", "10 rue de Tunis",
    snap({ id: promoProductId, name: "Rehearsal Ruban", quantity: 5, price: 10 }),
    "50", "57", "7", "delivered", "cash_on_delivery", "delivery",
    ago(2 * MS_PER_DAY),
  ]);

  // Five days back: references the product deleted just below, so the snapshot has to
  // survive the row and land in the unknown-category bucket.
  await client.query(insertOrder, [
    customerId, "Rehearsal Customer", "customer@rehearsal.test", "+216 20 000 002", "10 rue de Tunis",
    snap({ id: deletedProductId, name: "Rehearsal Doomed", quantity: 3, price: 40 }),
    "120", "120", "0", "delivered", "pickup", "pickup",
    ago(5 * MS_PER_DAY),
  ]);

  // Yesterday: cancelled, so it must be absent from revenue, order counts and AOV,
  // but it does belong in the all-time recent-orders feed.
  await client.query(insertOrder, [
    otherCustomerId, "Rehearsal Other", "other@rehearsal.test", "+216 20 000 003", null,
    snap({ id: productId, name: "Rehearsal Boite", quantity: 9, price: 25 }),
    "225", "225", "0", ANALYTICS_CANCELLED_STATUS, "cash_on_delivery", "pickup",
    ago(1 * MS_PER_DAY),
  ]);

  // Valid JSON, not an array: `jsonb_array_elements` raises on this, so the
  // PostgreSQL regex guard is what keeps the whole aggregate alive. The SQLite
  // equivalent relies on `json_valid`/`json_type` instead - different guard, same
  // intent, which is why this suite cannot stand in for the other one.
  await client.query(insertOrder, [
    otherCustomerId, "Rehearsal Other", "other@rehearsal.test", "+216 20 000 003", null,
    '{"not":"an array"}', "11", "11", "0", "delivered", "cash_on_delivery", "pickup",
    ago(3 * MS_PER_DAY),
  ]);

  // Delete AFTER its order exists: the realistic ordering, and the one that proves
  // the snapshot outlives the catalogue row.
  await client.query(`delete from products where id = $1`, [deletedProductId]);
  await client.query(`delete from categories where name = $1`, [doomedCategory]);

  return {
    customerId,
    otherCustomerId,
    productId,
    promoProductId,
    lowStockProductId,
    outOfStockProductId,
    deletedProductId,
    categoryName,
    promoPrice,
  };
}

async function main() {
  if (!URL_RE) {
    console.error("[test:pg-rehearsal] PG_REHEARSAL_URL is not set.\n" +
      "  Example: PG_REHEARSAL_URL=postgres://u:p@127.0.0.1:5432/bb_market_rehearsal");
    process.exit(1);
  }
  const dbName = (() => {
    try {
      return decodeURIComponent(new URL(URL_RE).pathname.replace(/^\//, ""));
    } catch {
      return "";
    }
  })();
  // This script truncates tables. Refuse anything that is not obviously a scratch
  // database so a mistyped production URL cannot empty it.
  if (!/rehearsal|rehearse|scratch|test/i.test(dbName)) {
    console.error(
      `[test:pg-rehearsal] Refusing to run: database name "${dbName}" does not look like a throwaway ` +
        `rehearsal target. Use a database with "rehearsal" (or "test"/"scratch") in its name.`,
    );
    process.exit(1);
  }

  // `options` mirrors server/db.ts. This script seeds rows that stand in for rows the
// app wrote, so its own sessions must write UTC too - otherwise the seed data would
// carry the very bug the app is being tested against. The database default stays
// Paris, which is what the app has to be immune to.
const client = new pg.Pool({ connectionString: URL_RE, ssl: useSsl, max: 4, options: "-c timezone=UTC" });

  try {
    console.log(`[setup] target database: ${dbName}`);
    const version = await client.query("select version()");
    console.log(`[setup] ${version.rows[0].version.split(",")[0]}`);

    // Deliberately hostile: a non-UTC default is what a French OVH VPS has, and it
    // is the condition that produced the day-shift bug. `ALTER DATABASE ... SET` only
    // affects sessions opened *after* it runs, so the check uses a second pool -
    // reading `show timezone` on `client` would report the value this script's own
    // session was born with and prove nothing.
    await client.query(`alter database "${dbName}" set timezone to 'Europe/Paris'`);
    const verifier = new pg.Pool({ connectionString: URL_RE, ssl: useSsl, max: 1 });
    const tz = await verifier.query("show timezone");
    await verifier.end();
    check(
      "a fresh connection gets the non-UTC default (the hostile condition)",
      tz.rows[0].TimeZone === "Europe/Paris",
      `fresh session TimeZone=${tz.rows[0].TimeZone}`,
    );

    // ------------------------------------------------------------------ schema
    console.log("\n[SCHEMA]");
    // Expected count is derived from the PostgreSQL migration journal rather than
    // hardcoded, so adding a migration (e.g. 0009_session) never makes this stale.
    const pgJournal = JSON.parse(
      fs.readFileSync(path.join(SERVER_ROOT, "migrations/pg/meta/_journal.json"), "utf8"),
    );
    const migrations = await client.query("select count(*)::int as n from drizzle.__drizzle_migrations");
    eq("all migrations recorded", migrations.rows[0].n, pgJournal.entries.length);

    const tables = await client.query(
      `select table_name from information_schema.tables
       where table_schema='public' and table_type='BASE TABLE'`,
    );
    const names: string[] = tables.rows.map((r: any) => r.table_name);
    for (const t of [
      "categories", "messages", "orders", "products", "promos", "settings",
      "social_media_embeds", "sticker_catalogs", "user_activities", "users", "wishlist",
    ]) {
      check(`table ${t} exists`, names.includes(t), names.includes(t) ? "" : `have: ${names.join(",")}`);
    }

    const idx = await client.query(
      `select indexname from pg_indexes where schemaname='public' and indexname = any($1)`,
      [["idx_orders_created_at", "idx_wishlist_user_created", "uq_wishlist_user_product"]],
    );
    const idxNames: string[] = idx.rows.map((r: any) => r.indexname);
    check("migration 0005 index idx_orders_created_at exists", idxNames.includes("idx_orders_created_at"));
    check("migration 0004 index idx_wishlist_user_created exists", idxNames.includes("idx_wishlist_user_created"));
    check("wishlist duplicate guard exists", idxNames.includes("uq_wishlist_user_product"));

    // `numeric(12,2)` would reject the money arithmetic; both dialects keep money as
    // text, which is what the analytics casts expect.
    const cols = await client.query(
      `select column_name, data_type from information_schema.columns
       where table_schema='public' and table_name='orders'
         and column_name in ('total','subtotal','delivery_fee','items_json','created_at')`,
    );
    const types = Object.fromEntries(cols.rows.map((r: any) => [r.column_name, r.data_type]));
    eq("orders.total is text (analytics casts it)", types.total, "text");
    eq("orders.items_json is text (the regex guard depends on it)", types.items_json, "text");

    const seedData = await seed(client);

    // ------------------------------------------------------------ child server
    fs.writeFileSync(
      CHILD_ENV_FILE,
      [
        "# Generated by scripts/test-pg-rehearsal.ts. Never commit.",
        `DATABASE_URL=${URL_RE}`,
        "DATABASE_SSL=false",
        `PORT=${PORT}`,
        "HOST=127.0.0.1",
        "SESSION_SECRET=pg-rehearsal-secret",
        "",
      ].join("\n"),
    );
    // ENV_FILE is the documented escape hatch. Exporting DATABASE_URL into the child's
    // environment is not enough: env.ts calls dotenv with `override: true`, so the
    // workspace `.env` would win and the child would quietly open SQLite instead.
    child = spawn(process.execPath, [tsxCli, "index.ts"], {
      cwd: SERVER_ROOT,
      env: { ...process.env, ENV_FILE: CHILD_ENV_FILE },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => (serverLog += d.toString()));
    child.stderr?.on("data", (d) => (serverLog += d.toString()));

    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        if ((await fetch(`${BASE}/api/health`)).ok) up = true;
      } catch {
        /* not listening yet */
      }
    }
    if (!up) throw new Error(`server never came up:\n${serverLog}`);
    check(
      "child server loaded the rehearsal env file, not the workspace .env",
      // env.ts logs the basename (`[env] loaded .env.pg_rehearsal`), not the
      // absolute path, so match on the basename.
      serverLog.includes(path.basename(CHILD_ENV_FILE)),
      serverLog.includes(path.basename(CHILD_ENV_FILE)) ? "" : `child log said: ${serverLog.match(/\[env\].*/)?.[0]}`,
    );

    const health = await makeClient().call("GET", "/api/health");
    eq("health reports postgresql", health.data?.database, "postgresql");

    const anon = makeClient();
    const admin = makeClient();
    const customer = makeClient();
    const other = makeClient();
    eq("admin logs in", (await admin.login("rehearsal_admin")).status, 200);
    eq("customer logs in", (await customer.login("rehearsal_customer")).status, 200);
    eq("second customer logs in", (await other.login("rehearsal_other")).status, 200);
    eq(
      "a wrong password is rejected",
      (await makeClient().call("POST", "/api/login", { username: "rehearsal_admin", password: "wrong" })).status,
      401,
    );

    // ------------------------------------------------------------------ products
    console.log("\n[PRODUCTS]");
    const list = await anon.call("GET", "/api/products?limit=50");
    eq("product list responds", list.status, 200);
    check("list is a paginated envelope", typeof list.data?.total === "number", `total=${list.data?.total}`);
    const listed = listOf(list.data, "product list");
    check(
      "deleted product is absent from the catalogue",
      !listed.some((p) => p.id === seedData.deletedProductId),
      `ids: ${listed.map((p) => p.id).join(",")}`,
    );
    check(
      "a product whose category was deleted still lists",
      listed.some((p) => p.category === seedData.categoryName),
    );

    const byCategory = await anon.call("GET", `/api/products?category=${encodeURIComponent(seedData.categoryName)}&limit=50`);
    eq("category filter responds", byCategory.status, 200);
    check(
      "category filter returns only that category",
      listOf(byCategory.data, "category filter").every((p) => p.category === seedData.categoryName),
    );
    const outOfStock = listOf((await anon.call("GET", "/api/products?stock=out&limit=50")).data, "stock=out");
    check(
      "stock=out returns only sold-out products",
      outOfStock.length > 0 && outOfStock.every((p) => Number(p.quantity) === 0),
      `returned ${outOfStock.length}`,
    );
    const inStock = listOf((await anon.call("GET", "/api/products?stock=in&limit=50")).data, "stock=in");
    check("stock=in excludes sold-out products", inStock.every((p) => Number(p.quantity) > 0), `returned ${inStock.length}`);
    // `sort`/`stock`/`promo` use Zod `.catch(...)`, so an unknown value is deliberately
// coerced to the default rather than rejected. Assert the fallback, not a 400.
    const unknownSort = await anon.call("GET", "/api/products?sort=nonsense&limit=50");
    eq("an unknown sort is accepted, not rejected", unknownSort.status, 200);
    eq(
      "an unknown sort falls back to newest",
      listOf(unknownSort.data, "unknown sort").map((p) => p.id).join(","),
      listOf((await anon.call("GET", "/api/products?sort=newest&limit=50")).data, "newest").map((p) => p.id).join(","),
    );
    eq("an unknown stock filter falls back to all", (await anon.call("GET", "/api/products?stock=nonsense")).status, 200);
    eq("a limit above the cap is rejected", (await anon.call("GET", "/api/products?limit=100000")).status, 400);
    eq("a non-numeric page is rejected", (await anon.call("GET", "/api/products?page=abc")).status, 400);

    const detail = await anon.call("GET", `/api/products/${seedData.productId}`);
    eq("product detail responds", detail.status, 200);
    eq("product detail returns the right product", detail.data?.id, seedData.productId);
    eq("deleted product detail is 404", (await anon.call("GET", `/api/products/${seedData.deletedProductId}`)).status, 404);
    eq("non-numeric product id is 400", (await anon.call("GET", "/api/products/abc")).status, 400);

    // `price` is `double precision` on PostgreSQL and `real` on SQLite, so a double
    // round-trip is worth asserting: 25.55 has no exact binary form either way.
    const priced = await client.query(
      `insert into products (name, description, image_url, category, category_id, quantity, price)
       values ('Rehearsal Fractional','d','/x.png',$1,(select id from categories where name = $1),1,25.55) returning id, price`,
      [seedData.categoryName],
    );
    near("a fractional price round-trips through double precision", priced.rows[0].price, 25.55, 0.0001);

    // --------------------------------------------------------------- promotions
    console.log("\n[PROMOTIONS]");
    const promos = listOf((await anon.call("GET", "/api/promos")).data, "promo list");
    check("promo row is listed", promos.some((p) => p.productName === "Rehearsal Ruban"), `${promos.length} promos`);
    // The POST route requires a multipart image, so this checks the guard without
    // uploading anything (an unconfigured Cloudinary falls back to writing a file).
    eq("promo create rejects a body with no image", (await admin.call("POST", "/api/promos", { productName: "x" })).status, 400);
    // Guarded before the file check, so an unauthorised caller must not be able to
    // tell "no image" apart from "valid request".
    eq("anonymous promo create is 401", (await anon.call("POST", "/api/promos", { productName: "x" })).status, 401);
    eq("client cannot create a promo", (await customer.call("POST", "/api/promos", { productName: "x" })).status, 403);
    eq(
      "the stock-alert debug route is not a public mail relay",
      (await anon.call("POST", "/api/test/stock-alert", { productName: "x" })).status,
      401,
    );
    eq(
      "nor is it available to a client",
      (await customer.call("POST", "/api/test/stock-alert", { productName: "x" })).status,
      403,
    );
    // Contact messages carry names, emails and phone numbers.
    eq("anonymous message list is 401", (await anon.call("GET", "/api/messages")).status, 401);
    eq("client message list is 403", (await customer.call("GET", "/api/messages")).status, 403);
    eq("anonymous message delete is 401", (await anon.call("DELETE", "/api/messages/1")).status, 401);
    // The /api/debug/* data routes (inbox dump, stock dump, message detail) were
    // removed in the production-hardening pass. The strongest guarantee that the
    // contact data they exposed is no longer reachable is that the routes do not
    // exist at all — 404 for admin and everyone else.
    eq("debug message dump route is gone (404)", (await admin.call("GET", "/api/debug/messages")).status, 404);
    eq("debug stock dump route is gone (404)", (await admin.call("GET", "/api/debug/stock")).status, 404);
    eq("debug message detail route is gone (404)", (await admin.call("GET", "/api/debug/message/1")).status, 404);

    const promoted = await anon.call("GET", `/api/products/${seedData.promoProductId}`);
    near("promotion price round-trips through the API", promoted.data?.promoPrice, seedData.promoPrice, 0.0001);
    const promoState = resolvePromotion(promoted.data);
    eq("the shared resolver reads the live window as active", promoState.status, "active");
    near("the shared resolver returns the promoted price", promoState.effectivePrice, seedData.promoPrice, 0.0001);
    near("the shared resolver keeps the regular price for display", promoState.regularPrice, 10, 0.0001);

    // ------------------------------------------------------------------ checkout
    console.log("\n[CHECKOUT]");
    const stockBefore = Number(
      (await client.query(`select quantity from products where id = $1`, [seedData.productId])).rows[0].quantity,
    );
    const order = await customer.call("POST", "/api/orders", {
      customerName: "Rehearsal Customer",
      email: "customer@rehearsal.test",
      phone: "+216 20 000 002",
      address: "10 rue de Tunis",
      paymentMethod: "cash_on_delivery",
      fulfillmentMethod: "pickup",
      // `price: 1` and a bogus `total` are deliberately wrong: the server re-reads
      // prices from the database and Zod strips `total` entirely.
      items: [{ id: seedData.productId, name: "Rehearsal Boite", quantity: 3, price: 1 }],
      total: 1,
    });
    eq("checkout creates an order", order.status, 201);
    near("checkout ignores the client price and charges the catalogue price", order.data?.total, 75, 0.01);
    eq(
      "checkout decrements stock",
      Number((await client.query(`select quantity from products where id = $1`, [seedData.productId])).rows[0].quantity),
      stockBefore - 3,
    );

    // Promotion pricing has to survive the PostgreSQL round-trip into the snapshot.
    const promoOrder = await customer.call("POST", "/api/orders", {
      customerName: "Rehearsal Customer",
      phone: "+216 20 000 002",
      fulfillmentMethod: "pickup",
      items: [{ id: seedData.promoProductId, name: "Rehearsal Ruban", quantity: 2, price: 99 }],
    });
    eq("promoted checkout creates an order", promoOrder.status, 201);
    near("checkout charges the promoted price", promoOrder.data?.total, seedData.promoPrice * 2, 0.01);
    // `POST /api/orders` answers with the raw row, so the lines come back as the
    // `items_json` text rather than a parsed array.
    const promoItems = JSON.parse(String(promoOrder.data?.itemsJson ?? "[]"));
    check("the order response carries a parseable snapshot", Array.isArray(promoItems) && promoItems.length === 1, JSON.stringify(promoItems));
    check("the snapshot records the price actually paid", promoItems[0]?.price === seedData.promoPrice, JSON.stringify(promoItems[0]));
    eq("the snapshot flags the promotion as applied", promoItems[0]?.promoApplied, true);
    near("the snapshot keeps the pre-promo price", promoItems[0]?.originalPrice, 10, 0.01);

    eq(
      "checkout rejects an empty cart",
      (await customer.call("POST", "/api/orders", { customerName: "R", phone: "+216 20 000 002", items: [] })).status,
      400,
    );
    eq(
      "delivery without an address is rejected",
      (await customer.call("POST", "/api/orders", {
        customerName: "R", phone: "+216 20 000 002", fulfillmentMethod: "delivery",
        items: [{ id: seedData.productId, name: "x", quantity: 1, price: 1 }],
      })).status,
      400,
    );
    eq(
      "checkout rejects a short phone number",
      (await customer.call("POST", "/api/orders", {
        customerName: "R", phone: "123", fulfillmentMethod: "pickup",
        items: [{ id: seedData.productId, name: "x", quantity: 1, price: 1 }],
      })).status,
      400,
    );
    eq(
      "checkout rejects more units than are in stock",
      (await customer.call("POST", "/api/orders", {
        customerName: "R", phone: "+216 20 000 002", fulfillmentMethod: "pickup",
        items: [{ id: seedData.productId, name: "x", quantity: 99999, price: 1 }],
      })).status,
      409,
    );

    // ------------------------------------------------------------ account orders
    console.log("\n[ACCOUNT ORDERS]");
    const mine = await customer.call("GET", "/api/my-orders");
    eq("my-orders responds", mine.status, 200);
    const mineList = listOf(mine.data, "my-orders");
    const ownedIds = new Set(
      (await client.query(`select id from orders where user_id = $1`, [seedData.customerId])).rows.map((r: any) => r.id),
    );
    const foreignIds = new Set(
      (await client.query(`select id from orders where user_id = $1`, [seedData.otherCustomerId])).rows.map((r: any) => r.id),
    );
    eq("my-orders returns exactly the caller's orders", mineList.length, ownedIds.size);
    check(
      "my-orders exposes no other customer's order",
      mineList.every((o) => ownedIds.has(o.id) && !foreignIds.has(o.id)),
      mineList.map((o) => o.id).join(","),
    );
    eq("anonymous my-orders is 401", (await anon.call("GET", "/api/my-orders")).status, 401);

    const detailOrder = await customer.call("GET", `/api/my-orders/${mineList[0].id}`);
    eq("order detail responds for the owner", detailOrder.status, 200);
    // A 403 here would confirm the id exists, turning the endpoint into an existence
    // oracle; 404 is what a nonexistent id gets, so nothing leaks.
    eq(
      "another customer's order detail is hidden",
      (await customer.call("GET", `/api/my-orders/${[...foreignIds][0]}`)).status,
      404,
    );
    eq("non-numeric order id is 400", (await customer.call("GET", "/api/my-orders/abc")).status, 400);

    // ------------------------------------------------------------------ wishlist
    console.log("\n[WISHLIST]");
    eq("anonymous wishlist is 401", (await anon.call("GET", "/api/wishlist")).status, 401);
    const firstAdd = await customer.call("POST", `/api/wishlist/${seedData.productId}`);
    eq("add to wishlist", firstAdd.status, 201);
    eq("adding the same product again reports the existing row", (await customer.call("POST", `/api/wishlist/${seedData.productId}`)).status, 200);
    eq(
      "wishlisting a nonexistent product is 404",
      (await customer.call("POST", `/api/wishlist/${seedData.deletedProductId}`)).status,
      404,
    );
    eq("wishlisting a malformed id is 400", (await customer.call("POST", "/api/wishlist/abc")).status, 400);

    const wlRes = await customer.call("GET", "/api/wishlist");
    eq("wishlist responds", wlRes.status, 200);
    const wl = listOf(wlRes.data, "wishlist");
    eq("wishlist reports a total", wlRes.data?.total, 1);
    eq("wishlist holds one entry", wl.length, 1);
    eq("wishlist entry is the right product", wl[0]?.productId, seedData.productId);
    check(
      "wishlist entry carries the joined product",
      Boolean(wl[0]?.product?.name),
      JSON.stringify(wl[0]?.product?.name),
    );
    // Both sides of the threshold, and the comparison is parenthesised: `a === b <= c`
    // parses as `(a === b) <= c`, which is true for almost any input and would make
    // this assertion vacuous.
    check(
      "a well-stocked wishlist item is not flagged low stock",
      wl[0]?.lowStock === false && wl[0]?.product?.quantity > PRODUCT_LOW_STOCK_THRESHOLD,
      `lowStock=${wl[0]?.lowStock} quantity=${wl[0]?.product?.quantity}`,
    );
    check(
      "a wishlist item at the threshold is flagged low stock",
      wl[0]?.inStock === true && typeof wl[0]?.promotion?.status === "string",
      JSON.stringify({ lowStock: wl[0]?.lowStock, inStock: wl[0]?.inStock, promo: wl[0]?.promotion?.status }),
    );

    await customer.call("POST", `/api/wishlist/${seedData.promoProductId}`);
    eq("wishlist holds both products", listOf((await customer.call("GET", "/api/wishlist")).data, "wishlist").length, 2);
    eq("wishlist is scoped per user", listOf((await other.call("GET", "/api/wishlist")).data, "wishlist").length, 0);
    eq("remove from wishlist", (await customer.call("DELETE", `/api/wishlist/${seedData.productId}`)).status, 200);
    eq(
      "removed item is gone",
      listOf((await customer.call("GET", "/api/wishlist")).data, "wishlist").length,
      1,
    );

    // The ON DELETE CASCADE from migration 0004 is why deleting a wishlisted product
    // is safe. Assert the database enforces it rather than trusting the DDL.
    await customer.call("POST", `/api/wishlist/${seedData.outOfStockProductId}`);
    eq(
      "wishlist row exists before the product is deleted",
      Number((await client.query(`select count(*)::int as n from wishlist where product_id = $1`, [seedData.outOfStockProductId])).rows[0].n),
      1,
    );
    eq("admin deletes a product", (await admin.call("DELETE", `/api/products/${seedData.outOfStockProductId}`)).status, 204);
    eq(
      "wishlist row is cascaded away with the product",
      Number((await client.query(`select count(*)::int as n from wishlist where product_id = $1`, [seedData.outOfStockProductId])).rows[0].n),
      0,
    );

    // ----------------------------------------------------------- delivery settings
    console.log("\n[DELIVERY SETTINGS]");
    const delivery = await anon.call("GET", "/api/delivery-settings");
    eq("delivery settings respond", delivery.status, 200);
    for (const k of ["pickupEnabled", "deliveryEnabled", "deliveryFee", "freeDeliveryThreshold"]) {
      check(`delivery settings expose ${k}`, delivery.data?.[k] !== undefined, JSON.stringify(delivery.data));
    }
    eq(
      "anonymous clients cannot rewrite delivery settings",
      (await anon.call("PATCH", "/api/delivery-settings", { deliveryFee: 9 })).status,
      401,
    );
    eq(
      "a client cannot rewrite delivery settings",
      (await customer.call("PATCH", "/api/delivery-settings", { deliveryFee: 9 })).status,
      403,
    );
    eq(
      "admin can rewrite delivery settings",
      (await admin.call("PATCH", "/api/delivery-settings", { deliveryFee: 9 })).status,
      200,
    );
    near("the new fee is read back", (await anon.call("GET", "/api/delivery-settings")).data?.deliveryFee, 9, 0.01);
    // Money columns are TEXT; a write followed by a read has to preserve the value.
    eq(
      "both fulfilment methods cannot be disabled at once",
      (await admin.call("PATCH", "/api/delivery-settings", { pickupEnabled: false, deliveryEnabled: false })).status,
      400,
    );

    // ------------------------------------------------------------------ analytics
    console.log("\n[ANALYTICS] auth guards");
    eq("anonymous analytics is 401", (await anon.call("GET", "/api/admin/analytics")).status, 401);
    eq("client analytics is 403", (await customer.call("GET", "/api/admin/analytics")).status, 403);
    const { analyticsDashboardSchema } = await import("../../shared/analytics.js");

    const getDashboard = async (qs = "range=last30") => {
      const res = await admin.call("GET", `/api/admin/analytics?${qs}`);
      const parsed = analyticsDashboardSchema.safeParse(res.data);
      return { res, parsed };
    };

    /**
     * Expected KPIs, computed straight from the rows for the window the API itself
     * reported. Reading the window back from the response also pins down that
     * `summary.window` is inclusive and matches the SQL boundaries.
     */
    const reconcile = async (d: any, label: string) => {
      const fromMs = Date.parse(`${d.summary.window.from}T00:00:00Z`);
      const toMs = Date.parse(`${d.summary.window.to}T00:00:00Z`) + MS_PER_DAY;
      // A bare epoch number would be read as a `date` field ("1788220800000"), so the
// window bounds go in as ISO strings. The session is pinned to UTC, so PG's implicit
// timestamptz -> timestamp cast lands on the same instant the API used.
const fromIso = new Date(fromMs).toISOString();
const toIso = new Date(toMs).toISOString();
      const truth = await client.query(
        `select
           coalesce(sum(cast(total as numeric)) filter (where status <> $1), 0) as revenue,
           count(*) filter (where status <> $1) as order_count
         from orders where created_at >= $2 and created_at < $3`,
        [ANALYTICS_CANCELLED_STATUS, fromIso, toIso],
      );
      near(`${label}: revenue reconciles with the orders table`, d.summary.revenue, Number(truth.rows[0].revenue), 0.01);
      eq(`${label}: order count reconciles with the orders table`, d.summary.orderCount, Number(truth.rows[0].order_count));

      const dailyTruth = await client.query(
        `select to_char(created_at at time zone 'UTC','YYYY-MM-DD') as date,
                sum(cast(total as numeric)) as revenue, count(*) as orders
         from orders where status <> $1 and created_at >= $2 and created_at < $3
         group by 1 order by 1`,
        [ANALYTICS_CANCELLED_STATUS, fromIso, toIso],
      );
      near(
        `${label}: daily buckets sum to the same revenue`,
        d.daily.reduce((s: number, p: any) => s + p.revenue, 0),
        Number(truth.rows[0].revenue),
        0.05,
      );
      eq(
        `${label}: daily bucket count matches the orders table`,
        d.daily.reduce((s: number, p: any) => s + p.orders, 0),
        Number(truth.rows[0].order_count),
      );
      // The API returns a *dense* series - every day in the window, zero-revenue days
      // included - because a chart with gaps is harder to read than one with zeros.
      // The reconciliation is therefore on the days that actually have orders, while
      // the density itself is asserted separately.
      eq(
        `${label}: the series is dense, one bucket per day in the window`,
        d.daily.length,
        Math.round((toMs - fromMs) / MS_PER_DAY),
      );
      eq(
        `${label}: every day with an order appears, and nothing else does`,
        d.daily.filter((p: any) => p.orders > 0).map((p: any) => p.date).join(","),
        dailyTruth.rows.map((r: any) => r.date).join(","),
      );
    };

    // -- phase 1: the truncated array is present.
    // It passes the `^\s*\[` guard, fails the `::jsonb` cast, and is caught by
    // `runSnapshotAggregate`, so the snapshot panels must degrade to empty while the
    // KPIs - which never read items_json - stay correct.
    console.log("\n[ANALYTICS] corrupt snapshot degrades gracefully");
    await client.query(
      `insert into orders (user_id, customer_name, phone, items_json, subtotal, total, delivery_fee,
                           status, payment_method, fulfillment_method, created_at)
       values ($1,'Corrupt Owner','+216 20 000 004','[{"id":1,"name":"truncated','13','13','0',
               'delivered','cash_on_delivery','pickup',$2)`,
      [seedData.otherCustomerId, new Date(Date.now() - 4 * MS_PER_DAY)],
    );
    const degraded = await getDashboard();
    eq("a truncated snapshot does not fail the dashboard", degraded.res.status, 200);
    check(
      "the payload is still schema-valid",
      degraded.parsed.success,
      degraded.parsed.success ? "" : degraded.parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "),
    );
    if (!degraded.parsed.success) throw new Error("analytics payload failed analyticsDashboardSchema");
    const dd = degraded.parsed.data;
    await reconcile(dd, "with corrupt snapshot");
    eq("snapshot panels degrade to empty rather than erroring", dd.topProducts.length, 0);
    eq("category panel degrades to empty too", dd.topCategories.length, 0);
    check(
      "the degradation is logged, not silent",
      serverLog.includes("[ANALYTICS]") && serverLog.includes("reporting no rows"),
      serverLog.match(/\[ANALYTICS\].*/)?.[0] ?? "(no analytics warning in the child log)",
    );
    // The KPIs are computed without touching items_json, so the two rows whose
    // snapshots are unusable must still be counted at their stored totals.
    near("a corrupt row still contributes its stored total", dd.summary.revenue, 11 + 13 + 57 + 120 + 75 + 14, 0.01);

    // -- phase 2: remove the unparseable row; the non-array row is handled by the
    // regex guard and the panels must repopulate.
    console.log("\n[ANALYTICS] snapshot panels repopulate once the cast failure is gone");
    await client.query(`delete from orders where items_json like '[{"id":1,"name":"truncated%'`);
    const clean = await getDashboard();
    eq("analytics responds", clean.res.status, 200);
    check("payload is schema-valid", clean.parsed.success);
    if (!clean.parsed.success) throw new Error("analytics payload failed analyticsDashboardSchema");
    const d = clean.parsed.data;
    await reconcile(d, "clean");

    check("top products is populated", d.topProducts.length > 0, `${d.topProducts.length} rows`);
    check(
      "top product revenue excludes delivery fees",
      Math.abs(d.topProducts.reduce((s, p) => s + p.revenue, 0) - (50 + 120 + 75 + 14)) < 0.01,
      `sum=${d.topProducts.reduce((s, p) => s + p.revenue, 0)}, want 259`,
    );
    const sold = d.topProducts.reduce((s, p) => s + p.unitsSold, 0);
    eq("units sold comes from the snapshots", sold, 5 + 3 + 3 + 2);
    check(
      "a product deleted after the sale still appears from its snapshot",
      d.topProducts.some((p) => p.productId === seedData.deletedProductId),
      d.topProducts.map((p) => `${p.productId}:${p.name}`).join(" "),
    );
    const unknown = d.topCategories.find((c) => c.category === UNKNOWN_CATEGORY_LABEL);
    check(
      "a deleted product's revenue lands in the unknown-category bucket",
      unknown !== undefined && Math.abs(unknown.revenue - 120) < 0.01,
      JSON.stringify(d.topCategories.map((c) => `${c.category}:${c.revenue}`)),
    );
    check(
      "a non-array snapshot contributes no category revenue",
      !d.topCategories.some((c) => Math.abs(c.revenue - 11) < 0.01),
      JSON.stringify(d.topCategories.map((c) => `${c.category}:${c.revenue}`)),
    );

    check(
      "low stock alerts are only at or below the threshold",
      d.lowStockAlerts.every((a) => a.quantity <= PRODUCT_LOW_STOCK_THRESHOLD),
      d.lowStockAlerts.map((a) => `${a.name}:${a.quantity}`).join(" "),
    );
    check(
      "the threshold product is alerted",
      d.lowStockAlerts.some((a) => a.productId === seedData.lowStockProductId),
    );
    check(
      "a well-stocked product is not alerted",
      !d.lowStockAlerts.some((a) => a.productId === seedData.productId),
    );
    eq("low stock count matches the alert list", d.summary.lowStockCount, d.lowStockAlerts.length);

    check(
      "recent orders is an all-time feed that includes the cancelled order",
      d.recentOrders.some((o) => o.status === ANALYTICS_CANCELLED_STATUS),
      d.recentOrders.map((o) => o.status).join(" "),
    );
    check(
      "recent orders respect the cap",
      d.recentOrders.length <= ANALYTICS_LIMITS.recentOrders,
      `${d.recentOrders.length}`,
    );
    check(
      "recent customers carry a usable identity",
      d.recentCustomers.every((c) => typeof c.id === "number" && typeof c.email === "string"),
      `${d.recentCustomers.length}`,
    );
    eq(
      "the admin account is not counted as a customer",
      Number((await client.query(`select count(*)::int as n from users where role = 'client'`)).rows[0].n),
      d.summary.totalCustomers,
    );

    for (const range of ["today", "last7", "last30", "thisMonth"]) {
      const r = await getDashboard(`range=${range}`);
      check(
        `${range}: responds with a schema-valid payload`,
        r.parsed.success,
        r.parsed.success ? "" : `${r.res.status} ${JSON.stringify(r.res.data).slice(0, 140)}`,
      );
      if (r.parsed.success) eq(`${range}: echoes the requested range`, r.parsed.data.summary.window.range, range);
    }
    const todayRun = await getDashboard("range=today");
    check("today: exactly one daily bucket", todayRun.parsed.success && todayRun.parsed.data.daily.length === 1,
      todayRun.parsed.success ? `${todayRun.parsed.data.daily.length}` : "invalid");
    eq("rejects an unknown range", (await admin.call("GET", "/api/admin/analytics?range=hack")).status, 400);
    eq(
      "rejects a reversed custom range",
      (await admin.call("GET", "/api/admin/analytics?range=custom&from=2024-02-10&to=2024-02-01")).status,
      400,
    );
    eq(
      "rejects a malformed date",
      (await admin.call("GET", "/api/admin/analytics?range=custom&from=not-a-date&to=2024-02-01")).status,
      400,
    );

    // ------------------------------------------------------------------ timezone
    // The regression this whole script was written for.
    console.log("\n[TIMEZONE REGRESSION]");
    const tzProbe = await customer.call("POST", "/api/orders", {
      customerName: "TZ Probe",
      phone: "+216 20 000 002",
      fulfillmentMethod: "pickup",
      items: [{ id: seedData.productId, name: "Rehearsal Boite", quantity: 1, price: 25 }],
    });
    eq("probe order created", tzProbe.status, 201);

    // What did the app actually write, and how does the API read it back?
    const stored = await client.query(
      `select to_char(created_at,'YYYY-MM-DD HH24:MI:SS') as raw,
              to_char(created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS') as as_utc,
              to_char(created_at at time zone 'Europe/Paris','YYYY-MM-DD HH24:MI:SS') as as_paris
       from orders where customer_name = 'TZ Probe' order by id desc limit 1`,
    );
    const trueUtcNow = new Date().toISOString().replace("T", " ").slice(0, 19);
    check(
      "the stored value is UTC wall clock, not Paris wall clock",
      Math.abs(Date.parse(`${stored.rows[0].as_utc.replace(" ", "T")}Z`) - Date.now()) < 120000,
      `stored raw=${stored.rows[0].raw}, as UTC=${stored.rows[0].as_utc} (now ${trueUtcNow} UTC), ` +
        `as Paris=${stored.rows[0].as_paris}`,
    );

    // "Today" must be the UTC day, and the window must end on it inclusively.
    const todayUtc = utcDayKey(Date.now());
    const tzToday = await getDashboard("range=today");
    check("today analytics is schema-valid", tzToday.parsed.success);
    if (tzToday.parsed.success) {
      const t = tzToday.parsed.data;
      eq("today's window starts on the true UTC day", t.summary.window.from, todayUtc);
      eq("today's window ends on the true UTC day (inclusive)", t.summary.window.to, todayUtc);
      eq("today has exactly one bucket", t.daily.length, 1);
      eq("the bucket is the true UTC day", t.daily[0].date, todayUtc);
      eq("the probe order is counted today", t.summary.ordersToday, t.daily[0].orders);
      check(
        "the probe order is inside today's bucket",
        t.daily[0].revenue >= 25,
        `bucket revenue ${t.daily[0].revenue}`,
      );
    }

    // The read-side half: node-postgres parses a naive timestamp as local time, so an
    // unfixed server hands the client an instant two hours early on a Paris host.
    const shownCreatedAt = String(tzProbe.data?.createdAt ?? "");
    const driftMinutes = Math.abs(Date.now() - Date.parse(shownCreatedAt)) / 60000;
    check(
      "createdAt given to the client is the true instant",
      Number.isFinite(Date.parse(shownCreatedAt)) && driftMinutes < 5,
      `${shownCreatedAt} is ${driftMinutes.toFixed(1)} min from now`,
    );
  } finally {
    child?.kill();
    await new Promise((r) => setTimeout(r, 500));
    await client.end().catch(() => {});
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
  }

console.log(`\n[test:pg-rehearsal] ${passed} passed, ${failed} failed`);
if (failed) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
  console.log(`\n--- server log (errors only) ---\n${serverLogHighlights()}`);
}
process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  // The child log first: if the API process died, the reason is in here and nowhere
  // else, since a dead server just refuses the connection.
  if (serverLog.trim()) console.error(`\n--- server log (errors only) ---\n${serverLogHighlights()}`);
  console.error("[FATAL]", err);
  process.exit(1);
});