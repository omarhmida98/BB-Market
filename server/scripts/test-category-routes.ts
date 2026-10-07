/**
 * Route-level tests for the relational category system.
 *
 * Same shape as `test-account-routes.ts`: the real server is spawned as a child
 * process against a throwaway SQLite database and driven over HTTP with real
 * session cookies. The categories feature is almost entirely SQL (joins, a
 * RESTRICT foreign key, a backfill that matched names) so anything exercised
 * only through a unit test of a pure function would leave the part that breaks
 * uncovered.
 *
 * The rules under test, in the order the sections below run:
 *
 *   - category CRUD needs an admin session, and a name is unique;
 *   - a product, a homepage shelf and a promotion all store `category_id`, and
 *     the `category` they report back is the joined `categories.name` - never the
 *     legacy text column, which is written but never read;
 *   - filtering is by `categoryId`, while a legacy `?category=<name>` still
 *     resolves through `categories` (so a rename moves the old link with it) and
 *     a name no category owns matches nothing;
 *   - an unknown `categoryId` is refused with `admin.error_category_unknown`
 *     rather than reaching the foreign key;
 *   - DELETE /api/categories/:id answers 409 with `{ code, counts }` while a
 *     product, a shelf or a promo still points at the category, and 204 once
 *     nothing does;
 *   - a row whose legacy text matched no category stays `category_id IS NULL`,
 *     displays as uncategorised, and is what `npm run db:category-report` lists.
 *
 * Run: npm run test:category-routes -w server
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROWAWAY = path.join(SERVER_ROOT, "category_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.category-route-test");
// Spawn node against tsx's own entrypoint: a `.cmd` shim fails with EINVAL on
// Windows under Node 24.
const tsxCli = path.join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const PORT = 5197;
const BASE = `http://127.0.0.1:${PORT}`;
const UPLOADS_DIR = path.join(SERVER_ROOT, "..", "public", "uploads");

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
  check(
    label,
    Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
  );
}

/**
 * One cookie jar per identity, so "a client cannot delete a category" cannot
 * pass by quietly reusing the admin session that ran before it.
 */
function makeClient() {
  let cookie = "";
  return {
    get cookie() {
      return cookie;
    },
    async call(method: string, url: string, body?: unknown) {
      const res = await fetch(`${BASE}${url}`, {
        method,
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const setCookie = res.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return await read(res);
    },
    async login(username: string, password: string) {
      return this.call("POST", "/api/login", { username, password });
    },
    /**
     * Product and promo create are multipart endpoints with a mandatory image,
     * so JSON would always be answered "Image is required".
     */
    async upload(url: string, fields: Record<string, unknown>) {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
      form.append("image", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "x.png");
      const res = await fetch(`${BASE}${url}`, {
        method: "POST",
        headers: cookie ? { cookie } : {},
        body: form,
      });
      return await read(res);
    },
  };
}

async function read(res: Response) {
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: res.status, json, text };
}

function dbFiles() {
  return [THROWAWAY, `${THROWAWAY}-journal`, `${THROWAWAY}-wal`, `${THROWAWAY}-shm`];
}

/** `better-sqlite3` types `get()` as unknown; this fails loudly on no row. */
function idOf(db: any, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`fixture lookup matched no row: ${sql} ${JSON.stringify(params)}`);
  return Number(row.id);
}

/**
 * Replay the real migration folder rather than hand-writing a CREATE TABLE:
 * that is what makes this test cover the category migration itself (the added
 * columns, the name backfill, the RESTRICT keys, the index).
 */
async function migrate() {
  const { default: Database } = await import("better-sqlite3");
  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const db = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sqlText = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sqlText.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  db.close();
  return journal.entries.length;
}

/** Seed two identities directly: an admin and a plain client. */
async function seed() {
  const { default: Database } = await import("better-sqlite3");
  const { hashPassword } = await import("../auth.js");
  const db = new Database(THROWAWAY);
  const insertUser = db.prepare(
    "insert into users (username, email, full_name, password, role) values (?,?,?,?,?)",
  );
  insertUser.run("cat_admin", "cat_admin@example.test", "Admin", await hashPassword("cat_admin_pw"), "superadmin");
  insertUser.run("cat_client", "cat_client@example.test", "Client", await hashPassword("cat_client_pw"), "client");
  const userIds = {
    admin: idOf(db, "select id from users where username = ?", "cat_admin"),
    client: idOf(db, "select id from users where username = ?", "cat_client"),
  };
  db.close();
  return { userIds };
}

