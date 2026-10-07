/**
 * Performance and query-plan check for `GET /api/admin/analytics`.
 *
 * `test-analytics-routes.ts` proves the numbers are RIGHT on a fixture small enough
 * to reason about. This proves they are FAST on data resembling production, which
 * is a separate question: the aggregates scan `orders` and expand `items_json` in
 * SQL, so cost grows with row count and with the number of lines per order, and a
 * correct implementation can still be unusable at 5,000 orders.
 *
 * What is measured
 * ----------------
 *   - Seed size is configurable but defaults to 3,000 products and 5,000 orders,
 *     each with 1-4 snapshot lines, which is roughly what a busy shop accumulates
 *     in a year.
 *   - The wide `last30` range is the default, because a 30-day window over 5,000
 *     orders is the case most likely to need an index; `last7` and the 365-day
 *     `custom` range are also run so a range that happens to be fast is visible as
 *     such rather than mistaken for the general case.
 *   - Wall time is reported per range, plus the p95 over repeated calls, because a
 *     single slow first call usually means a cold page cache rather than a slow
 *     query.
 *   - `EXPLAIN`/`EXPLAIN QUERY PLAN` output is printed for the range scan and for
 *     both snapshot aggregates. `orders` had no indexes at the time of writing, so
 *     this is the evidence for whether migration 0005 is needed and on which
 *     column.
 *
 * Budgets are deliberately loose. This is a regression tripwire, not a benchmark:
 * it fails when an order of magnitude is lost, and prints the numbers either way so
 * a change can be compared against the previous run.
 *
 * Never run against `server/bb_market.db`: seeding writes thousands of rows.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, type ChildProcess } from "child_process";
import Database from "better-sqlite3";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(SERVER_ROOT, "..");
const PORT = 3198;
const BASE = `http://127.0.0.1:${PORT}`;
const THROWAWAY = path.join(SERVER_ROOT, "analytics_perf_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.analytics_perf_rt");

const MS_PER_DAY = 86_400_000;

const PRODUCTS = Number(process.env.PERF_PRODUCTS ?? 3000);
const ORDERS = Number(process.env.PERF_ORDERS ?? 5000);
const REPEATS = Number(process.env.PERF_REPEATS ?? 5);

/** Per-range wall-clock budget in ms; a regression far past this is a failure. */
const BUDGET_MS: Record<string, number> = {
  today: 1500,
  last7: 1500,
  last30: 2000,
  custom: 3000,
};

const ADMIN_USER = ["perf_admin", "perf_admin@example.test", "Perf Admin", "+21600000999"];
const ADMIN_PASSWORD = "perf_admin_pw";

let failed = 0;
const failures: string[] = [];

