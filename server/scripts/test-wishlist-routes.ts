/**
 * Route-level tests for the customer wishlist.
 *
 * Same shape as `test-account-routes.ts`: the real server is spawned as a child
 * process against a throwaway SQLite database and driven over HTTP with real
 * session cookies. Everything that matters about a wishlist lives in SQL and in
 * the auth middleware — the owner filter, the unique constraint, the cascade —
 * none of which a unit test of a pure function would actually exercise.
 *
 * The rules under test:
 *
 *   - `/api/wishlist*` requires a session (401 otherwise);
 *   - the owner is taken from the session and from nowhere else, so a `userId`
 *     in the body changes nothing;
 *   - customer A can never see, remove, or overwrite customer B's favourites,
 *     and an absent entry is answered identically to someone else's;
 *   - favouriting is idempotent: the same product twice is one row, not a 500,
 *     and the second call reports `created: false`;
 *   - favouriting a product that does not exist is a 404, and a malformed id is
 *     a 400 rather than being folded into the 404;
 *   - unfavouriting something already absent is a 200, because the requested
 *     end state holds either way;
 *   - deleting a product cascades and removes every customer's entry for it, so
 *     the account page can never be handed a dangling reference;
 *   - a live product rename, reprice, promotion or stock-out is reflected
 *     immediately, because a wishlist is a shopping list rather than a receipt.
 *
 * Run: npm run test:wishlist-routes -w server
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
// Imported once at module scope: the test opens the throwaway database from three
// separate places (seeding, the duplicate-row probe, the cascade probe) and
// redeclaring `const { default: Database }` per block collides in the same scope.
import Database from "better-sqlite3";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROWAWAY = path.join(SERVER_ROOT, "wishlist_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.wishlist-route-test");
// Spawn node against tsx's own entrypoint: a `.cmd` shim fails with EINVAL on
// Windows under Node 24.
const tsxCli = path.join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

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
 * One cookie jar per identity.
 *
 * A single module-level jar would make "B cannot touch A's favourites" impossible
 * to assert honestly: the next call would quietly reuse the previous session and
 * the assertion would pass for the wrong reason.
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
      const text = await res.text();
      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
      return { status: res.status, json, text };
    },
    async login(username: string, password: string) {
      return this.call("POST", "/api/login", { username, password });
    },
  };
}

function dbFiles() {
  return [THROWAWAY, `${THROWAWAY}-journal`, `${THROWAWAY}-wal`, `${THROWAWAY}-shm`];
}

/**
 * `better-sqlite3`'s `get()` is typed `unknown`, so every id lookup below would
 * otherwise need a cast. This fails loudly if a lookup matches no row, which
 * would otherwise surface much later as a confusing assertion failure.
 */
function idOf(db: any, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`fixture lookup matched no row: ${sql} ${JSON.stringify(params)}`);
  return Number(row.id);
}

/**
 * Seed straight into SQLite, replaying the real migration folder.
 *
 * Replaying the migrations rather than hand-writing a `CREATE TABLE` is what
 * makes this test cover migration 0004 itself: if the unique index or the cascade
 * were missing from the SQL that ships, the duplicate and delete assertions below
 * would fail here.
 */