async function main() {
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
  const beforeUploads = fs.existsSync(UPLOADS_DIR) ? new Set(fs.readdirSync(UPLOADS_DIR)) : new Set<string>();

  const migrations = await migrate();
  const ids = await seed();

  // `env.ts` loads the workspace `.env` with `override: true`, so DATABASE_URL
  // must arrive through ENV_FILE - exporting it into the child's environment is
  // not enough and the test would run against live data.
  fs.writeFileSync(
    CHILD_ENV_FILE,
    [
      "# Generated by scripts/test-category-routes.ts. Never commit.",
      "DATABASE_URL=file:./category_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=category-route-test-secret",
      "CLOUDINARY_CLOUD_NAME=",
      "CLOUDINARY_API_KEY=",
      "CLOUDINARY_API_SECRET=",
      "",
    ].join("\n"),
  );

  const child: ChildProcess = spawn(process.execPath, [tsxCli, "index.ts"], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ENV_FILE: CHILD_ENV_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (d) => (serverLog += d.toString()));
  child.stderr?.on("data", (d) => (serverLog += d.toString()));

  const anon = makeClient();
  const admin = makeClient();
  const client = makeClient();

  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        const res = await fetch(`${BASE}/api/products?limit=1`);
        if (res.ok) up = true;
      } catch {
        /* not listening yet */
      }
    }
    if (!up) throw new Error(`server never came up:\n${serverLog}`);
    console.log(`[setup] ${migrations} migration(s), 2 users, server listening`);

    console.log("\n[1/8] category writes need an admin session and a unique name");
    eq("anonymous create is 401", (await anon.call("POST", "/api/categories", { name: "Boites" })).status, 401);
    check("admin can log in", (await admin.login("cat_admin", "cat_admin_pw")).status === 200);
    check("client can log in", (await client.login("cat_client", "cat_client_pw")).status === 200);
    eq("a client cannot create", (await client.call("POST", "/api/categories", { name: "Boites" })).status, 403);

    const boxes = await admin.call("POST", "/api/categories", { name: "Boites" });
    eq("admin create is 201", boxes.status, 201);
    eq("  └ and returns the name it stored", boxes.json?.name, "Boites");
    eq("  └ and defaults to active", boxes.json?.active, true);
    const boxesId = Number(boxes.json?.id);
    check("  └ with a usable id", Number.isInteger(boxesId) && boxesId > 0, `id=${boxes.json?.id}`);

    eq(
      "a duplicate name is refused",
      (await admin.call("POST", "/api/categories", { name: "Boites" })).status,
      400,
    );

    // One category per blocking shape, plus an unused one for the delete path.
    const shelfCat = await admin.call("POST", "/api/categories", { name: "Tableaux" });
    const promoCat = await admin.call("POST", "/api/categories", { name: "Fetes" });
    const freeCat = await admin.call("POST", "/api/categories", { name: "Libre" });
    eq("the shelf category is created", shelfCat.status, 201);
    eq("the promo category is created", promoCat.status, 201);
    eq("the unused category is created", freeCat.status, 201);

    const listed = await anon.call("GET", "/api/categories");
    eq("GET /api/categories is public", listed.status, 200);
    eq("  └ and lists all four", Array.isArray(listed.json) ? listed.json.length : -1, 4);

    console.log("\n[2/8] products link by id, or by a legacy name that still exists");
    const byId = await admin.upload("/api/products", {
      name: "Boite par id",
      description: "d",
      categoryId: boxesId,
      quantity: "10",
      price: "50",
    });
    eq("create with categoryId is 201", byId.status, 201);
    eq("  └ stores the link", byId.json?.categoryId, boxesId);
    eq("  └ and reports the joined name", byId.json?.category, "Boites");

    const byLegacy = await admin.upload("/api/products", {
      name: "Boite par nom",
      description: "d",
      category: "Boites",
      quantity: "10",
      price: "60",
    });
    eq("create with the legacy text name is 201", byLegacy.status, 201);
    eq("  └ resolves to the same id", byLegacy.json?.categoryId, boxesId);
    eq("  └ rather than creating a second category", byLegacy.json?.category, "Boites");

    const unmatched = await admin.upload("/api/products", {
      name: "Sans categorie",
      description: "d",
      category: "Inconnue",
      quantity: "10",
      price: "70",
    });
    eq("a legacy name no category owns is still created", unmatched.status, 201);
    eq("  └ with no link (never guessed, never auto-created)", unmatched.json?.categoryId, null);
    eq("  └ and no display name, so the UI shows the uncategorised label", unmatched.json?.category, null);
    const unmatchedId = Number(unmatched.json?.id);

    console.log("\n[3/8] filtering is by id; the legacy name is only a lookup");
    const all = await anon.call("GET", "/api/products?limit=50");
    eq("three products exist", all.json?.total, 3);

    const byIdFilter = await anon.call(`GET`, `/api/products?categoryId=${boxesId}&limit=50`);
    eq("categoryId filter returns both linked products", byIdFilter.json?.total, 2);
    check(
      "  └ and nothing else",
      (byIdFilter.json?.items ?? []).every((p: any) => p.categoryId === boxesId),
      JSON.stringify((byIdFilter.json?.items ?? []).map((p: any) => p.name)),
    );

    const byLegacyFilter = await anon.call("GET", "/api/products?category=Boites&limit=50");
    eq("the legacy name filter still answers", byLegacyFilter.json?.total, 2);

    const byUnknownName = await anon.call("GET", "/api/products?category=Inconnue&limit=50");
    eq("a name no category owns matches nothing", byUnknownName.json?.total, 0);

    const byUnknownId = await anon.call("GET", "/api/products?categoryId=999999&limit=50");
    eq("an id no category owns matches nothing", byUnknownId.json?.total, 0);

    const uncategorised = (all.json?.items ?? []).find((p: any) => p.id === unmatchedId);
    eq("the unmatched product is listed", uncategorised !== undefined, true);
    eq("  └ with a null category for the UI to label", uncategorised?.category, null);

    console.log("\n[4/8] a rename follows the link, and the old name stops matching");
    const renamed = await admin.call("PATCH", `/api/categories/${boxesId}`, { name: "Boites & Cartons" });
    eq("rename succeeds", renamed.status, 200);
    eq("  └ and returns the new name", renamed.json?.name, "Boites & Cartons");

    const afterRename = await anon.call("GET", "/api/products?limit=50");
    const linked = (afterRename.json?.items ?? []).filter((p: any) => p.categoryId === boxesId);
    eq("both products still link to the same id", linked.length, 2);
    check(
      "  └ and every one of them now displays the new name",
      linked.every((p: any) => p.category === "Boites & Cartons"),
      JSON.stringify(linked.map((p: any) => p.category)),
    );

    eq(
      "the old name no longer resolves",
      (await anon.call("GET", "/api/products?category=Boites&limit=50")).json?.total,
      0,
    );
    eq(
      "the new name does",
      (await anon.call("GET", "/api/products?category=Boites%20%26%20Cartons&limit=50")).json?.total,
      2,
    );

    console.log("\n[5/8] an unknown category id is refused, not written");
    const badProduct = await admin.upload("/api/products", {
      name: "Produit inconnu",
      description: "d",
      categoryId: "999999",
      quantity: "10",
      price: "10",
    });
    eq("product create with a dangling id is 400", badProduct.status, 400);
    eq("  └ and answers with the i18n key", badProduct.json?.message, "admin.error_category_unknown");

    const badPatch = await admin.call("PATCH", `/api/products/${unmatchedId}`, { categoryId: "abc" });
    eq("product patch with a non-numeric id is 400", badPatch.status, 400);
    eq("  └ and answers with the i18n key", badPatch.json?.message, "admin.error_category_unknown");

    const badShelf = await admin.call("POST", "/api/homepage-sections", {
      titleFr: "Rayon inconnu",
      type: "category",
      categoryId: 999999,
      maxProducts: 8,
      displayOrder: 10,
      enabled: true,
    });
    eq("a category shelf with a dangling id is 400", badShelf.status, 400);
    eq("  └ and answers with the i18n key", badShelf.json?.message, "admin.error_category_unknown");

    const noShelfCategory = await admin.call("POST", "/api/homepage-sections", {
      titleFr: "Rayon sans categorie",
      type: "category",
      categoryId: "",
      maxProducts: 8,
      displayOrder: 10,
      enabled: true,
    });
    eq("a category shelf with no category at all is 400", noShelfCategory.status, 400);
    eq(
      "  └ and names the field to fix",
      noShelfCategory.json?.message,
      "admin.homepage_error_category_required",
    );

    console.log("\n[6/8] a shelf and a promotion carry the same link");
    // Display order 5, not 10: migration 0006 seeds a "Nouveautés" shelf at 10,
    // and the seeded shelf would take this shelf's only product before it ran
    // (de-duplication is applied in display order), leaving this one empty and
    // therefore dropped from the public payload.
    const shelf = await admin.call("POST", "/api/homepage-sections", {
      titleFr: "Nos tableaux",
      type: "category",
      categoryId: shelfCat.json?.id,
      maxProducts: 8,
      displayOrder: 5,
      enabled: true,
    });
    eq("a category shelf is created", shelf.status, 201);
    eq("  └ storing the id", shelf.json?.categoryId, shelfCat.json?.id);
    eq("  └ and the joined name", shelf.json?.category, "Tableaux");

    // A shelf that matches nothing is dropped from the public payload, so the
    // category needs a product before the shelf can be observed rendering one.
    const shelfProduct = await admin.upload("/api/products", {
      name: "Tableau mural",
      description: "d",
      categoryId: shelfCat.json?.id,
      quantity: "4",
      price: "300",
    });
    eq("its product is created", shelfProduct.status, 201);

    const shelves = await anon.call("GET", "/api/homepage-sections");
    const rendered = (Array.isArray(shelves.json) ? shelves.json : []).find(
      (s: any) => s.id === shelf.json?.id,
    );
    check(
      "the public homepage carries the shelf",
      rendered !== undefined,
      rendered === undefined ? JSON.stringify((shelves.json ?? []).map((s: any) => s.titleFr)) : "",
    );
    eq("  └ showing the product of its category", rendered?.products?.[0]?.name, "Tableau mural");

    const adminShelves = await admin.call("GET", "/api/admin/homepage-sections");
    const adminRow = (Array.isArray(adminShelves.json) ? adminShelves.json : []).find(
      (s: any) => s.id === shelf.json?.id,
    );
    eq("the admin list reports the joined name too", adminRow?.category, "Tableaux");

    const promo = await admin.upload("/api/promos", {
      productName: "Tableau en promo",
      categoryId: promoCat.json?.id,
      description: "d",
    });
    eq("a promotion is created", promo.status, 201);
    eq("  └ storing the id", promo.json?.categoryId, promoCat.json?.id);
    eq("  └ and the joined name", promo.json?.category, "Fetes");

    const promos = await anon.call("GET", "/api/promos");
    const listedPromo = (Array.isArray(promos.json) ? promos.json : []).find((p: any) => p.id === promo.json?.id);
    eq("the public promo list reports the joined name", listedPromo?.category, "Fetes");

    // A shelf that renders nothing is still a reference to its category, and it
    // is the only shape whose blocking count is a shelf with no product behind
    // it - which the public payload deliberately drops, so it cannot be observed
    // from outside.
    const shelfOnly = await admin.call("POST", "/api/categories", { name: "Vide" });
    eq("a category for the shelf-only case is created", shelfOnly.status, 201);
    const emptyShelf = await admin.call("POST", "/api/homepage-sections", {
      titleFr: "Rayon sans produits",
      type: "category",
      categoryId: shelfOnly.json?.id,
      maxProducts: 8,
      displayOrder: 50,
      enabled: true,
    });
    eq("its shelf is created", emptyShelf.status, 201);

    console.log("\n[7/8] a category in use cannot be deleted");
    const anonDelete = await anon.call("DELETE", `/api/categories/${boxesId}`);
    eq("anonymous delete is 401", anonDelete.status, 401);
    const clientDelete = await client.call("DELETE", `/api/categories/${boxesId}`);
    eq("a client cannot delete", clientDelete.status, 403);
    eq("an unknown id is 404", (await admin.call("DELETE", "/api/categories/999999")).status, 404);
    eq("a non-numeric id is 400", (await admin.call("DELETE", "/api/categories/abc")).status, 400);

    const blockedByProduct = await admin.call("DELETE", `/api/categories/${boxesId}`);
    eq("a category with products is refused", blockedByProduct.status, 409);
    eq("  └ with the machine-readable code", blockedByProduct.json?.code, "category_in_use");
    eq("  └ and a product count, never a sentence", blockedByProduct.json?.counts?.products, 2);
    eq("  └ with no shelf count", blockedByProduct.json?.counts?.homepageSections, 0);
    eq("  └ and no promo count", blockedByProduct.json?.counts?.promos, 0);

    const blockedByShelf = await admin.call("DELETE", `/api/categories/${shelfCat.json?.id}`);
    eq("a category behind a working shelf is refused", blockedByShelf.status, 409);
    eq("  └ counting the shelf", blockedByShelf.json?.counts?.homepageSections, 1);
    eq("  └ and the product the shelf renders", blockedByShelf.json?.counts?.products, 1);

    const blockedByEmptyShelf = await admin.call("DELETE", `/api/categories/${shelfOnly.json?.id}`);
    eq("a category with only a shelf is refused", blockedByEmptyShelf.status, 409);
    eq("  └ counting the shelf", blockedByEmptyShelf.json?.counts?.homepageSections, 1);
    eq("  └ and no products", blockedByEmptyShelf.json?.counts?.products, 0);

    const blockedByPromo = await admin.call("DELETE", `/api/categories/${promoCat.json?.id}`);
    eq("a category with only a promotion is refused", blockedByPromo.status, 409);
    eq("  └ counting the promotion", blockedByPromo.json?.counts?.promos, 1);

    const stillThere = await anon.call("GET", "/api/categories");
    eq(
      "nothing was deleted by a refused attempt",
      (stillThere.json ?? []).length,
      5,
    );

    eq(
      "an unused category is deleted",
      (await admin.call("DELETE", `/api/categories/${freeCat.json?.id}`)).status,
      204,
    );
    const afterFree = await anon.call("GET", "/api/categories");
    eq("  └ and is gone from the list", (afterFree.json ?? []).length, 4);

    console.log("\n[8/8] the report lists what is left uncategorised");
    const report = await new Promise<{ code: number | null; out: string }>((resolve) => {
      const proc = spawn(process.execPath, [tsxCli, "scripts/category-report.ts"], {
        cwd: SERVER_ROOT,
        env: { ...process.env, ENV_FILE: CHILD_ENV_FILE },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      proc.stdout?.on("data", (d) => (out += d.toString()));
      proc.stderr?.on("data", (d) => (out += d.toString()));
      proc.on("close", (code) => resolve({ code, out }));
    });
    eq("the report exits cleanly", report.code, 0);
    check("  └ it counts the one uncategorised product", /Products with no category link \(1\)/.test(report.out), report.out.split("\n")[0]);
    check(
      "  └ and names the legacy text that matched nothing",
      report.out.includes("Inconnue"),
      "",
    );
    check(
      "  └ while the linked categories show their usage",
      report.out.includes("Boites & Cartons") && report.out.includes("Tableaux"),
      "",
    );
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (!child.killed) child.kill("SIGKILL");
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
    if (fs.existsSync(UPLOADS_DIR)) {
      for (const f of fs.readdirSync(UPLOADS_DIR)) {
        if (!beforeUploads.has(f)) fs.rmSync(path.join(UPLOADS_DIR, f), { force: true });
      }
    }
    console.log(`\n[cleanup] removed ${path.basename(THROWAWAY)} and any generated uploads`);
  }

  console.log(`\n[test:category-routes] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("[test:category-routes] failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[test:category-routes] crashed:", e);
  process.exit(1);
});
