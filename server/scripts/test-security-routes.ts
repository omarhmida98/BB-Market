/**
 * Route-level security regression tests.
 *
 * Same shape as `test-wishlist-routes.ts`: the real server is spawned as a child
 * process against a throwaway SQLite database (`security_rt.db`, gitignored) and
 * driven over HTTP with real session cookies. These rules live in the route
 * middleware and in the password-reset handler, none of which a unit test would
 * exercise.
 *
 * The rules under test (each maps to an audit finding that was fixed):
 *
 *   C1 — `selectedItems` from a contact message is never evaluated as code. A
 *        payload that would terminate the process if `eval`'d leaves the server
 *        running; malformed JSON fails safely to "no items"; valid JSON still
 *        drives the stock deduction.
 *   C2 — `/api/reset-password` requires a full, exact, unexpired token. No
 *        email-only path, no prefix match; a valid token works once and is then
 *        cleared.
 *   H1–H5 — message-status, settings, stickers (image + CRUD) and promo
 *        edit/delete are admin-only: a customer gets 403, an anonymous caller
 *        401, and an admin still succeeds.
 *   M1 — `resetToken`/`resetTokenExpires` never appear in any user payload
 *        (register, login, /api/user, /api/admin/users), even when a token is set.
 *   M2 — login and the password-reset endpoints are rate limited: normal use is
 *        unaffected (a correct login and a single reset request succeed), a burst
 *        is throttled with 429.
 *
 * Run: npm run test:security-routes -w server
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import Database from "better-sqlite3";

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const THROWAWAY = path.join(SERVER_ROOT, "security_rt.db");
const CHILD_ENV_FILE = path.join(SERVER_ROOT, ".env.security-route-test");
const UPLOADS_DIR = path.join(SERVER_ROOT, "security_rt_uploads");
const tsxCli = path.join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs");
const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;

const ADMIN = { username: "sec_admin", password: "Admin-Pw-123!" };
const CUST_A = { username: "sec_a", email: "sec_a@example.test", password: "Alice-Pw-123!" };

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

/** A 1x1 PNG, enough to pass the image content/extension checks. */
const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f80f00010101005a4d6ff40000000049454e44ae426082",
  "hex",
);

function makeClient() {
  let cookie = "";
  async function send(method: string, url: string, init: RequestInit) {
    const res = await fetch(`${BASE}${url}`, {
      method,
      ...init,
      headers: { ...(cookie ? { cookie } : {}), ...(init.headers || {}) },
    });
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = undefined; }
    return { status: res.status, json, text };
  }
  return {
    get cookie() { return cookie; },
    call(method: string, url: string, body?: unknown) {
      return send(method, url, {
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    upload(method: string, url: string, field: string, fields: Record<string, string> = {}) {
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v);
      form.append(field, new Blob([PNG_1x1], { type: "image/png" }), "pixel.png");
      return send(method, url, { body: form });
    },
    login(username: string, password: string) {
      return this.call("POST", "/api/login", { username, password });
    },
  };
}
type Client = ReturnType<typeof makeClient>;

async function seed() {
  const { hashPassword } = await import("../auth.js");
  const folder = path.join(SERVER_ROOT, "migrations/sqlite");
  const journal = JSON.parse(fs.readFileSync(path.join(folder, "meta/_journal.json"), "utf8"));
  const db = new Database(THROWAWAY);
  for (const entry of journal.entries) {
    const sql = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) if (stmt.trim()) db.exec(stmt);
  }
  const insertUser = db.prepare("insert into users (username, email, full_name, phone, password, role) values (?,?,?,?,?,?)");
  insertUser.run(ADMIN.username, "sec_admin@example.test", "Admin", "+21600000001", await hashPassword(ADMIN.password), "superadmin");
  insertUser.run(CUST_A.username, CUST_A.email, "Alice", "+21600000002", await hashPassword(CUST_A.password), "client");
  db.prepare("insert into settings (delivery_fee, free_delivery_threshold) values (?, ?)").run("7", "100");
  db.close();
}

/** Directly set/clear a reset token on the throwaway DB (simulates "email sent"). */
function setResetToken(email: string, token: string | null, expiresEpochSec: number | null) {
  const db = new Database(THROWAWAY);
  db.prepare("update users set reset_token = ?, reset_token_expires = ? where email = ?").run(token, expiresEpochSec, email);
  db.close();
}
function productQuantity(id: number): number {
  const db = new Database(THROWAWAY, { readonly: true });
  const row = db.prepare("select quantity from products where id = ?").get(id) as { quantity: number } | undefined;
  db.close();
  return row ? Number(row.quantity) : -1;
}
function settingsSnapshot() {
  const db = new Database(THROWAWAY, { readonly: true });
  const row = db.prepare("select delivery_fee, stickers_image_url from settings limit 1").get();
  db.close();
  return JSON.stringify(row);
}

