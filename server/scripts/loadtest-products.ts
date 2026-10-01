/**
 * Catalogue load test.
 *
 *   npm run test:load -w server
 *
 * Seeds a throwaway database with 3,000+ products, then measures the paged,
 * filtered and sorted queries that the public and admin catalogue actually
 * issue. It reports timings and the query plan for each case so it is obvious
 * whether a real index is doing the work.
 *
 * Two safety rules, both deliberate:
 *
 *   1. It REFUSES to run against anything but a throwaway target. The URL must
 *      contain a marker string (`lt_`, `loadtest`, or live is blocked), and it
 *      never resolves to the repository's server/bb_market.db. This is a data
 *      safety check, not a convenience one.
 *   2. It only ever calls the read path. No HTTP server is started and no
 *      production hostname is contacted.
 *
 * Timings are per-query averages over a warm cache. The first sample on both
 * engines pays for a cold buffer, so it is discarded deliberately.
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import pg from "pg";
import { resolvePgSsl } from "../db-target.js";

/**
 * This script speaks raw SQL rather than Drizzle.
 *
 * The two dialect tables in shared/db-schema.ts cannot be declared side by side
 * in one file (their column builders are not interchangeable), and Drizzle's
 * query builder would abstract away the very thing being measured. The DDL below
 * is therefore written out explicitly, matching shared/db-schema.ts after
 * migration 0002.
 */

const PRODUCT_COUNT = 3_000;
const WARMUP = 2;
const SAMPLES = 12;
const DEFAULT_SAMPLE_LIMIT = 24;

/** Mirrors PRODUCT_LOW_STOCK_THRESHOLD in shared/schema.ts. */
const LOW_STOCK = 5;

/** Reuse the real catalogue categories so `category` filters are realistic. */
const CATEGORIES = [
  "Naissance Boy", "Naissance Girl", "Mariage", "Accessoire", "Anniversaire",
  "Soutenance", "العمرة", "Emballage", "Patisserie", "Cadeaux & Décor",
  "Nouveautés", "Ramadan", "Saint Valentin",
];

const WORDS = ["Boite", "Coffret", "Set", "Pack", "Moule", "Ruban", "Verre", "Assiette",
  "Decor", "Lanterne", "Fleur", "Coeur", "Bougie", "Nappe", "Serviette", "Couvert"];

/** DDL matching shared/db-schema.ts after migration 0002, per dialect. */
const DDL: Record<string, { table: string; indexes: string[] }> = {
  sqlite: {
    // `created_at` carries the same default as migration 0002 so the insert path
    // matches production rather than being handed a value it would never get.
    table: `create table products (
      id integer primary key autoincrement,
      name text not null, description text not null, image_url text not null,
      category text not null, quantity integer default 0 not null,
      price real default 0 not null,
      created_at integer default (strftime('%s','now')) not null)`,
    indexes: [
      "create index idx_products_created_at on products (created_at, id)",
      "create index idx_products_category on products (category)",
      "create index idx_products_price on products (price)",
      "create index idx_products_quantity on products (quantity)",
    ],
  },
  pg: {
    table: `create table products (
      id serial primary key,
      name text not null, description text not null, image_url text not null,
      category text not null, quantity integer default 0 not null,
      price double precision default 0 not null, created_at timestamp default now() not null)`,
    indexes: [
      "create index idx_products_created_at on products (created_at, id)",
      "create index idx_products_category on products (category)",
      "create index idx_products_price on products (price)",
      "create index idx_products_quantity on products (quantity)",
    ],
  },
};

type Case = { label: string; sql: string; params: unknown[] };

interface Engine {
  name: string;
  /** DDL / transaction control. */
  exec(sql: string): Promise<void>;
  /** Returns rows. */
  query(sql: string, params: unknown[]): Promise<unknown[]>;
  /** Statement that returns no rows (INSERT, etc). */
  write(sql: string, params: unknown[]): Promise<void>;
  plan(sql: string, params: unknown[]): Promise<string>;
  close(): Promise<void>;
}

/**
 * Set once in main() before any query is built.
 *
 * SQLite binds `?`; PostgreSQL binds `$1..$n`. The two are not interchangeable,
 * and a multi-row INSERT needs every placeholder renumbered, so both the seed
 * and the measured cases go through these helpers instead of hardcoding `?`.
 */
let dialect: "sqlite" | "pg" = "sqlite";

/** `rows` tuples of `cols` placeholders for a bulk INSERT. */
function rowsSql(rows: number, cols: number): string {
  const tuples: string[] = [];
  for (let r = 0; r < rows; r++) {
    const t: string[] = [];
    for (let c = 0; c < cols; c++) {
      t.push(dialect === "pg" ? `$${r * cols + c + 1}` : "?");
    }
    tuples.push(`(${t.join(",")})`);
  }
  return tuples.join(",");
}

