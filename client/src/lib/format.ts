/**
 * Locale-aware money and date formatting.
 *
 * The app used to render prices as `value.toFixed(3) + " DT"` and dates with
 * `toLocaleDateString(undefined, ...)`. That reads wrong outside French: English
 * groups thousands with commas and Arabic uses its own digits and separators, so
 * a Tunisian dinar amount has to be formatted with `Intl` in the reader's locale
 * rather than with a decimal point.
 *
 * The `DT` unit is kept literal rather than switched to `Intl`'s currency symbol,
 * because it is the shop's brand shorthand and the admin dashboards already
 * render it this way. Only the number changes with the locale.
 *
 * The tag mapping mirrors `AdminAnalytics`/`MyHistory`: `ar-TN` for Arabic (Latin
 * digits, Tunisian grouping), `en-US` for English, French otherwise.
 */
export function resolveLocaleTag(language: string | null | undefined): string {
  const base = (language ?? "").slice(0, 2).toLowerCase();
  if (base === "ar") return "ar-TN";
  if (base === "en") return "en-US";
  return "fr-FR";
}

/** Format a price in dinars, e.g. `1 234,500 DT` in French. */
export function formatMoney(value: number, language: string | null | undefined, digits = 3): string {
  const amount = Number(value) || 0;
  return `${new Intl.NumberFormat(resolveLocaleTag(language), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)} DT`;
}

/** Format a date in the reader's locale; defaults to a numeric day/month/year. */
export function formatDate(
  value: Date | string | number,
  language: string | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  return new Intl.DateTimeFormat(
    resolveLocaleTag(language),
    options ?? { day: "2-digit", month: "2-digit", year: "numeric" },
  ).format(new Date(value));
}