function writeEnv(extra: string[]) {
  fs.writeFileSync(CHILD_ENV_FILE, [
    "# Generated by scripts/test-security-routes.ts. Never commit.",
    "DATABASE_URL=file:./security_rt.db",
    "UPLOADS_DIR=./security_rt_uploads",
    `PORT=${PORT}`,
    "HOST=127.0.0.1",
    "SESSION_SECRET=security-route-test-secret",
    "CLOUDINARY_CLOUD_NAME=",
    "CLOUDINARY_API_KEY=",
    "CLOUDINARY_API_SECRET=",
    ...extra,
    "",
  ].join("\n"));
}

async function startServer(extra: string[]): Promise<{ child: ChildProcess; log: () => string }> {
  writeEnv(extra);
  const child = spawn(process.execPath, [tsxCli, "index.ts"], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ENV_FILE: CHILD_ENV_FILE },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  child.stdout?.on("data", (d) => (serverLog += d.toString()));
  child.stderr?.on("data", (d) => (serverLog += d.toString()));
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try { if ((await fetch(`${BASE}/api/health`)).ok) up = true; } catch { /* not yet */ }
  }
  if (!up) { child.kill("SIGKILL"); throw new Error(`server never came up:\n${serverLog}`); }
  return { child, log: () => serverLog };
}
async function stopServer(child: ChildProcess) {
  child.kill();
  await new Promise((r) => setTimeout(r, 400));
  if (!child.killed) child.kill("SIGKILL");
  // The child owns the SQLite file; give the OS a moment to release the handle.
  await new Promise((r) => setTimeout(r, 400));
}

async function serverUp(): Promise<boolean> {
  try { return (await fetch(`${BASE}/api/health`)).ok; } catch { return false; }
}

/** Keys that must never leave the server inside a user object. */
function leaksSecrets(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false;
  return "password" in obj || "resetToken" in obj || "resetTokenExpires" in obj;
}