function check(label: string, condition: boolean, detail = "") {
  if (condition) console.log(`  PASS  ${label}${detail ? `  ${detail}` : ""}`);
  else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? `  ${detail}` : ""}`);
  }
}

function dbFiles() {
  return [THROWAWAY, `${THROWAWAY}-journal`, `${THROWAWAY}-wal`, `${THROWAWAY}-shm`];
}

/** Midnight UTC, `daysAgo` days before now, so ranges line up with the API's. */
function dayStart(daysAgo: number): number {
  return Math.floor(Date.now() / MS_PER_DAY) * MS_PER_DAY - daysAgo * MS_PER_DAY;
}

const SEC = (ms: number) => Math.floor(ms / 1000);

/**
 * Seed in one transaction with prepared statements.
 *
 * Row-at-a-time inserts through a single prepared statement keep this to a few
 * seconds at 5,000 orders; running the API against a half-built table instead would
 * measure the seeding loop rather than the queries.
 */
async function seed(): Promise<{ productIds: number[]; adminId: number }> {
  const { hashPassword } = await import("../auth.js");
  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const db = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sqlText = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }

  const adminId = Number(
    db
      .prepare("insert into users (username, email, full_name, phone, password, role) values (?,?,?,?,?,?)")
      .run(ADMIN_USER[0], ADMIN_USER[1], ADMIN_USER[2], ADMIN_USER[3], await hashPassword(ADMIN_PASSWORD), "superadmin")
      .lastInsertRowid,
  );

  const categories = ["Emballage", "Patisserie", "Maison", "Decoration", "Fête", "Autre"];
  // Top categories group by `categories.name` through `product.category_id`, so
  // the fixture links its rows instead of leaving every product uncategorised -
  // which would make the panel a single `__unknown__` bucket rather than a mix.
  const insertCategory = db.prepare("insert into categories (name, slug) values (?,?)");
  for (const name of categories) insertCategory.run(name, `perf-${categories.indexOf(name)}`);
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
  const productIds: number[] = [];
  const started = Date.now();
  db.transaction(() => {
    for (let i = 0; i < PRODUCTS; i++) {
      productIds.push(
        Number(
          insertProduct(
            `Produit ${i}`,
            "d",
            `/p${i}.png`,
            categories[i % categories.length],
            (i * 7) % 40,
            5 + (i % 50) * 3,
          ).lastInsertRowid,
        ),
      );
    }
  })();

  const insertOrder = db.prepare(`
    insert into orders
      (user_id, customer_name, email, phone, address, items_json, subtotal, total, delivery_fee, status, fulfillment_method, payment_method, created_at)
    values (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  // Spread orders over 400 days so a 365-day `custom` range really does select most
  // of the table, which is the point of measuring it.
  const SPAN_DAYS = 400;
  const STATUSES = ["delivered", "delivered", "delivered", "confirmed", "pending", "cancelled"];
  db.transaction(() => {
    for (let o = 0; o < ORDERS; o++) {
      const lineCount = 1 + (o % 4);
      const lines = [];
      let subtotal = 0;
      for (let l = 0; l < lineCount; l++) {
        const p = productIds[(o * 7 + l * 13) % productIds.length];
        const quantity = 1 + ((o + l) % 3);
        const price = 5 + (p % 50) * 3;
        subtotal += quantity * price;
        lines.push({
          id: p,
          name: `Produit ${p}`,
          quantity,
          price,
          originalPrice: price,
          promoApplied: false,
          imageUrl: `/p${p}.png`,
          lineTotal: quantity * price,
        });
      }
      const delivery = o % 3 === 0 ? 7 : 0;
      const daysAgo = (o * SPAN_DAYS) / ORDERS;
      // A small slice of deliberately corrupt rows: the guard must skip them
      // cheaply rather than aborting the aggregate, which would look "fast" here
      // only because it returned nothing.
      const items = o % 500 === 499 ? "{corrupt" : JSON.stringify(lines);
      insertOrder.run(
        adminId,
        ADMIN_USER[2],
        ADMIN_USER[1],
        ADMIN_USER[3],
        "Tunis",
        items,
        subtotal.toFixed(2),
        (subtotal + delivery).toFixed(2),
        String(delivery),
        STATUSES[o % STATUSES.length],
        o % 2 === 0 ? "delivery" : "pickup",
        "cash_on_delivery",
        SEC(dayStart(Math.floor(daysAgo))),
      );
    }
  })();
  db.close();

  console.log(
    `[setup] ${journal.entries.length} migration(s), ${PRODUCTS} products, ${ORDERS} orders in ${Date.now() - started}ms`,
  );
  return { productIds, adminId };
}

