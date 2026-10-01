/**
 * In-page anchor scrolling.
 *
 * wouter's <Link> cannot be used for same-page fragments. Its onClick calls
 * `event.preventDefault()` and then `history.pushState()`, and pushState never
 * scrolls -- the browser's own fragment navigation, which is what actually
 * scrolls, is exactly what the preventDefault cancels. wouter's useLocation also
 * reads `location.pathname`, which is unchanged by a hash-only update, so nothing
 * re-renders either. The net effect is a link whose URL changes while the
 * viewport stays put.
 *
 * So anchors are handled imperatively here. Targets stay plain <section>s with an
 * id; they opt out from the fixed navbar with a scroll-margin (Tailwind
 * `scroll-mt-*`), which scrollIntoView honours.
 */

export const SOCIAL_MEDIA_ANCHOR_ID = "social-media";

/**
 * Scrolls to the element with the given id, returning false when it is absent so
 * callers can fall back to the browser's native fragment handling.
 */
export function scrollToAnchor(anchorId: string): boolean {
  const target = document.getElementById(anchorId);
  if (!target) return false;

  // Honour reduced-motion: a long smooth scroll is exactly what those users are
  // asking us not to do.
  const reduceMotion =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  target.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "start",
  });

  // Move focus to the target so keyboard and screen-reader users continue from
  // the new section instead of staying on the link they just pressed.
  // preventScroll keeps this from fighting the smooth scroll above.
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true });
  }

  return true;
}
