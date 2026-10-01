/**
 * Pre-paint theme bootstrap.
 *
 * next-themes 0.4.x no longer ships a <ThemeScript>, and ThemeProvider can only add
 * the `dark` class once React has mounted and executed. Until then the document
 * renders with the :root palette (--background: 210 40% 99.5%, i.e. near-white), so
 * anyone who chose dark mode got a full white flash on every page load and on every
 * client-side navigation. This file closes that window.
 *
 * Loaded as a blocking <script> in <head> so it runs before the body is parsed. It
 * is deliberately identical in decision to ThemeProvider:
 *
 *   - same storage key ("theme" - next-themes' default, which App.tsx does not
 *     override via storageKey);
 *   - "dark" / "light" are an explicit user choice and win outright;
 *   - "system" (or nothing stored yet) follows prefers-color-scheme, matching
 *     defaultTheme="system" + enableSystem.
 *
 * Once React mounts, ThemeProvider reads the same key and takes over; because both
 * derive the same class from the same input, they cannot disagree. This file only
 * ever *adds or removes* a class - it never writes to localStorage, so it cannot
 * race the provider.
 *
 * Kept as a separate file rather than inline so that a future
 * `Content-Security-Policy: script-src 'self'` needs no nonce or hash.
 */
(function () {
  var root = document.documentElement;

  var prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;

  // localStorage throws when cookies/storage are blocked (some private modes).
  // Only the read is guarded: the fallback is still a usable decision, so the
  // theme still follows the OS instead of silently falling back to light.
  var stored = null;
  try {
    stored = window.localStorage.getItem("theme");
  } catch (err) {
    stored = null;
  }

  // "dark" / "light" are an explicit user choice and win outright; "system"
  // (or nothing readable) follows prefers-color-scheme, matching
  // defaultTheme="system" + enableSystem.
  var useDark =
    stored === "dark" || stored === "light" ? stored === "dark" : prefersDark;

  if (useDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }

  // next-themes runs with enableColorScheme (its default), so once React mounts
  // it sets `style.colorScheme` on <html>. Without this, the window between the
  // first paint and hydration renders light scrollbars, date-picker icons, select
  // dropdowns and focus rings on a dark page. Setting it here keeps the two paths
  // identical.
  root.style.colorScheme = useDark ? "dark" : "light";
})();