function makeClient() {
  let cookie = "";
  return {
    async call(p: string) {
      const res = await fetch(`${BASE}${p}`, {
        headers: cookie ? { Cookie: cookie } : {},
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
      return { status: res.status, data, ms: Number(res.headers.get("server-timing") ?? NaN) };
    },
    async login(username: string, password: string) {
      return this.call2("POST", "/api/login", { username, password });
    },
    async call2(method: string, p: string, body: unknown) {
      const res = await fetch(`${BASE}${p}`, {
        method,
        headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
        redirect: "manual",
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return { status: res.status, data: await res.json().catch(() => undefined) };
    },
  };
}

const RANGES: [string, string][] = [
  ["today", "/api/admin/analytics?range=today"],
  ["last7", "/api/admin/analytics?range=last7"],
  ["last30", "/api/admin/analytics?range=last30"],
  [
    "custom",
    `/api/admin/analytics?range=custom&from=${new Date(dayStart(364)).toISOString().slice(0, 10)}&to=${new Date(dayStart(0)).toISOString().slice(0, 10)}`,
  ],
];

async function main() {
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
  await seed();

  fs.writeFileSync(
    CHILD_ENV_FILE,
    [
      "# Generated by scripts/test-analytics-perf.ts. Never commit.",
      "DATABASE_URL=file:./analytics_perf_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=analytics-perf-test-secret",
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

  let up = false;
  for (let i = 0; i < 90; i++) {
    try {
      const r = await fetch(`${BASE}/api/categories`);
      if (r.ok) {
        up = true;
        break;
      }
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!up) {
    console.error("[FATAL] server did not start\n" + serverLog);
    failed++;
  }

  try {
    const admin = makeClient();
    const login = await admin.login(ADMIN_USER[0], ADMIN_PASSWORD);
    if (login.status !== 200) {
      console.error(`[FATAL] admin login returned ${login.status}`);
      failed++;
    }

    console.log(`\n--- ${ORDERS} orders, ${PRODUCTS} products, ${REPEATS} repeats ---`);

    for (const [label, url] of RANGES) {
      const times: number[] = [];
      let payload: any;
      let status = 0;
      for (let i = 0; i < REPEATS; i++) {
        const started = Date.now();
        const res = await admin.call(url);
        times.push(Date.now() - started);
        status = res.status;
        payload = res.data;
      }
      // p95 of 5 samples is the max, which is intentional: a single outlier on the
      // hot path is what an admin actually waits for.
      const worst = Math.max(...times);
      const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
      const bytes = Buffer.byteLength(JSON.stringify(payload ?? {}));

      check(
        `${label}: responds 200`,
        status === 200,
        `got ${status}`,
      );
      check(
        `${label}: within ${BUDGET_MS[label]}ms budget`,
        worst <= BUDGET_MS[label],
        `avg ${avg}ms, worst ${worst}ms`,
      );

      // A fast response that skipped the aggregates would be worse than a slow one,
      // so verify the payload is populated and the corrupt rows did not empty it.
      if (label === "last30" && status === 200) {
        check("last30: top products are populated", (payload?.topProducts?.length ?? 0) > 0, `${payload?.topProducts?.length} rows`);
        check("last30: top categories are populated", (payload?.topCategories?.length ?? 0) > 0, `${payload?.topCategories?.length} rows`);
        check("last30: revenue is non-zero", Number(payload?.summary?.revenue ?? 0) > 0, `${payload?.summary?.revenue}`);
        check("last30: daily series is bounded by the range", (payload?.daily?.length ?? 0) <= 31, `${payload?.daily?.length} points`);
        check("last30: payload stays small", bytes < 60_000, `${bytes} bytes`);
        check(
          "last30: no aggregate was skipped by corrupt rows",
          !serverLog.includes("aggregate failed"),
          serverLog.includes("aggregate failed") ? "server log reports a failed aggregate" : "",
        );
      }

      console.log(`         ${label}: avg ${avg}ms, worst ${worst}ms, ${bytes} bytes`);
    }

    const plans = await explainPlans();
    console.log("\n--- query plans ---");
    for (const [label, plan] of plans) console.log(`  ${label}:\n${plan}`);

    // SQLite names the table by its ALIAS in the plan, so the orders scan shows up as
    // `SCAN o`, not `SCAN orders`. A range predicate on `created_at` that is actually
    // used appears as `SEARCH o USING INDEX ...`; `SCAN o` means the whole table was
    // read and the range bounds did nothing. `SCAN j` is expected and not a finding:
    // it is the per-row `json_each` virtual table over the selected orders.
    const scans = plans
      .filter(([, p]) => /SCAN\s+o\b/.test(p))
      .map(([l]) => l);
    if (scans.length) {
      console.log(
        `\n  FINDING: full table scan on orders in ${scans.join(", ")}. The range bounds are being` +
          `\n           evaluated only after the whole table is read, so this is O(total orders)` +
          `\n           regardless of the selected range. An index on orders(created_at) would fix it.`,
      );
    } else {
      const used = new Set<string>();
      for (const [, p] of plans) for (const m of p.matchAll(/USING INDEX (\w+)/g)) used.add(m[1]);
      console.log(
        `\n  FINDING: every query satisfied its range with an index seek` +
          `${used.size ? ` (${[...used].join(", ")})` : ""}. Cost now scales with the rows in the` +
          `\n           selected range rather than the table. If this ever reports a SCAN again, the` +
          `\n           index is missing from the replayed migration folder.`,
      );
    }
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 400));
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
  }

  console.log(`\n[test:analytics-perf] ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach((f) => console.log(`  - ${f}`));
    console.log(`\n--- server log ---\n${serverLog.slice(-4000)}`);
  }
  process.exit(failed ? 1 : 0);
}

/**
 * Read the plans from a direct SQLite connection.
 *
 * `explainAnalyticsQueries` exists in `server/analytics.ts` for this purpose, but it
 * needs the module's `db`, which is bound to the child's `DATABASE_URL`. Opening a
 * second handle on the same throwaway file is simpler here and keeps the server's
 * pool out of the measurement.
 */
async function explainPlans(): Promise<[string, string][]> {
  const { resolveAnalyticsWindow, analyticsQuerySchema } = await import("../../shared/analytics.js");
  const query = analyticsQuerySchema.parse({ range: "last30" });
  const window = resolveAnalyticsWindow(query.range, Date.now(), query.from, query.to);
  const isPg = /postgres/i.test(process.env.DATABASE_URL ?? "");
  const prefix = isPg ? "EXPLAIN " : "EXPLAIN QUERY PLAN ";

  const el = isPg ? "j" : "j.value";
  const num = (e: string) => `CAST(${e} AS ${isPg ? "double precision" : "REAL"})`;
  const idExpr = num(`${el}->>'id'`);
  const dayExpr = isPg
    ? "to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')"
    : "date(o.created_at, 'unixepoch')";
  const moneySum = isPg ? 'CAST(SUM(o.total::numeric) AS double precision)' : "CAST(SUM(CAST(o.total AS REAL)) AS REAL)";
  const nonCancelled = "o.status <> 'cancelled'";
  const tsLit = (ms: number) => (isPg ? `'new Date(${ms})'` : String(ms));
  const snapshot = isPg
    ? `FROM orders o LEFT JOIN LATERAL jsonb_array_elements(
        CASE WHEN o.items_json ~ '^\\s*\\[' THEN o.items_json::jsonb ELSE '[]'::jsonb END
      ) AS j ON true`
    : `FROM orders o LEFT JOIN json_each(
        CASE WHEN json_valid(o.items_json) = 1
          THEN CASE WHEN json_type(o.items_json) = 'array' THEN o.items_json ELSE '[]' END
          ELSE '[]' END
      ) AS j ON true`;
  const rangeWhere = `AND o.created_at >= ${tsLit(window.fromMs)} AND o.created_at < ${tsLit(window.toMs)}`;
  const qty = num(`${el}->>'quantity'`);

  const statements: [string, string][] = [
    [
      "daily",
      `SELECT ${dayExpr} AS day, ${moneySum} AS revenue, COUNT(*) AS n
       FROM orders o WHERE ${nonCancelled} ${rangeWhere} GROUP BY ${dayExpr}`,
    ],
    [
      "topProducts",
      `SELECT ${idExpr} AS product_id, SUM(${qty}) AS units_sold
       ${snapshot} WHERE ${nonCancelled} ${rangeWhere} AND CASE WHEN ${qty} >= 1 THEN 1 ELSE 0 END = 1
       GROUP BY ${idExpr}`,
    ],
    [
      "topCategories",
      // Mirrors analytics.ts: categories are named through `product.category_id`,
      // so the plan has to include the second join to be a realistic estimate.
      `SELECT COALESCE(c.name, '__unknown__') AS category, SUM(${qty}) AS units_sold
       ${snapshot} LEFT JOIN products p ON p.id = ${idExpr}
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${nonCancelled} ${rangeWhere} AND CASE WHEN ${qty} >= 1 THEN 1 ELSE 0 END = 1
       GROUP BY COALESCE(c.name, '__unknown__')`,
    ],
  ];

  const out: [string, string][] = [];
  if (isPg) {
    console.log("  (no local PostgreSQL; skipping EXPLAIN. Run against the prod target to complete this.)");
    return out;
  }
  const db = new Database(THROWAWAY, { readonly: true });
  for (const [label, sqlText] of statements) {
    const rows = db.prepare(`${prefix}${sqlText}`).all() as any[];
    out.push([label, rows.map((r) => r.detail ?? Object.values(r).join(" ")).join("\n")]);
  }
  db.close();
  return out;
}

main().catch((error) => {
  console.error("[FATAL]", error);
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
  if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
  process.exit(1);
});