/** Single-value placeholder at a 1-based position within the current query. */
function ph(n: number): string {
  return dialect === "pg" ? `$${n}` : "?";
}

// The catalogue cases are generated from the same shapes server/storage.ts
// builds, so what is measured here is what the API will do.
function buildCases(): Case[] {
  const low = LOW_STOCK;
  return [
    {
      label: "first page (newest)",
      sql: `select id,name,price,quantity,category,created_at from products order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "page 60 (newest, offset 1416)",
      sql: `select id,name,price,quantity,category,created_at from products order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 1416`,
      params: [],
    },
    {
      label: "search by name (leading wildcard)",
      sql: `select id,name,price,quantity from products where lower(name) like ${ph(1)} escape '\\' order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [`%${WORDS[0].toLowerCase()}%`],
    },
    {
      label: "category filter",
      sql: `select id,name,price,quantity from products where category = ${ph(1)} order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [CATEGORIES[3]],
    },
    {
      label: "price asc",
      sql: `select id,name,price,quantity from products order by price asc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "price desc",
      sql: `select id,name,price,quantity from products order by price desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "stock in (quantity > 0)",
      sql: `select id,name,price,quantity from products where quantity > 0 order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "stock out (quantity = 0)",
      sql: `select id,name,price,quantity from products where quantity = 0 order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: `stock low (0 < quantity <= ${low})`,
      sql: `select id,name,price,quantity from products where quantity > 0 and quantity <= ${low} order by created_at desc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "sort stock asc",
      sql: `select id,name,price,quantity from products order by quantity asc, id desc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "sort name asc",
      sql: `select id,name,price,quantity from products order by lower(name) asc, id asc limit ${DEFAULT_SAMPLE_LIMIT} offset 0`,
      params: [],
    },
    {
      label: "count for pagination",
      sql: `select count(*) as c from products`,
      params: [],
    },
  ];
}

function seedRows(count: number) {
  const rows: { name: string; description: string; imageUrl: string; category: string; quantity: number; price: number; createdAt: number }[] = [];
  // Spread insertions over ~120 days so `order by created_at` has real
  // selectivity. Identical timestamps for every row would make the index look
  // better here than it is in production.
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) {
    // Deterministic: a rerun produces the same catalogue, so timings are
    // comparable and a wrong row count is obvious.
    const w1 = WORDS[i % WORDS.length];
    const w2 = WORDS[(i * 7 + 3) % WORDS.length];
    rows.push({
      name: `${w1} ${w2} ${i}`,
      description: `Catalogue row ${i}`,
      imageUrl: `/uploads/seed_${i % 50}.png`,
      category: CATEGORIES[i % CATEGORIES.length],
      // ~4% out of stock, ~10% low stock, rest healthy. Gives every stock
      // bucket a non-trivial population.
      quantity: i % 25 === 0 ? 0 : i % 10 === 0 ? (i % LOW_STOCK) + 1 : 10 + (i % 90),
      price: Math.round((5 + ((i * 137) % 9950) / 100) * 1000) / 1000,
      createdAt: now - Math.floor((count - i) * (120 * 86400) / count),
    });
  }
  return rows;
}

async function seed(engine: Engine, count: number) {
  const rows = seedRows(count);
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const batch = rows.slice(i, i + chunk);
    // SQLite binds `?`; Postgres binds `$1..$n`. Both engines accept the same
    // parameter array once the placeholders are spelled per dialect.
    // SQLite stores created_at as an epoch integer; PostgreSQL expects a real
    // timestamp. Passing the raw number to pg fails with "date/time field value
    // out of range", so the value is shaped per dialect here.
    const params = batch.flatMap(r => [
      r.name, r.description, r.imageUrl, r.category, r.quantity, r.price,
      dialect === "pg" ? new Date(r.createdAt * 1000) : r.createdAt,
    ]);
    await engine.exec("begin");
    try {
      await engine.write(
        `insert into products (name,description,image_url,category,quantity,price,created_at) values ${rowsSql(batch.length, 7)}`,
        params,
      );
      await engine.exec("commit");
    } catch (err) {
      await engine.exec("rollback");
      throw err;
    }
  }
}

async function time(engine: Engine, c: Case) {
  for (let i = 0; i < WARMUP; i++) await engine.query(c.sql, c.params);
  const samples: number[] = [];
  let rowCount = 0;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const rows = await engine.query(c.sql, c.params);
    samples.push(performance.now() - t0);
    rowCount = rows.length;
  }
  samples.sort((a, b) => a - b);
  const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
  const p50 = samples[Math.floor(samples.length * 0.5)];
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))];
  return { avg, p50, p95, rows: rowCount };
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  dialect = url.startsWith("postgres") || url.startsWith("postgresql") ? "pg" : "sqlite";

  if (dialect === "sqlite") {
    const resolved = path.resolve(url.replace(/^file:/, ""));
    const repoDb = path.resolve(process.cwd(), "bb_market.db");
    if (resolved === repoDb || !/lt_|loadtest/i.test(path.basename(resolved))) {
      console.error(`[loadtest] REFUSING to seed ${resolved}.`);
      console.error("[loadtest] The target must be a throwaway file named *lt_*.db or *loadtest*.db.");
      process.exit(2);
    }
  } else {
    if (!/lt_|loadtest/i.test(url)) {
      console.error(`[loadtest] REFUSING to seed "${url.replace(/:[^@]+@/, ":****@")}".`);
      console.error("[loadtest] The database name or URL must contain 'lt_' or 'loadtest'.");
      process.exit(2);
    }
  }

  const ddl = DDL[dialect];
  let engine: Engine;

  if (dialect === "sqlite") {
    const file = url.replace(/^file:/, "");
    if (fs.existsSync(file)) fs.unlinkSync(file);
    const db = new Database(file);
    // WAL keeps the seed inserts from contending with the measured reads.
    db.pragma("journal_mode = WAL");
    db.exec(ddl.table);
    for (const s of ddl.indexes) db.exec(s);
    engine = {
      name: "SQLite",
      async exec(s) { db.exec(s); },
      async query(s, p) { return db.prepare(s).all(p as never[]); },
      async write(s, p) { db.prepare(s).run(p as never[]); },
      async plan(s, p) {
        const rows = db.prepare(`explain query plan ${s}`).all(p as never[]) as { detail: string }[];
        return rows.map(r => r.detail).join("\n      ");
      },
      async close() { db.close(); },
    };
  } else {
    const pool = new pg.Pool({ connectionString: url, ssl: resolvePgSsl() });
    await pool.query("drop table if exists products cascade");
    await pool.query("drop table if exists __drizzle_migrations cascade");
    await pool.query(ddl.table);
    for (const s of ddl.indexes) await pool.query(s);
    engine = {
      name: "PostgreSQL",
      async exec(s) { await pool.query(s); },
      async query(s, p) { const r = await pool.query(s, p as never[]); return r.rows; },
      async write(s, p) { await pool.query(s, p as never[]); },
      async plan(s, p) {
        // ANALYZE executes the query, which is safe here because the target is
        // a throwaway database that is dropped at the end of the run.
        const r = await pool.query(`explain (analyze, buffers) ${s}`, p as never[]);
        return r.rows.map((x: Record<string, unknown>) => String(x["QUERY PLAN"])).join("\n      ");
      },
      async close() { await pool.end(); },
    };
  }

  console.log(`[loadtest] engine     : ${engine.name}`);
  console.log(`[loadtest] seeding    : ${PRODUCT_COUNT.toLocaleString()} products`);

  const t0 = performance.now();
  await seed(engine, PRODUCT_COUNT);
  await engine.exec("analyze");
  console.log(`[loadtest] seeded + analyzed in ${(performance.now() - t0).toFixed(0)} ms`);

  const cases = buildCases();
  console.log(`[loadtest] samples    : ${SAMPLES} per case (+${WARMUP} warmup), avg / p50 / p95\n`);
  console.log(`  ${"case".padEnd(40)} ${"rows".padStart(5)} ${"avg".padStart(8)} ${"p50".padStart(8)} ${"p95".padStart(8)}   plan`);
  console.log(`  ${"-".repeat(120)}`);

  for (const c of cases) {
    const t = await time(engine, c);
    const plan = await engine.plan(c.sql, c.params);
    const usesIndex = /idx_products|SCAN products USING|Index Scan|Index Only Scan|Bitmap Index/i.test(plan);
    console.log(
      `  ${c.label.padEnd(40)} ${String(t.rows).padStart(5)} ` +
      `${t.avg.toFixed(2).padStart(7)}ms ${t.p50.toFixed(2).padStart(7)}ms ${t.p95.toFixed(2).padStart(7)}ms   ` +
      `${usesIndex ? "index" : "SEQ"}`,
    );
    if (process.env.LOADTEST_VERBOSE) console.log(`      ${plan}`);
  }

  await engine.close();
  console.log(`\n[loadtest] done.`);
  if (dialect === "sqlite") {
    console.log(`[loadtest] throwaway file left for inspection: ${url.replace(/^file:/, "")}`);
  }
}

main().catch(err => {
  console.error("[loadtest] failed:", err);
  process.exit(1);
});