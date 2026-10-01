/**
 * Route-level tests for product promotions.
 *
 * Spawns the real server (`tsx index.ts`) against a throwaway SQLite database
 * and drives it over HTTP with a real session cookie. The rules under test span
 * layers a unit test cannot reach:
 *
 *   - the PATCH merge in routes.ts: a price-only edit must be re-validated
 *     against the *stored* promo price, otherwise lowering the price leaves
 *     promo >= price and the row is silently inconsistent,
 *   - the SQL filter behind ?promo=active,
 *   - /api/orders repricing from the database while ignoring the client's price.
 *
 * The server runs as a child process rather than being imported: `backup.ts`
 * and `cloudinary_util.ts` import `log` from `index.js`, so importing routes.js
 * from here would load a second copy of the module graph and break tsx's
 * esbuild helpers. A child process also means the code under test is byte-for-byte
 * what runs in dev and production.
 *
 * Run: npm run test:promo-routes -w server
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROWAWAY = path.join(SERVER_ROOT, "promo_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.promo-route-test");
// Run the real server through tsx's own entrypoint rather than `npx tsx`:
// spawning a .cmd shim fails with EINVAL under Node 24 on Windows.
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

let cookie = "";

async function call(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: any; text: string }> {
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
}

/**
 * Product create is a multipart endpoint with a mandatory image, so JSON would
 * always fail on "Image is required".
 */
async function createProduct(fields: Record<string, unknown>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
  form.append("image", new Blob([Buffer.from("89504e470d0a1a0a", "hex")], { type: "image/png" }), "p.png");
  const res = await fetch(`${BASE}/api/products`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
    body: form,
  });
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

