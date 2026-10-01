/**
 * Reading a homepage shelf in the visitor's language.
 *
 * The admin authors every customer-visible string once per language (migration
 * 0007 split `title`/`tile_title`/... into `_fr`, `_en`, `_ar`). This module is
 * the single place that decides which column is shown, and it is shared by the
 * homepage renderer and the admin list so both agree on the fallback.
 *
 * The fallback chain is deliberate:
 *
 *   1. the active locale,
 *   2. French, the authoring default and the only required language, so a shelf
 *      an admin configured before translations existed still has a heading,
 *   3. English,
 *   4. Arabic.
 *
 * French comes before the other two even when the active locale is Arabic or
 * English because it is the language the fields are guaranteed to be populated
 * in; promoting a half-translated shelf to English before falling back to a
 * complete French one would show an empty tile to an Arabic visitor.
 *
 * The result is never `undefined` and never an empty string is rendered as-is:
 * callers get `""` and decide whether to hide the element. A title is required,
 * so it is never empty for a valid row.
 */
import { HOMEPAGE_LOCALES, type HomepageLocale, type HomepageSection } from "./schema.js";

/** Collapse a BCP-47 tag ("ar-TN", "en-US") to one of the supported locales. */
export function normalizeHomepageLocale(locale: string | null | undefined): HomepageLocale {
  const base = (locale ?? "").slice(0, 2).toLowerCase();
  return (HOMEPAGE_LOCALES as readonly string[]).includes(base) ? (base as HomepageLocale) : "fr";
}

/**
 * Pick the best non-empty text for a locale.
 *
 * Accepts a plain `locale -> text` map so callers can pass whichever localized
 * fields they hold without this module knowing the section shape.
 */
export function pickHomepageText(
  values: Partial<Record<HomepageLocale, string | null | undefined>>,
  locale: string | null | undefined,
): string {
  const active = normalizeHomepageLocale(locale);
  const order: HomepageLocale[] = [active, ...HOMEPAGE_LOCALES.filter((candidate) => candidate !== active)];
  for (const candidate of order) {
    const value = values[candidate];
    if (typeof value === "string" && value.trim() !== "") return value;
  }
  return "";
}

/** The shelf heading, resolved for `locale`. */
export function sectionTitle(
  section: Pick<HomepageSection, "titleFr" | "titleEn" | "titleAr">,
  locale: string | null | undefined,
): string {
  return pickHomepageText({ fr: section.titleFr, en: section.titleEn, ar: section.titleAr }, locale);
}

/** The optional tile heading, or `""` when it is unset in every language. */
export function sectionTileTitle(
  section: Pick<HomepageSection, "tileTitleFr" | "tileTitleEn" | "tileTitleAr">,
  locale: string | null | undefined,
): string {
  return pickHomepageText({ fr: section.tileTitleFr, en: section.tileTitleEn, ar: section.tileTitleAr }, locale);
}

/** The optional tile subtitle, or `""` when it is unset in every language. */
export function sectionTileSubtitle(
  section: Pick<HomepageSection, "tileSubtitleFr" | "tileSubtitleEn" | "tileSubtitleAr">,
  locale: string | null | undefined,
): string {
  return pickHomepageText({ fr: section.tileSubtitleFr, en: section.tileSubtitleEn, ar: section.tileSubtitleAr }, locale);
}

/** The optional tile button label, or `""` when it is unset in every language. */
export function sectionTileCtaLabel(
  section: Pick<HomepageSection, "tileCtaLabelFr" | "tileCtaLabelEn" | "tileCtaLabelAr">,
  locale: string | null | undefined,
): string {
  return pickHomepageText({ fr: section.tileCtaLabelFr, en: section.tileCtaLabelEn, ar: section.tileCtaLabelAr }, locale);
}
