/**
 * Product promotion rules.
 *
 * This module is the single source of truth for "what does this product cost
 * right now", and it is imported by BOTH sides of the app:
 *
 *   - the client, to render the price a shopper actually pays, and
 *   - the server, to charge that same price at checkout.
 *
 * That sharing is the whole point. If the display logic and the billing logic
 * were two separate implementations they would inevitably drift, and the
 * cheapest drift possible would be a customer seeing one price and being
 * charged another.
 *
 * The data itself lives in three nullable columns on `products` (added by
 * migration 0003), so nothing here touches the database: it is a pure function
 * over a plain object plus a clock. That also makes it trivial to unit test by
 * passing an explicit `now`.
 */

/**
 * Lifecycle of a product's promotion, from a shopper's point of view.
 *
 * - `none`     no promotion configured, or the configured numbers are unusable
 *              (promo >= regular). Never show a promo badge.
 * - `scheduled` a valid discount exists but `promoStart` is still in the future.
 * - `active`    the discount is live and applies. This is the only state that
 *              changes the price.
 * - `expired`   the discount ended; the regular price is back.
 */
export type PromotionStatus = "none" | "scheduled" | "active" | "expired";

/** The subset of a product the resolver needs. Structural so tests need no DB row. */
export type PromotionCandidate = {
  price: number | string | null | undefined;
  promoPrice?: number | string | null;
  promoStart?: string | number | Date | null;
  promoEnd?: string | string | number | Date | null;
};

export type PromotionState = {
  status: PromotionStatus;
  /** What the shopper pays now. Equal to the regular price unless `active`. */
  effectivePrice: number;
  /** Always the regular price, so a UI can strike it through. */
  regularPrice: number;
  /** The configured promotional price, or null when there is nothing valid. */
  promoPrice: number | null;
  /** Whole-percent saving, 0 when there is no active discount. */
  discountPercent: number;
  /** ISO strings, so a UI can render "offer ends ..." without re-parsing. */
  promoStart: string | null;
  promoEnd: string | null;
};

/**
 * Coerce anything that can arrive from the wire or the DB into a finite number.
 *
 * Returns null rather than 0 for junk, because 0 is a legitimate promotional
 * price (a free item) and must not be confused with "no price given".
 */
function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "string" ? Number(value) : value;
  return typeof num === "number" && Number.isFinite(num) ? num : null;
}

/**
 * Parse a stored timestamp column into epoch milliseconds.
 *
 * Drizzle hands back a real `Date` for both dialects, but an ISO string shows up
 * when the row came through JSON (cached page, old backup) and a raw number when
 * it came straight out of SQLite's integer column, so accept all three.
 */
function toEpochMs(value: string | number | Date | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const NO_PROMOTION = {
  status: "none" as const,
  effectivePrice: 0,
  regularPrice: 0,
  promoPrice: null,
  discountPercent: 0,
  promoStart: null,
  promoEnd: null,
};

/**
 * Resolve a product's promotion at a point in time.
 *
 * The window is **half-open: `[promoStart, promoEnd)`**. The start instant is
 * included, the end instant is not. So a promotion ending at exactly `T` is
 * already over at `T`, which means `promoEnd` can be handed straight to
 * `<input type="datetime-local">` without fudging it forward by a millisecond,
 * and two promotions can share a boundary instant without both claiming it.
 *
 * A promo price that is not strictly lower than the regular price is treated as
 * `none` rather than as an error: the price still has to be sellable, so a bad
 * row degrades to the regular price instead of blocking checkout or (worse)
 * raising the price.
 */
export function resolvePromotion(
  product: PromotionCandidate,
  now: number | Date = Date.now(),
): PromotionState {
  const regularPrice = toFiniteNumber(product.price);
  if (regularPrice === null) return NO_PROMOTION;

  const noPromo: PromotionState = {
    status: "none",
    effectivePrice: regularPrice,
    regularPrice,
    promoPrice: null,
    discountPercent: 0,
    promoStart: null,
    promoEnd: null,
  };

  const promoPrice = toFiniteNumber(product.promoPrice);
  // No promo, a negative one (never a discount), or one that is not actually a
  // discount: all fall back to the regular price.
  if (promoPrice === null || promoPrice < 0 || promoPrice >= regularPrice) {
    return noPromo;
  }

  const startMs = toEpochMs(product.promoStart);
  const endMs = toEpochMs(product.promoEnd);
  const nowMs = now instanceof Date ? now.getTime() : now;

  const promoStart = startMs === null ? null : new Date(startMs).toISOString();
  const promoEnd = endMs === null ? null : new Date(endMs).toISOString();

  // A window that has been left inverted (end before start) can never be active;
  // treat it as expired so the admin sees a non-active state and can fix it.
  if (startMs !== null && endMs !== null && endMs <= startMs) {
    return {
      status: "expired",
      effectivePrice: regularPrice,
      regularPrice,
      promoPrice,
      discountPercent: 0,
      promoStart,
      promoEnd,
    };
  }

  const base = {
    regularPrice,
    promoPrice,
    promoStart,
    promoEnd,
  };

  if (startMs !== null && nowMs < startMs) {
    return { ...base, status: "scheduled", effectivePrice: regularPrice, discountPercent: 0 };
  }

  if (endMs !== null && nowMs >= endMs) {
    return { ...base, status: "expired", effectivePrice: regularPrice, discountPercent: 0 };
  }

  // Only the active branch gets a real saving, so `discountPercent` is never
  // displayed next to a price that is not being discounted.
  const discountPercent = Math.round((1 - promoPrice / regularPrice) * 100);
  return {
    ...base,
    status: "active",
    effectivePrice: promoPrice,
    discountPercent,
  };
}

/** True only when the promo is live and actually lowers the price. */
export function isPromotionActive(
  product: PromotionCandidate,
  now: number | Date = Date.now(),
): boolean {
  return resolvePromotion(product, now).status === "active";
}

/**
 * Validate promotion inputs on the server, mirroring the rules the admin form
 * enforces in the browser.
 *
 * Returns a list of human-readable problems; an empty list means valid. Written
 * as a plain function rather than a Zod refinement so the admin form can call it
 * on every keystroke for its live preview without constructing a schema.
 */
export function validatePromotion(input: {
  price: number | string | null | undefined;
  promoPrice?: number | string | null | undefined;
  promoStart?: string | number | Date | null | undefined;
  promoEnd?: string | number | Date | null | undefined;
}): string[] {
  const errors: string[] = [];

  const regular = toFiniteNumber(input.price);
  const promo = toFiniteNumber(input.promoPrice);
  const startMs = toEpochMs(input.promoStart);
  const endMs = toEpochMs(input.promoEnd);

  if (regular !== null && regular < 0) {
    errors.push("Regular price cannot be negative.");
  }

  // A missing promo price is not an error: it is how "remove the promotion" is
  // expressed, since the column is nullable.
  if (promo !== null) {
    if (promo < 0) {
      errors.push("Promotional price cannot be negative.");
    }
    if (regular !== null && promo >= regular) {
      errors.push("Promotional price must be lower than the regular price.");
    }
  }

  if (promo === null && (startMs !== null || endMs !== null)) {
    errors.push("A promotional price is required to schedule an offer window.");
  }

  if (startMs !== null && endMs !== null && endMs < startMs) {
    errors.push("The offer end must not be before the offer start.");
  }

  return errors;
}