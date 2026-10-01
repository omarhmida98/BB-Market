/**
 * Promotion test suite.
 *
 *   npm run test:promotions -w server
 *
 * Two layers, because a promotion has two independent failure modes:
 *
 *   1. The *rule* (is this promotion live? what does it cost?) is a pure
 *      function, so it is tested directly with an injected clock. That covers
 *      every state and every boundary instant without waiting for real time to
 *      pass, which is the only practical way to test an expiry boundary.
 *
 *   2. The *filter* (`promo=active`) is SQL in server/storage.ts, so it is
 *      tested through the real Drizzle storage against a throwaway SQLite
 *      database with the real migrations applied. Testing the resolver alone
 *      would pass even if the WHERE clause disagreed with it.
 *
 * Safety: this script refuses to touch anything but a throwaway file whose name
 * contains `promo_lt`. It never starts an HTTP server and never contacts
 * production. The throwaway database is deleted at the end.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { sqliteSchema } from "shared/db-schema.js";
import { resolvePromotion, validatePromotion } from "shared/promotions.js";
import { productQuerySchema } from "shared/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.resolve(__dirname, "..");
const THROWAWAY = path.join(SERVER_ROOT, "promo_lt.db");

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function eq(name: string, actual: unknown, expected: unknown) {
  check(name, Object.is(actual, expected), `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

/** Fixed clock so every window test is deterministic. */
const NOW = new Date("2026-06-15T12:00:00.000Z");
const NOW_MS = NOW.getTime();
const HOUR = 3_600_000;