async function main() {
  for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);

  // Apply the real migration chain so the server boots against the same schema
  // it will see in production.
  const { default: Database } = await import("better-sqlite3");
  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const raw = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) raw.exec(stmt);
  }
  const { hashPassword } = await import("../auth.js");
  // `users` has no created_at column; only `products` carries one.
  raw
    .prepare("insert into users (username, email, password, role) values (?,?,?,?)")
    .run("promo_admin", "promo_admin@example.test", await hashPassword("promo_admin_pw"), "superadmin");
  const info = raw
    .prepare(
      "insert into products (name, description, image_url, category, quantity, price) values (?,?,?,?,?,?)",
    )
    .run("Produit test", "d", "/x.png", "Cadeaux & Décor", 10, 100);
  raw.close();
  const productId = Number(info.lastInsertRowid);
  console.log(
    `[setup] applied ${journal.entries.length} migration(s), seeded admin + product id=${productId}`,
  );

  const uploadsDir = path.join(SERVER_ROOT, "..", "public", "uploads");
  const beforeUploads = fs.existsSync(uploadsDir) ? new Set(fs.readdirSync(uploadsDir)) : new Set<string>();

  // `env.ts` loads the workspace `.env` with `override: true`, so exporting
  // DATABASE_URL into the child's environment is NOT enough: the real
  // `file:./bb_market.db` would win and the test would run against live data.
  // ENV_FILE is the documented escape hatch, so the child gets its own env file
  // and the workspace one is never read.
  const childEnvFile = CHILD_ENV_FILE;
  fs.writeFileSync(
    childEnvFile,
    [
      "# Generated by scripts/test-promo-routes.ts. Never commit.",
      "DATABASE_URL=file:./promo_rt.db",
      `PORT=${PORT}`,
      "HOST=127.0.0.1",
      "SESSION_SECRET=promo-route-test-secret",
      // Blank so the upload path skips Cloudinary and falls back to local disk.
      "CLOUDINARY_CLOUD_NAME=",
      "CLOUDINARY_API_KEY=",
      "CLOUDINARY_API_SECRET=",
      "",
    ].join("\n"),
  );

  const child: ChildProcess = spawn(process.execPath, [tsxCli, "index.ts"], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ENV_FILE: childEnvFile },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (d) => (serverLog += d.toString()));
  child.stderr?.on("data", (d) => (serverLog += d.toString()));

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

    console.log("\n[1/4] promotion writes require an admin session");
    eq("anonymous PATCH is rejected", (await call("PATCH", `/api/products/${productId}`, { promoPrice: 80 })).status, 401);
    eq("anonymous create is rejected", (await createProduct({ name: "x", price: 10, quantity: 1 })).status, 401);
    const login = await call("POST", "/api/login", { username: "promo_admin", password: "promo_admin_pw" });
    check("admin can log in", login.status === 200, `status=${login.status} ${login.text.slice(0, 80)}`);
    check("session cookie was issued", !!cookie);

    console.log("\n[2/4] create validates the promotion");
    const baseFields = { name: "Created", description: "d", category: "Cadeaux & Décor", quantity: 5, price: 100 };
    // Create answers 201 on success, 400 on a rejected promotion.
    for (const [label, promo, expectStatus] of [
      ["promo below price is accepted", { promoPrice: 80 }, 201],
      ["free item (0) is accepted", { promoPrice: 0 }, 201],
      ["promo equal to price is rejected", { promoPrice: 100 }, 400],
      ["promo above price is rejected", { promoPrice: 120 }, 400],
      ["negative promo is rejected", { promoPrice: -5 }, 400],
      ["end before start is rejected", { promoPrice: 50, promoStart: "2026-06-01T10:00", promoEnd: "2026-05-01T10:00" }, 400],
    ] as [string, Record<string, unknown>, number][]) {
      const r = await createProduct({ ...baseFields, ...promo });
      eq(label, r.status, expectStatus);
      if (expectStatus === 400) check(`  └ 400 explains why: ${label}`, !!r.json?.message, r.json?.message ?? r.text.slice(0, 60));
    }

    console.log("\n[3/4] PATCH re-validates against the stored promotion");
    const withPromo = await call("PATCH", `/api/products/${productId}`, { promoPrice: 80, promoStart: null, promoEnd: null });
    eq("setting a promo succeeds", withPromo.status, 200);
    eq("stored promo is 80", withPromo.json?.promoPrice, 80);

    // The regression this route covers: only `price` is sent, but the stored
    // promo must still be taken into account.
    const dropPrice = await call("PATCH", `/api/products/${productId}`, { price: 50 });
    eq("lowering price below the stored promo is rejected", dropPrice.status, 400);
    const after = await call("GET", `/api/products/${productId}`);
    eq("rejected edit left price at 100", after.json?.price, 100);
    eq("rejected edit left promo at 80", after.json?.promoPrice, 80);

    const raisePrice = await call("PATCH", `/api/products/${productId}`, { price: 120 });
    eq("raising price above the promo is accepted", raisePrice.status, 200);
    eq("price-only edit kept the promo", raisePrice.json?.promoPrice, 80);
    eq("price-only edit applied the new price", raisePrice.json?.price, 120);

    const cleared = await call("PATCH", `/api/products/${productId}`, { promoPrice: null, promoStart: null, promoEnd: null });
    eq("clearing the promo succeeds", cleared.status, 200);
    eq("promo is null after clear", cleared.json?.promoPrice, null);
    eq("price survived the clear", cleared.json?.price, 120);

    console.log("\n[4/4] ?promo=active filters in SQL and /api/orders reprices from the DB");
    const hour = 3_600_000;
    const fixtures: [string, unknown, unknown, unknown][] = [
      ["P-none", null, null, null],
      ["P-live", 80, null, null],
      ["P-future", 70, new Date(Date.now() + 48 * hour).toISOString(), null],
      ["P-ended", 60, new Date(Date.now() - 48 * hour).toISOString(), new Date(Date.now() - hour).toISOString()],
      ["P-window", 50, new Date(Date.now() - hour).toISOString(), new Date(Date.now() + hour).toISOString()],
      ["P-bad", 500, null, null],
    ];
    const ids: Record<string, number> = {};
    for (const [name, promoPrice, promoStart, promoEnd] of fixtures) {
      const r = await createProduct({
        ...baseFields,
        name,
        price: 100,
        promoPrice: promoPrice ?? "",
        promoStart: (promoStart as string) ?? "",
        promoEnd: (promoEnd as string) ?? "",
      });
      // P-bad carries promoPrice 500 at price 100, so create must refuse it
      // rather than persist an invalid offer.
      eq(`seeded ${name}`, r.status, name === "P-bad" ? 400 : 201);
      if (name !== "P-bad") ids[name] = r.json?.id;
    }

    const active = await call("GET", "/api/products?limit=50&promo=active");
    const activeItems = (active.json?.items ?? []) as any[];
    // Step 2 created two rows named "Created" (promo 80 and promo 0), which are
    // live and therefore expected here; only the P-* fixtures are named.
    eq(
      "promo=active returns only the live fixtures",
      activeItems.map((p) => p.name).filter((n: string) => n.startsWith("P-")).sort(),
      ["P-live", "P-window"],
    );
    eq(
      "no promo-free fixture leaked in",
      ["P-none", "P-future", "P-ended", "P-bad"].filter((n) => activeItems.some((p) => p.name === n)),
      [],
    );
    // 1 seeded + 2 accepted in step 2 + 5 accepted fixtures (P-bad was refused).
    eq("default filter still returns every product", (await call("GET", "/api/products?limit=50")).json?.total, 8);
    eq("invalid promo filter falls back instead of erroring", (await call("GET", "/api/products?limit=50&promo=bogus")).status, 200);

    // Checkout must ignore the price the client sends. `pickup` avoids needing an
    // address and keeps the delivery fee out of the assertions.
    const order = await call("POST", "/api/orders", {
      customerName: "Test",
      phone: "0000000000",
      fulfillmentMethod: "pickup",
      items: [
        { id: ids["P-live"], name: "P-live", quantity: 2, price: 1 },
        { id: ids["P-none"], name: "P-none", quantity: 1, price: 1 },
        { id: ids["P-ended"], name: "P-ended", quantity: 1, price: 1 },
        { id: ids["P-window"], name: "P-window", quantity: 3, price: 999999 },
      ],
    });
    check("order accepted", order.status === 200 || order.status === 201, `status=${order.status} ${order.text.slice(0, 160)}`);

    if (order.status === 200 || order.status === 201) {
      const checkDb = new Database(THROWAWAY, { readonly: true });
      const latest = checkDb.prepare("select * from orders order by id desc limit 1").get() as {
        items_json: string;
        subtotal: string;
      };
      checkDb.close();
      const items = JSON.parse(latest.items_json);
      const byName = (n: string) => items.find((i: any) => i.name === n);

      eq("client price ignored, promo applied", byName("P-live")?.price, 80);
      eq("original price snapshotted", byName("P-live")?.originalPrice, 100);
      eq("promoApplied flag set", byName("P-live")?.promoApplied, true);
      eq("no promo charged at list price", byName("P-none")?.price, 100);
      eq("promoApplied false without a promo", byName("P-none")?.promoApplied, false);
      eq("expired promo charged at list price", byName("P-ended")?.price, 100);
      eq("expired promo not flagged", byName("P-ended")?.promoApplied, false);
      eq("open window applied", byName("P-window")?.price, 50);
      // `subtotal` is a money column stored as TEXT, so compare numerically.
      eq("subtotal uses effective prices", Number(latest.subtotal), 80 * 2 + 100 + 100 + 50 * 3);
    }
  } finally {
    child.kill();
    await new Promise((r) => setTimeout(r, 800));
    if (!child.killed) child.kill("SIGKILL");
    for (const f of dbFiles()) if (fs.existsSync(f)) fs.rmSync(f);
    if (fs.existsSync(CHILD_ENV_FILE)) fs.rmSync(CHILD_ENV_FILE);
    if (fs.existsSync(uploadsDir)) {
      for (const f of fs.readdirSync(uploadsDir)) {
        if (!beforeUploads.has(f)) fs.rmSync(path.join(uploadsDir, f), { force: true });
      }
    }
    console.log(`\n[cleanup] removed ${path.basename(THROWAWAY)} and any generated uploads`);
  }

  console.log(`\n[test:promo-routes] ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("[test:promo-routes] failures:");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[test:promo-routes] crashed:", e);
  process.exit(1);
});