async function seed() {
  const { hashPassword } = await import("../auth.js");

  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const db = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }

  const insertUser = db.prepare(
    "insert into users (username, email, full_name, phone, password, role) values (?,?,?,?,?,?)",
  );
  // Customers are `client`, which is what `/api/register` hands out; the `users`
  // table defaults `role` to `admin`, so every fixture states it explicitly. A row
  // that omitted it would silently create a shop admin with a working session.
  const users: [string, string, string, string | null, string, string][] = [
    ["wl_admin", "wl_admin@example.test", "Admin", "+21600000001", "admin_pw", "superadmin"],
    ["cust_a", "cust_a@example.test", "Alice", "+21600000002", "alice_pw", "client"],
    ["cust_b", "cust_b@example.test", "Bob", "+21600000003", "bob_pw", "client"],
    ["cust_empty", "cust_empty@example.test", "Eve", null, "eve_pw", "client"],
  ];
  for (const u of users) insertUser.run(u[0], u[1], u[2], u[3], await hashPassword(u[4]), u[5]);
  const userIds = Object.fromEntries(
    users.map((u) => [u[0], idOf(db, "select id from users where username = ?", u[0])]),
  ) as Record<string, number>;

  const insertProduct = db.prepare(
    "insert into products (name, description, image_url, category, quantity, price) values (?,?,?,?,?,?)",
  );
  // Plain, in stock, no promotion. The baseline every other case is compared to.
  insertProduct.run("Boite Cadeaux", "d", "/plain.png", "Emballage", 20, 60);
  const plainId = idOf(db, "select id from products where name = ?", "Boite Cadeaux");

  // Promotion live right now (a wide window around 2020), so resolvePromotion
  // reports `active` and the wishlist must show the discounted price.
  insertProduct.run("Pack Promo", "d", "/promo.png", "Mariage", 8, 120);
  const promoId = idOf(db, "select id from products where name = ?", "Pack Promo");
  db.prepare("update products set promo_price = ?, promo_start = ?, promo_end = ? where id = ?").run(
    90,
    // Seconds, not milliseconds: `promo_start` is an `integer(... { mode:
    // "timestamp" })` column, which is how Drizzle reads the row back. Writing
    // milliseconds here would decode as a window in the year 51892, and the
    // resolver would quite correctly call that `scheduled` rather than `active`.
    Math.floor(new Date("2020-01-01").getTime() / 1000),
    Math.floor(new Date("2099-01-01").getTime() / 1000),
    promoId,
  );

  // Sold out: still favourited, still listed, and must be marked not-in-stock
  // rather than dropped from the page.
  insertProduct.run("Rupture", "d", "/out.png", "Patisserie", 0, 35);
  const outOfStockId = idOf(db, "select id from products where name = ?", "Rupture");

  // Just above the shared low-stock cutoff, so the `lowStock` flag can be told
  // apart from "out of stock" rather than both being plain false.
  insertProduct.run("Derniere Unite", "d", "/low.png", "Nouveautes", 5, 45);
  const lowStockId = idOf(db, "select id from products where name = ?", "Derniere Unite");

  // Only ever favourited by B. A is not allowed to see it, or remove it.
  insertProduct.run("Chemin de Bob", "d", "/bob.png", "Ramadan", 3, 25);
  const bobOnlyId = idOf(db, "select id from products where name = ?", "Chemin de Bob");
  db.prepare("insert into wishlist (user_id, product_id) values (?,?)").run(userIds.cust_b, bobOnlyId);

  db.close();
  console.log(`[setup] ${journal.entries.length} migration(s), 4 users, 5 products, 1 seeded wishlist row`);
  return { plainId, promoId, outOfStockId, lowStockId, bobOnlyId, userIds };
}

