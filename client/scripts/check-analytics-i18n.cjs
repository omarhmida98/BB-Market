const fs = require("fs");
const path = require("path");

/**
 * Verify every `t()` key used by the analytics dashboard resolves in all three
 * locales.
 *
 * A missing key renders as the raw string ("analytics.revenue") instead of
 * failing, so neither the type checker nor the build catches it, and the page is
 * only reachable after logging in as an admin. This walks the component sources for
 * `t()` calls and resolves each key.
 *
 * The first version of this script reported false results, so two cases matter:
 * template-literal keys (`t(`analytics.range_${range}`)`) expand to dynamic names and
 * must be enumerated from the candidate list rather than grepped, and the plural base
 * key (`analytics.in_orders`) is not itself a real key - i18next appends a suffix
 * chosen by `Intl.PluralRules`.
 *
 * Paths are anchored to this file rather than the working directory, so it behaves the
 * same whether it is run as `npm run check:i18n -w client` (cwd is `client/`) or from
 * the repository root.
 */
const CLIENT_ROOT = path.resolve(__dirname, "..");
const rel = (p) => path.join(CLIENT_ROOT, p);

const SRC = [
  "src/components/admin/AdminAnalytics.tsx",
  "src/components/admin/AnalyticsCharts.tsx",
  "src/pages/AdminMarket.tsx",
];
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
];

const text = SRC.map((p) => fs.readFileSync(rel(p), "utf8")).join("\n");

// Literal keys, plus the concrete expansions of dynamic ones.
const used = new Set();
// Plain `t("ns.key")` calls.
for (const m of text.matchAll(/\bt\(\s*"((?:analytics|account|admin)\.[a-zA-Z0-9_.]+)"/g)) used.add(m[1]);
// Keys chosen by a conditional inside the call, e.g.
// `t(variables.url ? "admin.social_link_saved" : "admin.social_link_removed", {...})`.
for (const m of text.matchAll(/\bt\([^)]*?\?[^)]*?"((?:analytics|account|admin)\.[a-zA-Z0-9_.]+)"\s*:\s*"((?:analytics|account|admin)\.[a-zA-Z0-9_.]+)"/g)) {
  used.add(m[1]);
  used.add(m[2]);
}
for (const [_, keys] of DYNAMIC) for (const k of keys) used.add(k);

// Plural base keys: resolve by requiring every form the locale's plural rules can ask
// for, and register those forms as used so they are not flagged as orphans.
const PLURAL_BASES = ["analytics.in_orders", "admin.products_range"];
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

for (const key of [...used].sort()) {
  // Plural base keys have no entry of their own; they were checked as suffixes above.
  if (PLURAL_BASES.includes(key)) continue;
  const missing = LOCALES.filter((loc) => resolve(bundles[loc], key) === undefined);
  if (missing.length) {
    console.error(`[FAIL] ${key} missing in ${missing.join(", ")}`);
    problems++;
  }
}

// Orphan check: an unread key is either a leftover or a typo nothing will ever catch.
// Arabic's extra plural forms are exempt because i18next, not the source, names them.
const arabicOnlyPlural = new Set(Object.keys(bundles.ar.analytics).filter((k) => /_(zero|two|few|many)$/.test(k)));
for (const loc of LOCALES) {
  for (const key of Object.keys(bundles[loc].analytics)) {
    const full = `analytics.${key}`;
    if (used.has(full)) continue;
    if (arabicOnlyPlural.has(key)) continue;
    console.error(`[WARN] ${loc}.${full} is never referenced`);
    problems++;
  }
}

// Same orphan check for the admin namespace, which now covers AdminMarket's whole
// chrome, catalogue, orders, delivery and social tabs.
const adminArabicPlural = new Set(Object.keys(bundles.ar.admin).filter((k) => /_(zero|two|few|many)$/.test(k)));
for (const loc of LOCALES) {
  for (const key of Object.keys(bundles[loc].admin)) {
    const full = `admin.${key}`;
    if (used.has(full)) continue;
    if (adminArabicPlural.has(key)) continue;
    // Plural forms of a base that is itself registered in PLURAL_BASES.
    const base = key.replace(/_(zero|one|two|few|many|other)$/, "");
    if (PLURAL_BASES.includes(base)) continue;
    console.error(`[WARN] ${loc}.${full} is never referenced`);
    problems++;
  }
}

console.log(`[ok] ${used.size} keys resolved across ${LOCALES.length} locales, ${problems} problem(s)`);
process.exit(problems ? 1 : 0);