async function runFunctional() {
  const anon = makeClient();
  const admin = makeClient();
  const a = makeClient();

  const reg = await a.call("POST", "/api/register", { username: CUST_A.username + "_new", email: "sec_a_new@example.test", password: CUST_A.password });
  await admin.login(ADMIN.username, ADMIN.password);
  const loginA = await a.login(CUST_A.username, CUST_A.password);

  // ---- M1 — reset token never in user payloads
  console.log("\n[M1] reset tokens never appear in user responses");
  check("11. register response hides password/resetToken", reg.status === 201 && !leaksSecrets(reg.json), Object.keys(reg.json || {}).join(","));
  check("11. login response hides password/resetToken", loginA.status === 200 && !leaksSecrets(loginA.json));
  setResetToken(CUST_A.email, "VISIBLE_TOKEN_MARKER", Math.floor(Date.now() / 1000) + 600);
  const me = await a.call("GET", "/api/user");
  check("11. /api/user hides resetToken even when one is set", !leaksSecrets(me.json) && !JSON.stringify(me.json).includes("VISIBLE_TOKEN_MARKER"), Object.keys(me.json || {}).join(","));
  const adminUsers = await admin.call("GET", "/api/admin/users");
  const anyLeak = Array.isArray(adminUsers.json) && adminUsers.json.some(leaksSecrets);
  check("11. /api/admin/users hides password/resetToken for every row", adminUsers.status === 200 && !anyLeak && !adminUsers.text.includes("VISIBLE_TOKEN_MARKER"));
  setResetToken(CUST_A.email, null, null);

  // ---- C2 — reset-password token enforcement
  console.log("\n[C2] reset-password requires a full, exact, unexpired token");
  const tok = crypto.randomBytes(32).toString("hex");
  const canLogin = async (pw: string) => (await makeClient().login(CUST_A.username, pw)).status === 200;
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) + 600);
  check("3. reset WITHOUT a token -> 400, password unchanged", (await anon.call("POST", "/api/reset-password", { email: CUST_A.email, newPassword: "NoTok-1!" })).status === 400 && !(await canLogin("NoTok-1!")));
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) + 600);
  check("4. WRONG full-length token -> 400", (await anon.call("POST", "/api/reset-password", { token: crypto.randomBytes(32).toString("hex"), newPassword: "Wrong-1!" })).status === 400 && !(await canLogin("Wrong-1!")));
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) + 600);
  check("5. PARTIAL (prefix) token -> 400", (await anon.call("POST", "/api/reset-password", { token: tok.slice(0, 12), newPassword: "Prefix-1!" })).status === 400 && !(await canLogin("Prefix-1!")));
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) - 60);
  check("6. EXPIRED token -> 400", (await anon.call("POST", "/api/reset-password", { token: tok, newPassword: "Expired-1!" })).status === 400 && !(await canLogin("Expired-1!")));
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) + 600);
  const valid = await anon.call("POST", "/api/reset-password", { token: tok, newPassword: "Valid-Reset-1!" });
  check("7. VALID full token -> 200 and password changed", valid.status === 200 && (await canLogin("Valid-Reset-1!")));
  check("8. token cannot be REUSED -> 400", (await anon.call("POST", "/api/reset-password", { token: tok, newPassword: "Reuse-1!" })).status === 400 && !(await canLogin("Reuse-1!")));
  // restore password
  setResetToken(CUST_A.email, tok, Math.floor(Date.now() / 1000) + 600);
  await anon.call("POST", "/api/reset-password", { token: tok, newPassword: CUST_A.password });
  await a.login(CUST_A.username, CUST_A.password);

  // ---- H1–H5 — admin-only enforcement
  console.log("\n[H1-H5] admin-only routes reject customers, allow admins");
  const prod = await admin.upload("POST", "/api/products", "image", { name: "SecProd", description: "d", category: "SecCat", quantity: "10", price: "5" });
  const promo = await admin.upload("POST", "/api/promos", "image", { productName: "SecPromo", category: "SecCat", description: "d" });
  const sticker = await admin.upload("POST", "/api/stickers", "image", { title: "SecSticker", description: "d" });
  const pid = prod.json?.id, promoId = promo.json?.id, stickerId = sticker.json?.id;
  check("10. admin can create product/promo/sticker (upload paths work)", prod.status < 300 && promo.status < 300 && sticker.status < 300 && !!pid && !!promoId && !!stickerId, `p=${pid} promo=${promoId} sticker=${stickerId}`);

  const custMsg = await a.call("POST", "/api/messages", { name: "A", phone: "20111111", message: "order", selectedItems: JSON.stringify([{ id: pid, quantity: 2 }]) });
  const msgId = custMsg.json?.id;

  const before = settingsSnapshot();
  const guarded: [string, string, string][] = [
    ["H1 message status", "PATCH", `/api/messages/${msgId}/status`],
    ["H2 settings", "PATCH", "/api/settings"],
    ["H4 sticker patch", "PATCH", `/api/stickers/${stickerId}`],
    ["H4 sticker delete", "DELETE", `/api/stickers/${stickerId}`],
    ["H5 promo patch", "PATCH", `/api/promos/${promoId}`],
    ["H5 promo delete", "DELETE", `/api/promos/${promoId}`],
  ];
  for (const [name, method, url] of guarded) {
    const body = method === "DELETE" ? undefined : { status: "approved", deliveryFee: 9, title: "hack", productName: "hack" };
    const cRes = await a.call(method, url, body);
    const aRes = await anon.call(method, url, body);
    check(`9. ${name}: customer 403, anon 401`, cRes.status === 403 && aRes.status === 401, `cust ${cRes.status}, anon ${aRes.status}`);
  }
  // upload routes (multipart) H3 + H4-create
  for (const [name, url, field] of [["H3 stickers-image", "/api/settings/stickers-image", "stickersImage"], ["H4 sticker create", "/api/stickers", "image"]] as const) {
    const cRes = await a.upload(url.includes("settings") ? "PATCH" : "POST", url, field, { title: "x", description: "d" });
    const aRes = await anon.upload(url.includes("settings") ? "PATCH" : "POST", url, field, { title: "x", description: "d" });
    check(`9. ${name} (upload): customer 403, anon 401`, cRes.status === 403 && aRes.status === 401, `cust ${cRes.status}, anon ${aRes.status}`);
  }
  check("9b. customer attempts did not change settings", before === settingsSnapshot());

  // admin can still use them
  const stockBefore = productQuantity(pid);
  const aMsg = await admin.call("PATCH", `/api/messages/${msgId}/status`, { status: "approved" });
  check("10. admin can approve a message (H1); stock deducted by 2", aMsg.status === 200 && stockBefore - productQuantity(pid) === 2, `${stockBefore} -> ${productQuantity(pid)}`);
  check("10. admin can patch settings (H2)", (await admin.call("PATCH", "/api/settings", { deliveryFee: 7 })).status === 200);
  check("10. admin can upload stickers image (H3)", (await admin.upload("PATCH", "/api/settings/stickers-image", "stickersImage")).status === 200);
  check("10. admin can patch sticker (H4)", (await admin.call("PATCH", `/api/stickers/${stickerId}`, { title: "ok" })).status === 200);
  check("10. admin can delete sticker (H4)", (await admin.call("DELETE", `/api/stickers/${stickerId}`)).status === 204);
  const aPromo = await admin.call("PATCH", `/api/promos/${promoId}`, { productName: "ok" });
  check("10. admin can patch+delete promo (H5)", (aPromo.status === 200 || aPromo.status === 204) && (await admin.call("DELETE", `/api/promos/${promoId}`)).status === 204);

  // ---- C1 — selectedItems is never executed
  console.log("\n[C1] customer-supplied selectedItems is never executed");
  check("1a. server is up before the code-execution check", await serverUp());
  const mExec = await a.call("POST", "/api/messages", { name: "A", phone: "20111111", message: "x", selectedItems: "process.exit(99)" });
  await admin.call("PATCH", `/api/messages/${mExec.json.id}/status`, { status: "approved" });
  await new Promise((r) => setTimeout(r, 700));
  check("1. malicious selectedItems did NOT execute (server still alive after approval)", await serverUp());
  const sBad = productQuantity(pid);
  const mBad = await a.call("POST", "/api/messages", { name: "A", phone: "20111111", message: "x", selectedItems: "{ not : json ]" });
  const badApprove = await admin.call("PATCH", `/api/messages/${mBad.json.id}/status`, { status: "approved" });
  check("2. malformed selectedItems fails safely (200, no crash, stock untouched)", badApprove.status === 200 && sBad === productQuantity(pid) && (await serverUp()));
  const sGood = productQuantity(pid);
  const mGood = await a.call("POST", "/api/messages", { name: "A", phone: "20111111", message: "x", selectedItems: JSON.stringify([{ id: pid, quantity: 1 }]) });
  await admin.call("PATCH", `/api/messages/${mGood.json.id}/status`, { status: "approved" });
  check("2b. valid JSON selectedItems still deducts stock (by 1)", sGood - productQuantity(pid) === 1, `${sGood} -> ${productQuantity(pid)}`);
}

