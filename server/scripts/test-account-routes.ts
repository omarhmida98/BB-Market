/**
 * Route-level tests for the customer account / order history.
 *
 * Same shape as `test-promo-routes.ts`: the real server is spawned as a child
 * process against a throwaway SQLite database and driven over HTTP with real
 * session cookies, because the properties that matter here live in the SQL and
 * in the auth middleware rather than in any pure function.
 *
 * The rules under test:
 *
 *   - `/api/my-orders*` requires a session (401 otherwise);
 *   - a customer only ever sees rows whose `user_id` is their own, filtered in
 *     SQL rather than in JS;
 *   - another customer's order and a nonexistent id are both 404, so the
 *     endpoint cannot be used to probe which order ids exist;
 *   - guest orders (`user_id IS NULL`) never appear in a customer's history but
 *     are still fully visible to an admin through `GET /api/orders`;
 *   - order history renders the stored snapshot, so renaming, repricing or
 *     deleting a product afterwards does not rewrite what was billed;
 *   - rows written before the promotion feature have no `originalPrice` /
 *     `promoApplied`, and must serialise as "no promotion";
 *   - a status the server does not recognise serialises as "unknown" instead of
 *     being coerced into a step the store never recorded;
 *   - a customer cannot change an order status; only an admin can.
 *
 * Run: npm run test:account-routes -w server
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROWAWAY = path.join(SERVER_ROOT, "account_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.account-route-test");
// Spawn node against tsx's own entrypoint: a `.cmd` shim fails with EINVAL on
// Windows under Node 24.
const tsxCli = path.join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const PORT = 5198;
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
 * One cookie jar per identity. `cookie` as a module-level variable (the pattern
 * used by test-promo-routes) makes it impossible to assert "customer B cannot
 * see customer A's order" without carefully re-ordering the test body, because
 * the very next call would silently reuse A's session.
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
 * Seed data, written straight into SQLite.
 *
 * Going through the API would be slower and, worse, would only be able to
 * produce orders in states the checkout itself creates. The interesting rows
 * here — a guest order, a pre-promotion row, a status the server does not
 * recognise — cannot be made that way, and those are precisely the rows most
 * likely to be mishandled by the serialiser.
 */
/**
 * `better-sqlite3`'s `get()` is typed `unknown`, so every id lookup below would
 * otherwise need a cast. This keeps the fixture readable and fails loudly if a
 * lookup matches no row, which would otherwise surface much later as a
 * confusing "order not found" assertion failure.
 */
function idOf(db: any, sql: string, ...params: unknown[]): number {
  const row = db.prepare(sql).get(...params) as { id: number } | undefined;
  if (!row) throw new Error(`fixture lookup matched no row: ${sql} ${JSON.stringify(params)}`);
  return Number(row.id);
}

