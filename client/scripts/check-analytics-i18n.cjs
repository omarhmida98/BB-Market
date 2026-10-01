const fs = require("fs");
const path = require("path");

/**
 * Verify every `t()` key used across the client resolves in all three locales.
 *
 * A missing key renders as the raw string ("account.foo") instead of failing, so
 * neither the type checker nor the build catches it. This walks the component and
 * page sources for `t()` calls and resolves each key against fr/en/ar.
 *
 * Three cases need care, because a naive grep reports false results:
 *   - template-literal keys (`t(`account.timeline_${step}`)`) expand to dynamic
 *     names and are enumerated from candidate lists rather than grepped;
 *   - label tables whose values are keys (`t(LABEL_KEYS[v])`) never appear
 *     literally, so they are enumerated too;
 *   - plural base keys (`t("account.orders.count", { count })`) have no entry of
 *     their own - i18next appends a suffix chosen by `Intl.PluralRules`.
 *
 * The orphan checks at the bottom only cover namespaces this repository fully
 * owns through literal `t()` calls (analytics, admin, homepage and the auth-flow
 * pages), so an unread key is a real leftover rather than a key rendered from DB
 * content or a table.
 *
 * Paths are anchored to this file rather than the working directory, so it behaves
 * the same whether it is run as `npm run check:i18n -w client` (cwd is `client/`)
 * or from the repository root.
 */
const CLIENT_ROOT = path.resolve(__dirname, "..");
const rel = (p) => path.join(CLIENT_ROOT, p);

// Every source file, minus shadcn primitives (generic UI copy) and the dead
// Stickers/Print pages that are not part of the router.
const SRC_ROOT = rel("src");
const files = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "ui" || entry.name === "node_modules" || entry.name === "dist") continue;
      walk(full);
    } else if (/\.tsx?$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      const norm = full.replace(/\\/g, "/");
      if (/\/(Stickers|Print)\.tsx$/.test(norm)) continue;
      files.push(full);
    }
  }
})(SRC_ROOT);

const LOCALES = ["fr", "en", "ar"];

const bundles = {};
for (const loc of LOCALES) {
  bundles[loc] = JSON.parse(fs.readFileSync(rel(`src/lib/i18n/locales/${loc}.json`), "utf8"));
}

function resolve(bundle, key) {
  return key.split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), bundle);
}

/**
 * Template-interpolated names, as (base, concrete key) pairs.
 *
 * `admin.*` also has label tables whose values are i18n keys resolved through a
 * variable (`t(ADMIN_SORT_KEYS[v])`), which the literal-key scan cannot see. Those
 * tables are enumerated here so a key that is added to a table but not to all
 * three locales still fails the check.
 */
const DYNAMIC = [
  ["analytics.range_", ["today", "last7", "last30", "thisMonth", "custom"].map((r) => `analytics.range_${r}`)],
  ["admin.sort_", ["newest", "name_asc", "price_asc", "price_desc", "stock_asc", "stock_desc"].map((s) => `admin.sort_${s}`)],
  ["admin.social_field_", ["instagram", "facebook", "tiktok"].map((s) => `admin.social_field_${s}`)],
  ["admin.social_hint_", ["instagram", "facebook", "tiktok"].map((s) => `admin.social_hint_${s}`)],
  ["admin.status_", ["pending", "confirmed", "preparing", "ready", "delivered", "cancelled"].map((s) => `admin.status_${s}`)],
  ["admin.payment_", ["cash_on_delivery", "cash", "card", "bank_transfer", "online"].map((s) => `admin.payment_${s}`)],
  ["admin.stock_", ["all", "in"].map((s) => `admin.stock_${s}`)],
  // Homepage shelf types, language tabs and validation messages are all chosen
  // through a table (`t(HOMEPAGE_TYPE_LABEL_KEYS[v])`), so their keys never appear
  // literally and have to be enumerated.
  [
    "admin.homepage_type_",
    ["newest", "best_sellers", "low_stock", "promotions", "category", "price_under"].map(
      (t) => `admin.homepage_type_${t}`,
    ),
  ],
  ["admin.homepage_lang_", ["fr", "en", "ar"].map((l) => `admin.homepage_lang_${l}`)],
  [
    "admin.homepage_error_",
    ["generic", "title_required", "category_required", "price_required", "href_invalid"].map(
      (e) => `admin.homepage_error_${e}`,
    ),
  ],
];

const text = files.map((p) => fs.readFileSync(p, "utf8")).join("\n");

