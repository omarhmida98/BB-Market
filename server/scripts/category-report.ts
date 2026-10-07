/**
 * How well the relational category link covers the data.
 *
 *   npm run db:category-report
 *
 * The migration that added `category_id` (0009 on SQLite, 0010 on Postgres)
 * backfilled it by matching the legacy `category` text against `categories.name`.
 * A name no category owns is left with `category_id = NULL` on purpose: nothing
 * is guessed and no category is auto-created. This script is where those rows
 * are listed, together with the usage count of every category, so an
 * administrator can reassign them (or create the missing category) instead of
 * finding out from a product that has stopped appearing in its filter.
 *
 * It reads only - no row is modified. Works for both dialects off the same
 * DATABASE_URL the app uses, and prints identical output for both.
 */
import "../env.js";
import Database from "better-sqlite3";
import pg from "pg";
import { resolveDbTarget } from "../db-target.js";

type Row = Record<string, unknown>;

const target = resolveDbTarget();

/** Rows printed per list before the rest is summarised as a count. */
const MAX_LISTED = 20;

const QUERIES = {
  // One row per category with what still points at it. Correlated counts rather
  // than a five-way join: the tables are small and this keeps one row per
  // category even when two of the three counts are zero.
  usage: `
    SELECT
      c.id,
      c.name,
      c.active,
      (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS products,
      (SELECT COUNT(*) FROM homepage_sections h WHERE h.category_id = c.id) AS homepage_sections,
      (SELECT COUNT(*) FROM promos m WHERE m.category_id = c.id) AS promos
    FROM categories c
    ORDER BY c.name`,
  // Products with no link: the legacy text says what they were, the link does
  // not exist. `category` is NOT NULL here, so an empty string means the row was
  // created uncategorised rather than failed to match.
  unmatchedProducts: `
    SELECT id, name, category
    FROM products
    WHERE category_id IS NULL
    ORDER BY category, name`,
  // Promos are optional about their text: NULL and "" both mean "never named".
  unmatchedPromos: `
    SELECT id, product_name, category
    FROM promos
    WHERE category_id IS NULL
    ORDER BY category, product_name`,
  // Only category-typed shelves are supposed to carry a link; a `newest` shelf
  // with NULL is normal and is not an anomaly worth reporting.
  unmatchedSections: `
    SELECT id, title_fr, category
    FROM homepage_sections
    WHERE category_id IS NULL AND type = 'category'
    ORDER BY title_fr`,
  // Legacy names that no category owns, grouped so a systemic mismatch (a
  // renamed category, a typo made once and copied) shows up as one line. Every
  // branch needs its own GROUP BY: in a UNION ALL each SELECT aggregates on its
  // own, and without one the whole branch collapses into a single COUNT(*) = 0.
  orphanNames: `
    SELECT 'products' AS source, category AS name, COUNT(*) AS rows
      FROM products WHERE category_id IS NULL AND category <> ''
    GROUP BY category
    UNION ALL
    SELECT 'promos', category, COUNT(*)
      FROM promos WHERE category_id IS NULL AND category IS NOT NULL AND category <> ''
    GROUP BY category
    UNION ALL
    SELECT 'homepage_sections', category, COUNT(*)
      FROM homepage_sections
      WHERE category_id IS NULL AND type = 'category' AND category IS NOT NULL AND category <> ''
    GROUP BY category
    ORDER BY source, name`,
};

async function main() {
  let query: (sql: string) => Promise<Row[]>;
  let close: () => Promise<void>;

  if (target.dialect === "postgresql") {
    const pool = new pg.Pool({ connectionString: target.url, ssl: target.ssl });
    query = async (sql) => (await pool.query(sql)).rows;
    close = () => pool.end();
    console.log(`[category-report] PostgreSQL at ${target.url.replace(/:([^@]+)@/, ":****@")}`);
  } else {
    const sqlite = new Database(target.sqlitePath!);
    const statement = (sql: string) => sqlite.prepare(sql);
    query = async (sql) => statement(sql).all() as Row[];
    close = async () => {
      sqlite.close();
    };
    console.log(`[category-report] SQLite at ${target.sqlitePath}`);
  }

  // A database migrated before the category work has no category_id column yet.
  // Saying so beats a raw "no such column: p.category_id" from deeper in the run.
  const hasColumn =
    target.dialect === "postgresql"
      ? (await query(
          "SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'products' AND column_name = 'category_id'",
        )).length > 0
      : (await query("PRAGMA table_info(products)")).some((row) => row.name === "category_id");
  if (!hasColumn) {
    console.log("");
    console.log("[category-report] this database predates the category migration.");
    console.log("[category-report] run `npm run db:migrate` first, then re-run the report.");
    await close();
    process.exit(1);
  }

  const usage = await query(QUERIES.usage);
  const products = await query(QUERIES.unmatchedProducts);
  const promos = await query(QUERIES.unmatchedPromos);
  const sections = await query(QUERIES.unmatchedSections);
  const orphans = await query(QUERIES.orphanNames);

  console.log("");
  console.log(`Categories (${usage.length})`);
  if (usage.length === 0) {
    console.log("  (none - create a category in Admin > Categories first)");
  } else {
    console.log("  id | active | products | sections | promos | name");
    for (const row of usage) {
      console.log(
        `  ${pad(row.id, 2)} | ${pad(row.active ? "yes" : "no", 6)} | ${pad(row.products, 8)} | ${pad(
          row.homepage_sections,
          8,
        )} | ${pad(row.promos, 6)} | ${row.name}`,
      );
    }
  }

  console.log("");
  console.log(`Products with no category link (${products.length})`);
  list(products, (row) => `#${row.id} "${row.name}" (legacy: ${label(row.category)})`);

  console.log("");
  console.log(`Promotions with no category link (${promos.length})`);
  list(promos, (row) => `#${row.id} "${row.product_name ?? ""}" (legacy: ${label(row.category)})`);

  console.log("");
  console.log(`Category shelves with no category link (${sections.length})`);
  list(sections, (row) => `#${row.id} "${row.title_fr}" (legacy: ${label(row.category)})`);

  console.log("");
  console.log("Legacy names no category owns");
  if (orphans.length === 0) {
    console.log("  (none)");
  } else {
    for (const row of orphans) {
      console.log(`  ${pad(row.rows, 4)} x [${row.source}] ${label(row.name)}`);
    }
  }

  const unmatched = products.length + promos.length + sections.length;
  console.log("");
  if (unmatched === 0) {
    console.log("[category-report] every row is linked to a category.");
  } else {
    console.log(
      `[category-report] ${unmatched} row(s) are uncategorised. They still display, under the translated` +
        ` "Uncategorized" label, but they are excluded from every category filter and from category shelves.`,
    );
    console.log(
      "[category-report] fix: create the missing category (Admin > Categories) or reassign the rows;" +
        " nothing is guessed automatically.",
    );
  }

  await close();
}

function pad(value: unknown, width: number): string {
  return String(value ?? "").padStart(width, " ");
}

function label(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return text.trim() === "" ? "(never named)" : text;
}

function list(rows: Row[], describe: (row: Row) => string): void {
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const row of rows.slice(0, MAX_LISTED)) console.log(`  ${describe(row)}`);
  if (rows.length > MAX_LISTED) console.log(`  ... and ${rows.length - MAX_LISTED} more`);
}

await main();