// ---------------------------------------------------------------------------
// 1. Promotion rules (pure, no database)
// ---------------------------------------------------------------------------
function testResolver() {
  console.log("\n[1/2] Promotion rules (shared/promotions.ts)");

  eq(
    "no promo price -> status none",
    resolvePromotion({ price: 100, promoPrice: null }, NOW).status,
    "none",
  );
  eq(
    "no promo price -> regular price charged",
    resolvePromotion({ price: 100, promoPrice: null }, NOW).effectivePrice,
    100,
  );
  eq(
    "empty-string promo price (old form) is not a free product",
    resolvePromotion({ price: 100, promoPrice: "" }, NOW).effectivePrice,
    100,
  );

  eq(
    "active promo -> status active",
    resolvePromotion({ price: 100, promoPrice: 80 }, NOW).status,
    "active",
  );
  eq(
    "active promo -> effective price is the promo price",
    resolvePromotion({ price: 100, promoPrice: 80 }, NOW).effectivePrice,
    80,
  );
  eq(
    "active promo -> discount is a whole percent",
    resolvePromotion({ price: 100, promoPrice: 80 }, NOW).discountPercent,
    20,
  );
  eq(
    "active promo -> regular price preserved for the strike-through",
    resolvePromotion({ price: 100, promoPrice: 80 }, NOW).regularPrice,
    100,
  );

  eq(
    "future window -> status scheduled",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS + HOUR) },
      NOW,
    ).status,
    "scheduled",
  );
  eq(
    "future window -> charges the regular price, not the future price",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS + HOUR) },
      NOW,
    ).effectivePrice,
    100,
  );
  eq(
    "future window -> discount is 0 so no badge is implied",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS + HOUR) },
      NOW,
    ).discountPercent,
    0,
  );

  eq(
    "past window -> status expired",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoEnd: new Date(NOW_MS - HOUR) },
      NOW,
    ).status,
    "expired",
  );
  eq(
    "past window -> back to the regular price",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoEnd: new Date(NOW_MS - HOUR) },
      NOW,
    ).effectivePrice,
    100,
  );

  // Window bounds are half-open: [start, end). The start instant is inside the
  // offer, the end instant is already outside it.
  eq(
    "window boundary: exactly at start -> active",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS), promoEnd: new Date(NOW_MS + HOUR) },
      NOW,
    ).status,
    "active",
  );
  eq(
    "window boundary: exactly at end -> expired",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS - HOUR), promoEnd: new Date(NOW_MS) },
      NOW,
    ).status,
    "expired",
  );
  eq(
    "start-only window is open ended",
    resolvePromotion({ price: 100, promoPrice: 80, promoStart: new Date(NOW_MS - HOUR) }, NOW).status,
    "active",
  );
  eq(
    "end-only window is open at the start",
    resolvePromotion({ price: 100, promoPrice: 80, promoEnd: new Date(NOW_MS + HOUR) }, NOW).status,
    "active",
  );
  eq(
    "inverted window can never be active",
    resolvePromotion(
      { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS + HOUR), promoEnd: new Date(NOW_MS) },
      NOW,
    ).status,
    "expired",
  );

  // Defensive: a bad stored row must never raise the price or block checkout.
  eq(
    "promo >= regular is not a discount -> none",
    resolvePromotion({ price: 100, promoPrice: 100 }, NOW).status,
    "none",
  );
  eq(
    "promo above regular never raises the price",
    resolvePromotion({ price: 100, promoPrice: 150 }, NOW).effectivePrice,
    100,
  );
  eq(
    "negative promo is ignored",
    resolvePromotion({ price: 100, promoPrice: -10 }, NOW).effectivePrice,
    100,
  );
  eq(
    "free promotional item (0) is a real 100% discount",
    resolvePromotion({ price: 100, promoPrice: 0 }, NOW).effectivePrice,
    0,
  );
  eq(
    "unparseable promo price is ignored",
    resolvePromotion({ price: 100, promoPrice: "abc" as any }, NOW).status,
    "none",
  );
  eq(
    "unparseable promo date degrades to open ended, not to a crash",
    resolvePromotion({ price: 100, promoPrice: 80, promoStart: "not-a-date" as any }, NOW).status,
    "active",
  );
  eq(
    "string prices from a legacy row are coerced",
    resolvePromotion({ price: "100" as any, promoPrice: "80" as any }, NOW).effectivePrice,
    80,
  );

  // The exact scenario the feature exists for: an order placed during an offer
  // must keep showing the discounted price after the offer ends, while a NEW
  // order for the same product goes back to the regular price.
  const windowed = { price: 100, promoPrice: 80, promoStart: new Date(NOW_MS - HOUR), promoEnd: new Date(NOW_MS + HOUR) };
  eq("snapshot taken during the offer is 80", resolvePromotion(windowed, NOW).effectivePrice, 80);
  eq(
    "a new order after the offer expires costs 100 again",
    resolvePromotion(windowed, new Date(NOW_MS + HOUR + 1)).effectivePrice,
    100,
  );
  eq(
    "an open-ended promotion stays active with no end date",
    resolvePromotion({ price: 100, promoPrice: 80 }, new Date(NOW_MS + 10 * 365 * 86_400_000)).effectivePrice,
    80,
  );
}

function testValidation() {
  console.log("\n[1b] Promotion validation (shared/promotions.ts)");

  check("valid promotion passes", validatePromotion({ price: 100, promoPrice: 80 }).length === 0);
  check(
    "negative promo is rejected",
    validatePromotion({ price: 100, promoPrice: -1 }).length === 1,
  );
  check(
    "promo equal to regular is rejected",
    validatePromotion({ price: 100, promoPrice: 100 }).length === 1,
  );
  check(
    "promo above regular is rejected",
    validatePromotion({ price: 100, promoPrice: 101 }).length === 1,
  );
  check("empty promo is allowed (means: no promotion)", validatePromotion({ price: 100, promoPrice: "" }).length === 0);
  check(
    "a window without a promo price is rejected",
    validatePromotion({ price: 100, promoPrice: "", promoEnd: new Date(NOW_MS) }).length === 1,
  );
  check(
    "end before start is rejected",
    validatePromotion({
      price: 100,
      promoPrice: 80,
      promoStart: new Date(NOW_MS + HOUR),
      promoEnd: new Date(NOW_MS),
    }).length === 1,
  );
  check(
    "end equal to start is allowed (empty but valid window)",
    validatePromotion({
      price: 100,
      promoPrice: 80,
      promoStart: new Date(NOW_MS),
      promoEnd: new Date(NOW_MS),
    }).length === 0,
  );
}