// Literal keys, plus the concrete expansions of dynamic ones.
const used = new Set();
// Plain `t("ns.key")` calls, any namespace.
for (const m of text.matchAll(/\b(?:t|i18n\.t)\(\s*"([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
// Keys chosen by a conditional inside the call, e.g.
// `t(variables.url ? "admin.social_link_saved" : "admin.social_link_removed", {...})`.
for (const m of text.matchAll(/\b(?:t|i18n\.t)\([^)]*?\?[^)]*?"([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"\s*:\s*"([a-z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)"/g)) {
  used.add(m[1]);
  used.add(m[2]);
}
for (const [_, keys] of DYNAMIC) for (const k of keys) used.add(k);

// Plural base keys whose concrete forms are checked by explicit enumeration. The
// three historical bases demand every form each locale's plural rules can ask
// for; the rest (auto-detected below) only guarantee `one`/`other`, with `other`
// acting as Arabic's fallback.
const PLURAL_BASES = ["analytics.in_orders", "admin.products_range", "admin.homepage_products_count"];
const pluralForms = { fr: ["one", "other"], en: ["one", "other"], ar: ["zero", "one", "two", "few", "many", "other"] };
let problems = 0;

for (const base of PLURAL_BASES) {
  if (!text.includes(`"${base}"`)) {
    console.error(`[FAIL] plural base ${base} is no longer used; drop it from PLURAL_BASES`);
    problems++;
    continue;
  }
  for (const loc of LOCALES) {
    for (const form of pluralForms[loc]) {
      const key = `${base}_${form}`;
      if (resolve(bundles[loc], key) === undefined) {
        console.error(`[FAIL] ${key} missing in ${loc}`);
        problems++;
      }
      if (loc === "fr") used.add(key);
    }
  }
}

// Auto-detected plural bases (e.g. `account.orders.count`): a used key with no
// entry of its own but with plural forms. Require `one`/`other` in fr+en and
// `other` in ar.
const autoForms = { fr: ["one", "other"], en: ["one", "other"], ar: ["other"] };
const autoPlural = new Set();
for (const key of used) {
  if (PLURAL_BASES.includes(key)) continue;
  if (resolve(bundles.fr, key) !== undefined) continue;
  if (resolve(bundles.fr, key + "_one") !== undefined || resolve(bundles.fr, key + "_other") !== undefined) {
    autoPlural.add(key);
  }
}
for (const base of autoPlural) {
  for (const loc of LOCALES) {
    for (const form of autoForms[loc]) {
      const key = `${base}_${form}`;
      if (resolve(bundles[loc], key) === undefined) {
        console.error(`[FAIL] ${key} missing in ${loc}`);
        problems++;
      }
    }
  }
}

for (const key of [...used].sort()) {
  // Plural base keys have no entry of their own; they were checked as suffixes above.
  if (PLURAL_BASES.includes(key) || autoPlural.has(key)) continue;
  const missing = LOCALES.filter((loc) => resolve(bundles[loc], key) === undefined);
  if (missing.length) {
    console.error(`[FAIL] ${key} missing in ${missing.join(", ")}`);
    problems++;
  }
}

/**
 * Orphan check: an unread key is either a leftover or a typo nothing will ever
 * catch. Only namespaces fully owned through literal `t()` calls are checked, so
 * keys rendered from DB content or label tables are never falsely flagged.
 * Arabic's extra plural forms are exempt because i18next, not the source, names
 * them.
 */
const ORPHAN_NAMESPACES = [
  "analytics",
  "admin",
  "homepage",
  "notifications",
  "forgot",
  "reset",
  "profile",
  "camera",
  "theme",
  "whatsapp",
  "common",
];

for (const ns of ORPHAN_NAMESPACES) {
  for (const loc of LOCALES) {
    const bundle = bundles[loc][ns];
    if (!bundle) continue;
    const arabicPlural = new Set(Object.keys(bundles.ar[ns] || {}).filter((k) => /_(zero|two|few|many)$/.test(k)));
    for (const key of Object.keys(bundle)) {
      const full = `${ns}.${key}`;
      if (used.has(full)) continue;
      if (arabicPlural.has(key)) continue;
      // Plural forms of a base that is itself registered as used.
      const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
      if (used.has(`${ns}.${base}`)) continue;
      console.error(`[WARN] ${loc}.${full} is never referenced`);
      problems++;
    }
  }
}

console.log(`[ok] ${used.size} keys resolved across ${LOCALES.length} locales, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