async function runRateLimits() {
  console.log("\n[M2] rate limiting (server started with AUTH/RESET max = 3)");
  const okFirst = (await makeClient().login(ADMIN.username, ADMIN.password)).status;
  check("12a. a correct login works before any abuse (200)", okFirst === 200, String(okFirst));
  const attempts: number[] = [];
  for (let i = 0; i < 7; i++) attempts.push((await makeClient().login(ADMIN.username, "wrong" + i)).status);
  const first429 = attempts.indexOf(429);
  check("12b. repeated wrong-password logins are throttled (429 appears)", attempts.includes(429), attempts.join(","));
  check("12c. throttle triggers after ~3 failures, not on the first", first429 >= 3 && first429 <= 5, "first 429 at " + first429);

  const okForgot = (await fetch(`${BASE}/api/forgot-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.test" }) })).status;
  check("12d. a single forgot-password request works (200)", okForgot === 200, String(okForgot));
  const burst: number[] = [okForgot];
  for (let i = 0; i < 7; i++) burst.push((await fetch(`${BASE}/api/forgot-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "nobody@example.test" }) })).status);
  check("12e. password-reset endpoints are throttled under a burst (429)", burst.includes(429), burst.join(","));
  const limitedReset = (await fetch(`${BASE}/api/reset-password`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "x".repeat(64), newPassword: "Whatever-1!" }) })).status;
  check("12f. reset-password shares the limiter (429 once tripped)", limitedReset === 429, String(limitedReset));
}

function cleanupFiles() {
  for (const f of [THROWAWAY, `${THROWAWAY}-journal`, `${THROWAWAY}-wal`, `${THROWAWAY}-shm`, CHILD_ENV_FILE]) {
    if (fs.existsSync(f)) { try { fs.rmSync(f); } catch { /* handle still closing */ } }
  }
  if (fs.existsSync(UPLOADS_DIR)) { try { fs.rmSync(UPLOADS_DIR, { recursive: true, force: true }); } catch { /* ignore */ } }
}

async function main() {
  cleanupFiles();
  await seed();

  // Phase 1: functional tests with rate limiting disabled, so the many logins
  // and reset calls the suite makes do not trip the limiter.
  let server = await startServer(["DISABLE_RATE_LIMIT=1"]);
  try {
    await runFunctional();
  } finally {
    await stopServer(server.child);
  }

  // Phase 2: rate-limit tests with tiny limits, on the same throwaway DB.
  server = await startServer(["AUTH_RATE_LIMIT_MAX=3", "PASSWORD_RESET_RATE_LIMIT_MAX=3"]);
  try {
    await runRateLimits();
  } finally {
    await stopServer(server.child);
  }

  cleanupFiles();
  console.log(`\n[security] ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failures:\n  " + failures.join("\n  "));
  console.log(`[cleanup] removed ${path.basename(THROWAWAY)}`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  cleanupFiles();
  process.exit(1);
});