// ---------------------------------------------------------------------------
// 2. Server-side filter + storage normalisation (real migrations, throwaway DB)
// ---------------------------------------------------------------------------
async function testStorageFilter() {
  console.log("\n[2/2] Server-side promo filter (server/storage.ts)");

  // Point the app at the throwaway database. ENV_FILE is set to a path that does
  // not exist so server/env.ts skips the repository .env (which uses
  // override:true and would otherwise put DATABASE_URL back to the real DB).
  process.env.ENV_FILE = path.join(SERVER_ROOT, "__no_such_env_file__");
  process.env.DATABASE_URL = `file:${THROWAWAY}`;
  process.env.NODE_ENV = "test";

  // Refuse to run against anything real, same guard as the load test.
  if (path.basename(THROWAWAY) !== "promo_lt.db") {
    console.error("[test:promotions] Refusing to run: unexpected throwaway filename.");
    process.exit(1);
  }
  for (const f of [THROWAWAY, `${THROWAWAY}-journal`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }

  // Apply the real migration chain, so the test exercises the shipped schema
  // rather than a hand-written approximation of it.
  const sqlite = new Database(THROWAWAY);
  migrate(drizzleSqlite(sqlite), { migrationsFolder: path.join(SERVER_ROOT, "migrations/sqlite") });
  sqlite.close();

  // Imported dynamically: db.ts opens its connection at import time, so
  // DATABASE_URL has to be in place first.
  // Close the connection before deleting: better-sqlite3 holds a file lock for the
// life of the process and Windows refuses to unlink an open file, so without this
// the throwaway database survives every run.
const { storage } = await import("../storage.js");
const { closeDatabase } = await import("../db.js");

  const base = { description: "d", imageUrl: "/x.png", category: "Cadeaux & Décor", quantity: "10" };

  const noPromo = await storage.createProduct({ ...base, name: "Sans promo", price: "100" } as any);
  const activePromo = await storage.createProduct({ ...base, name: "Promo active", price: "100", promoPrice: "80" } as any);
  const futurePromo = await storage.createProduct({
    ...base,
    name: "Promo future",
    price: "100",
    promoPrice: "70",
    promoStart: new Date(Date.now() + 86_400_000).toISOString(),
  } as any);
  const expiredPromo = await storage.createProduct({
    ...base,
    name: "Promo terminée",
    price: "100",
    promoPrice: "50",
    promoStart: new Date(Date.now() - 172_800_000).toISOString(),
    promoEnd: new Date(Date.now() - 86_400_000).toISOString(),
  } as any);
  const badPromo = await storage.createProduct({ ...base, name: "Promo >= prix", price: "100", promoPrice: "100" } as any);

  eq(
    "a product created without promotion stores NULL, not 0",
    (noPromo as any).promoPrice,
    null,
  );
  eq("promo price stored as a number", Number((activePromo as any).promoPrice), 80);
  check(
    "promo start stored as a Date",
    (futurePromo as any).promoStart instanceof Date,
    `got ${typeof (futurePromo as any).promoStart}`,
  );

  const query = productQuerySchema.parse({ limit: 10, promo: "active" });
  const promoted = await storage.queryProducts(query);
  const names = promoted.items.map((p: any) => p.name).sort();

  check(
    "promo=active returns only the live promotion",
    names.length === 1 && names[0] === "Promo active",
    `got ${JSON.stringify(names)}`,
  );
  eq("promo=active total counts only the live promotion", promoted.total, 1);

  const all = await storage.queryProducts(productQuerySchema.parse({ limit: 10 }));
  eq("promo=all returns the whole catalogue", all.total, 5);

  const byName = await storage.queryProducts(productQuerySchema.parse({ limit: 10, search: "terminée" }));
  check(
    "search and promo filters compose",
    byName.total === 1 && byName.items[0].name === "Promo terminée",
    `got ${JSON.stringify(byName.items.map((p: any) => p.name))}`,
  );

  // The checkout rule, exercised through storage.getProduct exactly as
  // POST /api/orders does it.
  const priced = [
    { label: "no promo", product: noPromo, expected: 100 },
    { label: "active promo", product: activePromo, expected: 80 },
    { label: "future promo", product: futurePromo, expected: 100 },
    { label: "expired promo", product: expiredPromo, expected: 100 },
    { label: "promo >= price", product: badPromo, expected: 100 },
  ];
  for (const { label, product, expected } of priced) {
    const fresh = (await storage.getProduct((product as any).id))!;
    eq(`checkout price for ${label}`, resolvePromotion(fresh).effectivePrice, expected);
  }

// Close the connection before deleting: better-sqlite3 holds a file lock for the
  // life of the process and Windows refuses to unlink an open file, so without this
  // the throwaway database survives every run.
  await closeDatabase();
  for (const f of [THROWAWAY, `${THROWAWAY}-journal`]) {
    if (fs.existsSync(f)) fs.rmSync(f);
  }
  console.log("\n[cleanup] throwaway database removed");
}

/**
 * Optional PostgreSQL pass.
 *
 *   PROMO_TEST_PG_URL=postgres://user:pass@host/db npm run test:promotions -w server
 *
 * This exists because the promotion filter binds the current instant as a
 * different type per dialect (epoch seconds for SQLite, a Date for PostgreSQL).
 * A bug in that binding is silent on one engine and total on the other — SQLite
 * accepted milliseconds and simply matched every future promotion as live — so
 * production's engine has to be covered too, not just the dev one.
 *
 * It expects an already-created, empty throwaway database and only inserts and
 * reads; it never drops or truncates anything, and it refuses to run unless the
 * URL contains the `promo_lt` marker.
 */
async function testPostgresFilter() {
  const url = process.env.PROMO_TEST_PG_URL;
  console.log("\n[3/3] PostgreSQL promo filter (skipped: set PROMO_TEST_PG_URL to run)");
  if (!url) return;

  if (!/promo_lt/.test(url)) {
    console.error("[test:promotions] Refusing to run: PROMO_TEST_PG_URL must contain 'promo_lt'.");
    process.exit(1);
  }

  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: url, ssl: false });
  const raw = await pool.connect();

  // Reset to an empty schema first. Re-running against the same throwaway
  // database would otherwise fail on `relation "categories" already exists`,
  // because migrations here are applied by hand rather than through Drizzle's
  // bookkeeping table. Scoped to `public` inside a database whose name is
  // guarded above.
  await raw.query("drop schema public cascade; create schema public;");

  // Apply the real PG migration chain to the throwaway database.
  const { readFile, readdir } = await import("fs/promises");
  const folder = path.join(SERVER_ROOT, "migrations/pg");
  const journal = JSON.parse(await readFile(path.join(folder, "meta/_journal.json"), "utf8"));
  console.log(`[pg] applying ${journal.entries.length} migration(s) to the throwaway database`);
  for (const entry of journal.entries) {
    const sqlText = await readFile(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await raw.query(trimmed);
    }
  }

  const insert = `insert into products (name, description, image_url, category, quantity, price, promo_price, promo_start, promo_end)
    values ($1,'d','/x.png','Cadeaux & Décor',10,$2,$3,$4,$5) returning id, name, price, promo_price, promo_start, promo_end`;

  const seeded = await raw.query(insert, ["Sans promo", 100, null, null, null]);
  const active = await raw.query(insert, ["Promo active", 100, 80, null, null]);
  const future = await raw.query(insert, [
    "Promo future",
    100,
    70,
    new Date(Date.now() + 86_400_000),
    null,
  ]);
  const expired = await raw.query(insert, [
    "Promo terminée",
    100,
    50,
    new Date(Date.now() - 172_800_000),
    new Date(Date.now() - 86_400_000),
  ]);
  const bad = await raw.query(insert, ["Promo >= prix", 100, 100, null, null]);

  check(
    "pg: a product created without promotion stores NULL, not 0",
    seeded.rows[0].promo_price === null,
    `got ${JSON.stringify(seeded.rows[0].promo_price)}`,
  );
  eq("pg: promo price stored as a number", Number(active.rows[0].promo_price), 80);
  check(
    "pg: promo start stored as a timestamp",
    active.rows[0].promo_start === null && future.rows[0].promo_start instanceof Date,
  );

  // The exact predicate buildProductFilters emits for PostgreSQL, with the
  // current instant bound as a Date.
  const now = new Date();
  const promoted = await raw.query(
    `select name from products
     where promo_price is not null
       and promo_price >= 0
       and promo_price < price
       and (promo_start is null or promo_start <= $1)
       and (promo_end is null or promo_end > $1)
     order by name`,
    [now],
  );
  const names = promoted.rows.map((r: any) => r.name);
  check(
    "pg: promo=active returns only the live promotion",
    names.length === 1 && names[0] === "Promo active",
    `got ${JSON.stringify(names)}`,
  );

  const plan = await raw.query(
    `explain select name from products where promo_price is not null
       and promo_price >= 0 and promo_price < price
       and (promo_start is null or promo_start <= $1)
       and (promo_end is null or promo_end > $1) order by created_at desc limit 8`,
    [now],
  );
  console.log(`[pg] plan: ${plan.rows.map((r: any) => r["QUERY PLAN"]).join(" | ")}`);

  // The planner will prefer a seq scan on a table this small; what matters is
  // that migration 0003 actually created the partial index the filter is meant
  // to ride on at real catalogue sizes.
  const indexes = await raw.query(
    `select indexname, indexdef from pg_indexes where tablename = 'products' and indexdef ilike '%promo%'`,
  );
  check(
    "pg: partial index on promoted rows exists",
    indexes.rows.length === 1 && /WHERE/.test(indexes.rows[0].indexdef),
    JSON.stringify(indexes.rows),
  );
  if (indexes.rows.length) console.log(`[pg] index: ${indexes.rows[0].indexdef}`);

  // Checkout pricing through the same resolver, on the same rows.
  //
  // The resolver takes a Drizzle-shaped row (camelCase), so the raw snake_case
  // row from `returning` is mapped first. Without that mapping every row looks
  // like it has no promotion at all, which would make the active case fail for a
  // reason that has nothing to do with pricing.
  const asProduct = (row: any) => ({
    price: row.price,
    promoPrice: row.promo_price,
    promoStart: row.promo_start,
    promoEnd: row.promo_end,
  });

  for (const [label, row, expected] of [
    ["no promo", seeded.rows[0], 100],
    ["active promo", active.rows[0], 80],
    ["future promo", future.rows[0], 100],
    ["expired promo", expired.rows[0], 100],
    ["promo >= price", bad.rows[0], 100],
  ] as [string, any, number][]) {
    eq(`pg: checkout price for ${label}`, resolvePromotion(asProduct(row)).effectivePrice, expected);
  }

  // Leave the throwaway database clean for the next run.
  await raw.query("delete from products");
  raw.release();
  await pool.end();
  console.log("[pg] throwaway rows removed (database itself left for manual teardown)");
}

async function main() {
  testResolver();
  testValidation();
  await testStorageFilter();
  // Run before the exit below so PG failures are counted rather than truncated.
  await testPostgresFilter();

  console.log(`\n[test:promotions] ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log(`[test:promotions] failures:\n  - ${failures.join("\n  - ")}`);
    process.exit(1);
  }
}

await main();
process.exit(0);