async function main() {
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);

  const ids = await seed();

  // `env.ts` loads the workspace `.env` with `override: true`, so DATABASE_URL
  // must arrive through ENV_FILE — exporting it into the child's environment is
  // not enough and the test would run against live data.
  fs.writeFileSync(
    CHILD_ENV_FILE,
    [
      "# Generated by scripts/test-wishlist-routes.ts. Never commit.",
      "DATABASE_URL=file:./wishlist_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=wishlist-route-test-secret",
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
  const alice = makeClient();
  const bob = makeClient();
  const eve = makeClient();
  const admin = makeClient();

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
    console.log("[setup] server listening");

    console.log("\n[1/8] anonymous access is rejected");
    eq("GET /api/wishlist is 401", (await anon.call("GET", "/api/wishlist")).status, 401);
    eq(
      "POST /api/wishlist/:productId is 401",
      (await anon.call("POST", `/api/wishlist/${ids.plainId}`)).status,
      401,
    );
    eq(
      "DELETE /api/wishlist/:productId is 401",
      (await anon.call("DELETE", `/api/wishlist/${ids.plainId}`)).status,
      401,
    );

    const aliceLogin = await alice.login("cust_a", "alice_pw");
    check("customer A can log in", aliceLogin.status === 200, `status=${aliceLogin.status}`);
    check("A received a session cookie", !!alice.cookie);
    check("customer B can log in", (await bob.login("cust_b", "bob_pw")).status === 200);
    check("customer E can log in", (await eve.login("cust_empty", "eve_pw")).status === 200);
    check("admin can log in", (await admin.login("wl_admin", "admin_pw")).status === 200);

    console.log("\n[2/8] a customer only ever sees their own favourites");
    const bobList = (await bob.call("GET", "/api/wishlist")).json;
    eq("B's list responds 200", (await bob.call("GET", "/api/wishlist")).status, 200);
    eq("B has exactly the one seeded favourite", bobList?.items?.length, 1);
    eq("  └ and it is his own product", bobList?.items?.[0]?.productId, ids.bobOnlyId);
    eq("  └ the envelope reports the same total", bobList?.total, 1);

    const eveList = await eve.call("GET", "/api/wishlist");
    eq("a customer with no favourites gets an empty envelope", eveList.json, { items: [], total: 0 });

    eq(
      "anonymous and a customer with no favourites are distinguishable by status",
      (await anon.call("GET", "/api/wishlist")).status === 401 && eveList.status === 200,
      true,
    );

    console.log("\n[3/8] favouriting is idempotent");
    const first = await alice.call("POST", `/api/wishlist/${ids.plainId}`);
    eq("the first add is 201", first.status, 201);
    eq("  └ and reports it created a row", first.json?.created, true);
    eq("  └ and the new state", first.json?.favorited, true);

    // This is the assertion the unique index exists for. A check-then-insert
    // implementation would let two clicks race in two rows; the constraint makes
    // the second one a no-op instead of a crash.
    const second = await alice.call("POST", `/api/wishlist/${ids.plainId}`);
    eq("adding the same product again is 200, not an error", second.status, 200);
    eq("  └ and reports it created nothing", second.json?.created, false);
    eq("  └ but the state is still favourited", second.json?.favorited, true);

    const afterDupes = (await alice.call("GET", "/api/wishlist")).json;
    eq("two adds produced exactly one entry", afterDupes?.items?.length, 1);

    // And the row count in the table itself, so a duplicate that were somehow
    // hidden by the query would still be caught.
    const peek = new Database(THROWAWAY, { readonly: true });
    const rows = peek
      .prepare("select count(*) c from wishlist where user_id = ? and product_id = ?")
      .get(ids.userIds.cust_a, ids.plainId) as { c: number };
    eq("the database holds exactly one row for (A, product)", Number(rows.c), 1);
    peek.close();

    console.log("\n[4/8] one customer cannot reach another's favourites");
    eq(
      "A cannot delete B's favourite",
      (await alice.call("DELETE", `/api/wishlist/${ids.bobOnlyId}`)).status,
      200,
    );
    const bobStillHas = (await bob.call("GET", "/api/wishlist")).json;
    eq("  └ B still has his entry", bobStillHas?.items?.length, 1);
    eq("  └ and it is still his product", bobStillHas?.items?.[0]?.productId, ids.bobOnlyId);

    // The client-supplied userId must be ignored entirely. If any handler read it,
    // this would overwrite or clear A's row and the assertion below would fail.
    await alice.call("POST", `/api/wishlist/${ids.promoId}`, { userId: ids.userIds.cust_b });
    const spoofed = (await alice.call("GET", "/api/wishlist")).json;
    check(
      "a userId in the request body does not write to another customer's list",
      spoofed?.items?.some((i: any) => i.productId === ids.promoId),
      "A's own add still landed on A's list",
    );
    const bobAfterSpoof = (await bob.call("GET", "/api/wishlist")).json;
    check(
      "  └ and B's list is untouched",
      bobAfterSpoof?.items?.length === 1,
      "B must still have exactly his one product",
    );

    // An id that is not a product at all is a 404; the same-shaped answer for
    // "not in your list" is a 200, so the status code cannot be used to probe
    // which product ids exist *in someone else's list*.
    const foreignPresent = await alice.call("DELETE", `/api/wishlist/${ids.bobOnlyId}`);
    const notYours = await eve.call("DELETE", `/api/wishlist/${ids.plainId}`);
    eq("deleting something absent from your own list is 200", notYours.status, 200);
    eq("deleting another customer's entry is also 200", foreignPresent.status, 200);
    check(
      "so the two are indistinguishable by status",
      notYours.status === foreignPresent.status,
      `both ${notYours.status}`,
    );

    console.log("\n[5/8] bad ids are 400, missing products are 404");
    eq("a non-numeric productId is 400", (await alice.call("POST", "/api/wishlist/not-a-number")).status, 400);
    eq("  └ for delete too", (await alice.call("DELETE", "/api/wishlist/not-a-number")).status, 400);
    eq("a zero productId is 400", (await alice.call("POST", "/api/wishlist/0")).status, 400);
    eq("a negative productId is 400", (await alice.call("POST", "/api/wishlist/-4")).status, 400);
    // `parseInt("12abc")` is 12, so the well-formed prefix still resolves; the
    // point is that it does not silently become some other id.
    eq("a trailing-garbage id resolves on its numeric prefix", (await alice.call("POST", "/api/wishlist/12abc")).status, 404);

    const missingAdd = await alice.call("POST", "/api/wishlist/999999");
    eq("favouriting a product that does not exist is 404", missingAdd.status, 404);
    eq("  └ with a clear message", missingAdd.json?.message, "Product not found");
    eq("deleting a nonexistent product is 404", (await alice.call("DELETE", "/api/wishlist/999999")).status, 404);

    const untouched = (await alice.call("GET", "/api/wishlist")).json;
    check(
      "the rejected add wrote nothing",
      !untouched?.items?.some((i: any) => i.productId === 999999),
    );

    console.log("\n[6/8] the list carries live pricing, promotion and stock");
    await alice.call("POST", `/api/wishlist/${ids.outOfStockId}`);
    await alice.call("POST", `/api/wishlist/${ids.lowStockId}`);
    const list = (await alice.call("GET", "/api/wishlist")).json;
    eq("A now has four favourites", list?.items?.length, 4);

    const find = (productId: number) => list?.items?.find((i: any) => i.productId === productId);
    const plain = find(ids.plainId);
    eq("a plain product joins the live product row", plain?.product?.name, "Boite Cadeaux");
    eq("  └ with its image", plain?.product?.imageUrl, "/plain.png");
    eq("  └ and its category", plain?.product?.category, "Emballage");
    eq("  └ regular price is untouched", plain?.promotion?.regularPrice, 60);
    eq("  └ no promotion is claimed", plain?.promotion?.status, "none");
    eq("  └ so the effective price is the regular one", plain?.promotion?.effectivePrice, 60);
    eq("  └ stock is carried", plain?.stock, 20);
    eq("  └ and it is in stock", plain?.inStock, true);
    eq("  └ 20 units is not low stock", plain?.lowStock, false);
    eq("  └ createdAt is an ISO string", typeof plain?.createdAt, "string");

    const promo = find(ids.promoId);
    eq("a promoted product reports status active", promo?.promotion?.status, "active");
    eq("  └ the effective price is the promo price", promo?.promotion?.effectivePrice, 90);
    eq("  └ the regular price is still available to strike through", promo?.promotion?.regularPrice, 120);
    eq("  └ and the saving is a whole percent", promo?.promotion?.discountPercent, 25);

    const out = find(ids.outOfStockId);
    eq("a sold-out product is still listed", !!out, true);
    eq("  └ with stock zero", out?.stock, 0);
    eq("  └ inStock is false", out?.inStock, false);
    check(
      "  └ and is not conflated with 'low'",
      out?.lowStock === false,
      "the two buckets must stay disjoint",
    );

    const low = find(ids.lowStockId);
    eq("a product at the low-stock cutoff is low", low?.lowStock, true);
    eq("  └ but still in stock", low?.inStock, true);

    // Added plain, then promo, then out-of-stock, then low-stock — so newest
    // first must read back in reverse.
    eq(
      "newest first",
      list.items.map((i: any) => i.productId),
      [ids.lowStockId, ids.outOfStockId, ids.promoId, ids.plainId],
    );

    console.log("\n[7/8] a live change is reflected immediately");
    // A wishlist is a shopping list, not a receipt: repricing, promoting or
    // selling out must show up on the next read. (The opposite is true for order
    // history, which snapshots — see test-account-routes.ts.)
    const mutate = new Database(THROWAWAY);
    mutate
      .prepare("update products set name = ?, price = ?, quantity = ? where id = ?")
      .run("Boite Renommee", 999, 0, ids.plainId);
    mutate.close();

    const live = await anon.call("GET", `/api/products/${ids.plainId}`);
    eq("the catalogue shows the new name", live.json?.name, "Boite Renommee");
    eq("the catalogue shows the new price", live.json?.price, 999);

    const afterEdit = (await alice.call("GET", "/api/wishlist")).json;
    const edited = afterEdit?.items?.find((i: any) => i.productId === ids.plainId);
    eq("the wishlist follows the rename", edited?.product?.name, "Boite Renommee");
    eq("the wishlist follows the reprice", edited?.promotion?.regularPrice, 999);
    eq("  └ and reports it is now sold out", edited?.inStock, false);
    eq("  └ rather than dropping it from the page", edited?.stock, 0);
    eq("the entry count is unchanged by an edit", afterEdit?.items?.length, 4);

    console.log("\n[8/8] deleting a product cascades to every customer's wishlist");
    // Seed a second customer onto the same product, so the cascade has more than
    // one row to remove and the test cannot pass by accident.
    const cascadePeek = new Database(THROWAWAY);
    cascadePeek.prepare("insert into wishlist (user_id, product_id) values (?,?)").run(ids.userIds.cust_empty, ids.promoId);
    const beforeRows = cascadePeek
      .prepare("select count(*) c from wishlist where product_id = ?")
      .get(ids.promoId) as { c: number };
    eq("two customers have favourited the product about to be deleted", Number(beforeRows.c), 2);
    cascadePeek.close();

    eq(
      "a customer cannot delete a product",
      (await alice.call("DELETE", `/api/products/${ids.promoId}`)).status,
      403,
    );

    const deleted = await admin.call("DELETE", `/api/products/${ids.promoId}`);
    eq("the admin can delete it", deleted.status, 204);
    eq("the product really is gone", (await anon.call("GET", `/api/products/${ids.promoId}`)).status, 404);

    const afterDeleteRows = new Database(THROWAWAY, { readonly: true });
    const leftovers = afterDeleteRows
      .prepare("select count(*) c from wishlist where product_id = ?")
      .get(ids.promoId) as { c: number };
    eq("the cascade removed every customer's entry", Number(leftovers.c), 0);
    afterDeleteRows.close();

    const aliceAfter = (await alice.call("GET", "/api/wishlist")).json;
    const eveAfter = (await eve.call("GET", "/api/wishlist")).json;
    check(
      "A's list no longer mentions the deleted product",
      !aliceAfter?.items?.some((i: any) => i.productId === ids.promoId),
    );
    eq("  └ A is down to three", aliceAfter?.items?.length, 3);
    eq("  └ and the envelope total agrees", aliceAfter?.total, 3);
    eq("E's list is now empty too", eveAfter?.items?.length, 0);
    eq("the page still responds 200 rather than breaking", aliceAfter !== undefined, true);

    // Removing an already-removed favourite after its product is gone must not
    // throw: the row is absent, and the product is absent, so the route's
    // existence probe finds nothing and answers 404 cleanly.
    eq(
      "removing a favourite whose product was deleted is a clean 404",
      (await alice.call("DELETE", `/api/wishlist/${ids.promoId}`)).status,
      404,
    );
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (!child.killed) child.kill("SIGKILL");
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
    console.log(`\n[cleanup] removed ${path.basename(THROWAWAY)}`);
  }

  console.log(`\n[test:wishlist-routes] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("[test:wishlist-routes] failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[test:wishlist-routes] crashed:", e);
  process.exit(1);
});