async function seed() {
  const { default: Database } = await import("better-sqlite3");
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
  // Customers get the `client` role: that is what `/api/register` and the Google
  // sign-in both hand out (see `resolvePublicRegistrationRole`), and it is what
  // makes the admin-only endpoints answer 403 below. The `orders.role` column
  // defaults to `admin`, so these rows must state the role explicitly — a fixture
  // that omitted it would silently create a shop admin.
  const users: [string, string, string, string | null, string, string][] = [
    ["acct_admin", "acct_admin@example.test", "Admin", "+21600000001", "admin_pw", "superadmin"],
    ["cust_a", "cust_a@example.test", "Alice", "+21600000002", "alice_pw", "client"],
    ["cust_b", "cust_b@example.test", "Bob", "+21600000003", "bob_pw", "client"],
    // No phone, the way a customer who registered without one looks.
    ["cust_empty", "cust_empty@example.test", "Eve", null, "eve_pw", "client"],
  ];
  for (const u of users) insertUser.run(u[0], u[1], u[2], u[3], await hashPassword(u[4]), u[5]);
  const userIds = Object.fromEntries(
    users.map((u) => [u[0], idOf(db, "select id from users where username = ?", u[0])]),
  ) as Record<string, number>;

  // One product. Its name and price are mutated later in the test to prove the
  // order snapshot does not follow the catalogue.
  db.prepare(
    "insert into products (name, description, image_url, category, quantity, price) values (?,?,?,?,?,?)",
  ).run("Produit Original", "d", "/original.png", "Cadeaux & Décor", 50, 50);
  const productId = idOf(db, "select id from products where name = ?", "Produit Original");

  const insertOrder = db.prepare(
    `insert into orders
       (user_id, customer_name, email, phone, address, notes, items_json,
        subtotal, total, fulfillment_method, delivery_fee, status, payment_method, created_at)
     values (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );

  // 1. Delivery, promotion applied, pending. Carries the promo snapshot fields.
  insertOrder.run(
    userIds.cust_a,
    "Alice",
    "cust_a@example.test",
    "+21600000002",
    "10 rue de Tunis",
    "Livrer avant 18h",
    JSON.stringify([
      {
        id: productId,
        name: "Produit Original",
        quantity: 2,
        price: 40,
        originalPrice: 50,
        promoApplied: true,
        imageUrl: "/original.png",
      },
    ]),
    "80",
    "87",
    "delivery",
    "7",
    "pending",
    "cash_on_delivery",
    1_700_000_000,
  );
  const promoOrderId = idOf(db, "select id from orders where user_id = ? and status = 'pending'", userIds.cust_a);

  // 2. Pickup, no promotion, confirmed. No address, as pickup does not collect one.
  insertOrder.run(
    userIds.cust_a,
    "Alice",
    "cust_a@example.test",
    "+21600000002",
    null,
    null,
    JSON.stringify([
      {
        id: productId,
        name: "Produit Original",
        quantity: 1,
        price: 50,
        originalPrice: 50,
        promoApplied: false,
        imageUrl: "/original.png",
      },
    ]),
    "50",
    "50",
    "pickup",
    "0",
    "confirmed",
    "pickup",
    1_700_000_100,
  );
  const pickupOrderId = idOf(db, "select id from orders where user_id = ? and status = 'confirmed'", userIds.cust_a);

  // 3. Cancelled. The timeline must not present the later steps as reached.
  insertOrder.run(
    userIds.cust_a,
    "Alice",
    "cust_a@example.test",
    "+21600000002",
    "10 rue de Tunis",
    null,
    JSON.stringify([
      {
        id: productId,
        name: "Produit Original",
        quantity: 1,
        price: 50,
        originalPrice: 50,
        promoApplied: false,
        imageUrl: "/original.png",
      },
    ]),
    "50",
    "57",
    "delivery",
    "7",
    "cancelled",
    "cash_on_delivery",
    1_700_000_200,
  );
  const cancelledOrderId = idOf(db, "select id from orders where user_id = ? and status = 'cancelled'", userIds.cust_a);

  // 4. A row from before the promotion feature: items_json has no
  //    originalPrice and no promoApplied, and no image either.
  insertOrder.run(
    userIds.cust_a,
    "Alice",
    "cust_a@example.test",
    "+21600000002",
    "5 rue de Sousse",
    null,
    JSON.stringify([{ id: productId, name: "Produit Original", quantity: 3, price: 50 }]),
    "150",
    "150",
    "delivery",
    "0",
    "delivered",
    "cash_on_delivery",
    1_700_000_300,
  );
  const legacyOrderId = idOf(db, "select id from orders where user_id = ? and status = 'delivered'", userIds.cust_a);

  // 5. Six item lines, 7 units in total: the list response is preview-capped at
  //    4 lines while itemCount must still report the full 7 units.
  const manyItems = Array.from({ length: 6 }, (_, i) => ({
    id: productId,
    name: `Ligne ${i + 1}`,
    quantity: i === 0 ? 2 : 1,
    price: 10,
    originalPrice: 10,
    promoApplied: false,
    imageUrl: null,
  }));
  insertOrder.run(
    userIds.cust_a,
    "Alice",
    "cust_a@example.test",
    "+21600000002",
    null,
    null,
    JSON.stringify(manyItems),
    "70",
    "70",
    "pickup",
    "0",
    // A status the server does not know: a row written by a newer version, or
    // edited by hand. It must serialise as "unknown", not as "pending".
    "awaiting_payment",
    "whatsapp",
    1_700_000_400,
  );
  const unknownStatusOrderId = idOf(db, "select id from orders where status = 'awaiting_payment'");

  // 6. Customer B's order. Must be invisible to Alice.
  insertOrder.run(
    userIds.cust_b,
    "Bob",
    "cust_b@example.test",
    "+21600000003",
    "7 rue de Gabes",
    null,
    JSON.stringify([
      {
        id: productId,
        name: "Produit Original",
        quantity: 1,
        price: 50,
        originalPrice: 50,
        promoApplied: false,
        imageUrl: "/original.png",
      },
    ]),
    "50",
    "57",
    "delivery",
    "7",
    "confirmed",
    "cash_on_delivery",
    1_700_000_500,
  );
  const bobOrderId = idOf(db, "select id from orders where user_id = ?", userIds.cust_b);

  // 7. Guest order: `user_id IS NULL`. Belongs to nobody, so it must not be
  //    attached to Alice's account, but the admin must still be able to manage it.
  insertOrder.run(
    null,
    "Visiteur",
    null,
    "+21600000009",
    "9 rue de Monastir",
    null,
    JSON.stringify([
      {
        id: productId,
        name: "Produit Original",
        quantity: 1,
        price: 50,
        originalPrice: 50,
        promoApplied: false,
        imageUrl: "/original.png",
      },
    ]),
    "50",
    "57",
    "delivery",
    "7",
    "pending",
    "cash_on_delivery",
    1_700_000_600,
  );
  const guestOrderId = idOf(db, "select id from orders where user_id is null");

  db.close();
  console.log(`[setup] ${journal.entries.length} migration(s), 4 users, 1 product, 7 orders`);
  return {
    productId,
    promoOrderId,
    pickupOrderId,
    cancelledOrderId,
    legacyOrderId,
    unknownStatusOrderId,
    bobOrderId,
    guestOrderId,
  };
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
      "# Generated by scripts/test-account-routes.ts. Never commit.",
      "DATABASE_URL=file:./account_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=account-route-test-secret",
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

    console.log("\n[1/7] anonymous access is rejected");
    eq("GET /api/my-orders is 401", (await anon.call("GET", "/api/my-orders")).status, 401);
    eq(
      "GET /api/my-orders/:id is 401",
      (await anon.call("GET", `/api/my-orders/${ids.promoOrderId}`)).status,
      401,
    );
    eq("GET /api/orders/my is 401", (await anon.call("GET", "/api/orders/my")).status, 401);
    eq("GET /api/orders is 401", (await anon.call("GET", "/api/orders")).status, 401);

    const aliceLogin = await alice.login("cust_a", "alice_pw");
    check("customer A can log in", aliceLogin.status === 200, `status=${aliceLogin.status}`);
    check("A received a session cookie", !!alice.cookie);
    check("customer B can log in", (await bob.login("cust_b", "bob_pw")).status === 200);
    check("customer E can log in", (await eve.login("cust_empty", "eve_pw")).status === 200);
    check("admin can log in", (await admin.login("acct_admin", "admin_pw")).status === 200);

    console.log("\n[2/7] a customer only ever sees their own orders");
    const list = await alice.call("GET", "/api/my-orders");
    eq("A's list responds 200", list.status, 200);
    const mine = (list.json ?? []) as any[];
    eq("A has 5 orders", mine.length, 5);
    eq(
      "A's orders are exactly A's rows",
      mine.map((o) => o.id).sort((a, b) => a - b),
      [ids.promoOrderId, ids.pickupOrderId, ids.cancelledOrderId, ids.legacyOrderId, ids.unknownStatusOrderId].sort(
        (a, b) => a - b,
      ),
    );
    check(
      "B's order is absent from A's list",
      !mine.some((o) => o.id === ids.bobOrderId),
      `bobOrderId=${ids.bobOrderId}`,
    );
    check(
      "the guest order is absent from A's list",
      !mine.some((o) => o.id === ids.guestOrderId),
      `guestOrderId=${ids.guestOrderId}`,
    );
    eq("a customer with no orders gets an empty list", (await eve.call("GET", "/api/my-orders")).json, []);

    // Alice is a `client`, i.e. an ordinary customer. The admin order list must
    // not be reachable from a customer session, or she would read everyone's
    // addresses and order history.
    eq("a customer gets 403 on the admin order list", (await alice.call("GET", "/api/orders")).status, 403);
    eq(
      "  └ so the admin list is not an alternate path to another customer's order",
      (await alice.call("GET", "/api/orders")).status !== 200,
      true,
    );
    // There is deliberately no `GET /api/orders/:id`: a single order is only
    // reachable through the owner-scoped customer route or the admin list, so
    // there is no un-scoped by-id route left to forget a role check on.
    eq("no un-scoped single-order GET route exists", (await admin.call("GET", `/api/orders/${ids.bobOrderId}`)).status, 404);

    console.log("\n[3/7] another customer's order is a 404, not a 403");
    const bobOrder = await alice.call("GET", `/api/my-orders/${ids.bobOrderId}`);
    eq("A reading B's order gets 404", bobOrder.status, 404);
    eq("  └ 404 body says nothing about ownership", bobOrder.json?.message, "Order not found");
    const guestOrder = await alice.call("GET", `/api/my-orders/${ids.guestOrderId}`);
    eq("A reading the guest order gets 404", guestOrder.status, 404);
    const missing = await alice.call("GET", "/api/my-orders/999999");
    eq("a nonexistent id also gets 404", missing.status, 404);
    eq(
      "both answers are byte-identical, so ids cannot be probed",
      JSON.stringify(bobOrder.json),
      JSON.stringify(missing.json),
    );
    const asString = await alice.call("GET", "/api/my-orders/not-a-number");
    eq("a non-numeric id is a malformed request, so 400", asString.status, 400);

    console.log("\n[4/7] guest orders stay available to admins");
    const adminList = await admin.call("GET", "/api/orders");
    eq("admin reads every order", adminList.status, 200);
    const allOrders = adminList.json as any[];
    eq("  └ all 7 orders are present", allOrders.length, 7);
    check(
      "  └ the guest order is one of them",
      allOrders.some((o) => o.id === ids.guestOrderId),
    );
    eq(
      "  └ the admin list keeps raw items_json, not the customer serializer",
      typeof allOrders[0].itemsJson,
      "string",
    );
    check(
      "  └ the admin list does not expose the customer-only orderNumber field",
      allOrders.every((o) => o.orderNumber === undefined),
    );

    console.log("\n[5/7] the detail route serves stored snapshots only");
    const promoDetail = await alice.call("GET", `/api/my-orders/${ids.promoOrderId}`);
    eq("A can read her own promo order", promoDetail.status, 200);
    const promo = promoDetail.json;
    eq("orderNumber is derived from the id", promo.orderNumber, `BBM-${String(ids.promoOrderId).padStart(4, "0")}`);
    eq("promo status is preserved", promo.status, "pending");
    eq("delivery method is preserved", promo.fulfillmentMethod, "delivery");
    eq("payment method is preserved", promo.paymentMethod, "cash_on_delivery");
    eq("delivery fee is preserved", promo.deliveryFee, 7);
    eq("subtotal is preserved", promo.subtotal, 80);
    eq("total is preserved", promo.total, 87);
    eq("address is preserved", promo.address, "10 rue de Tunis");
    eq("notes are preserved", promo.notes, "Livrer avant 18h");
    eq("one item line", promo.items.length, 1);
    eq("quantity is snapshotted", promo.items[0].quantity, 2);
    eq("the charged price is the promo price", promo.items[0].price, 40);
    eq("the list price is snapshotted too", promo.items[0].originalPrice, 50);
    eq("promoApplied is true", promo.items[0].promoApplied, true);
    eq("lineTotal is quantity x price", promo.items[0].lineTotal, 80);
    eq("itemCount counts units", promo.itemCount, 2);
    eq("createdAt is an ISO string", typeof promo.createdAt, "string");

    const pickupDetail = await alice.call("GET", `/api/my-orders/${ids.pickupOrderId}`);
    eq("pickup method is preserved", pickupDetail.json?.fulfillmentMethod, "pickup");
    eq("pickup has no delivery fee", pickupDetail.json?.deliveryFee, 0);
    eq("pickup keeps its null address", pickupDetail.json?.address, null);

    const cancelledDetail = await alice.call("GET", `/api/my-orders/${ids.cancelledOrderId}`);
    eq("cancelled status is preserved", cancelledDetail.json?.status, "cancelled");

    console.log("\n[6/7] pre-promotion rows and unrecognised statuses degrade safely");
    const legacy = (await alice.call("GET", `/api/my-orders/${ids.legacyOrderId}`)).json;
    eq("a row with no promo fields still parses", legacy?.items?.length, 1);
    eq("its originalPrice falls back to the paid price", legacy?.items?.[0]?.originalPrice, 50);
    eq("  └ so no savings can be claimed", legacy?.items?.[0]?.promoApplied, false);
    eq("its missing image becomes null", legacy?.items?.[0]?.imageUrl, null);
    eq("delivered status is preserved", legacy?.status, "delivered");

    const weird = (await alice.call("GET", `/api/my-orders/${ids.unknownStatusOrderId}`)).json;
    eq("an unknown status serialises as 'unknown'", weird?.status, "unknown");
    const unknownList = (await alice.call("GET", "/api/my-orders")).json as any[];
    check(
      "  └ and it is 'unknown' in the list too",
      unknownList.some((o) => o.id === ids.unknownStatusOrderId && o.status === "unknown"),
    );
    const preview = unknownList.find((o) => o.id === ids.unknownStatusOrderId);
    eq("the list previews at most 4 item lines", preview?.items?.length, 4);
    eq("  └ while itemCount still counts all 7 units", preview?.itemCount, 7);

    console.log("\n[7/7] history does not follow the catalogue, and status is admin-only");
    // Mutate the product A bought: rename it, reprice it, and give it a promo.
    // A correct implementation keeps showing the snapshot; a lazy one that
    // re-reads the catalogue would show the new values here.
    const { default: Database } = await import("better-sqlite3");
    const mutate = new Database(THROWAWAY);
    mutate
      .prepare("update products set name = ?, price = ?, promo_price = ?, promo_start = null, promo_end = null where id = ?")
      .run("Produit Renommé", 999, 700, ids.productId);
    mutate.close();

    const live = await anon.call("GET", `/api/products/${ids.productId}`);
    eq("the catalogue now says the product was renamed", live.json?.name, "Produit Renommé");
    eq("the catalogue now says a different price", live.json?.price, 999);

    const afterRename = (await alice.call("GET", `/api/my-orders/${ids.promoOrderId}`)).json;
    eq("history still shows the snapshotted name", afterRename?.items?.[0]?.name, "Produit Original");
    eq("history still shows the snapshotted charge", afterRename?.items?.[0]?.price, 40);
    eq("history still shows the snapshotted list price", afterRename?.items?.[0]?.originalPrice, 50);
    eq("history is unchanged after the rename", afterRename?.total, 87);

    // Delete the product outright. History must survive; only reorder, which
    // re-reads the catalogue, is affected.
    const del = new Database(THROWAWAY);
    del.prepare("delete from products where id = ?").run(ids.productId);
    del.close();
    eq("the product really is gone", (await anon.call("GET", `/api/products/${ids.productId}`)).status, 404);
    const afterDelete = (await alice.call("GET", `/api/my-orders/${ids.promoOrderId}`)).json;
    eq("history still renders after the product is deleted", afterDelete?.items?.[0]?.name, "Produit Original");
    eq("  └ at the charged price", afterDelete?.items?.[0]?.price, 40);

    eq(
      "A cannot change her own order status",
      (await alice.call("PATCH", `/api/orders/${ids.promoOrderId}/status`, { status: "delivered" })).status,
      403,
    );
    eq("anonymous cannot either", (await anon.call("PATCH", `/api/orders/${ids.promoOrderId}/status`, { status: "delivered" })).status, 401);
    const badStatus = await admin.call("PATCH", `/api/orders/${ids.promoOrderId}/status`, { status: "shipped" });
    eq("admin cannot set a status outside the allow-list", badStatus.status, 400);
    const promoted = await admin.call("PATCH", `/api/orders/${ids.promoOrderId}/status`, { status: "preparing" });
    eq("admin can advance the status", promoted.status, 200);
    const reread = (await alice.call("GET", `/api/my-orders/${ids.promoOrderId}`)).json;
    eq("the customer sees the admin's change", reread?.status, "preparing");

    const compat = await alice.call("GET", "/api/orders/my");
    eq("the legacy /api/orders/my route still answers 200", compat.status, 200);
    eq(
      "and agrees with /api/my-orders byte for byte",
      JSON.stringify(compat.json),
      JSON.stringify((await alice.call("GET", "/api/my-orders")).json),
    );
    eq("B still only sees his single order", ((await bob.call("GET", "/api/my-orders")).json as any[]).length, 1);
    eq("  └ and it is his own", ((await bob.call("GET", "/api/my-orders")).json as any[])[0]?.id, ids.bobOrderId);
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (!child.killed) child.kill("SIGKILL");
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
    console.log(`\n[cleanup] removed ${path.basename(THROWAWAY)}`);
  }

  console.log(`\n[test:account-routes] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("[test:account-routes] failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[test:account-routes] crashed:", e);
  process.exit(1);
});