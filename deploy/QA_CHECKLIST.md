# B&B Market — manual browser QA checklist

Run this **against a deployed preview build** (`npm run build` + `npm start`, or the
OVH VPS). Automated suites and the PostgreSQL rehearsal cover the API and the
database; this list covers what only a real browser and a real human can judge:
layout, contrast, RTL mirroring, third-party embeds, and copy.

**How to use it**

- Work down each section in order. Tick only what you actually observed.
- Anything that "looks off but you can't explain" is a result — write what you saw.
- Test the axes that multiply: **every page** should be seen at least once in
  desktop + mobile, and every *customer-facing* page in fr / en / ar.
- Arabic is the highest-risk axis in this app (see "Known risk areas" below);
  budget the most time there.

**Accounts you need**

| account | role | how to obtain |
| --- | --- | --- |
| admin | `admin` / `superadmin` | ask the owner; do not create on a shared DB |
| customer | `client` | sign up with a throwaway address |
| anonymous | — | sign out / private window |

---

## 1. Environments to sweep

For each combination below, confirm the page renders, is not blank, has no
horizontal scrollbar on mobile, and has no visible untranslated key (a raw string
like `account.wishlist.count` means a missing translation — record it).

- [ ] **Theme:** light · dark · and a reload while staying in dark
- [ ] **Locale:** fr (default) · en · ar
- [ ] **Viewport:** desktop (≥1280px) · tablet (~768px) · mobile (375×667, 390×844)
- [ ] **Auth:** anonymous · customer · admin

Fastest path: pick one locale, walk every page, then flip theme, then flip locale
and walk again. Do not try to hold all 27 combinations in your head.

---

## 2. Public pages

- [ ] **Home `/`** — hero, product carousel, category tiles, footer, WhatsApp button
- [ ] **Products `/products`** — grid renders, image alt text present
- [ ] Products — **search** with a real term, a term with no results, and a term with
      accented characters (`chocolat`, `chocolaté`)
- [ ] Products — **category filter**, **stock filter** (in stock / low / out), **sort**
      (each option), **pagination** (next / last / past the end)
- [ ] Products — clear all filters returns to the full list
- [ ] **Product detail `/products/:id`** — price, promo badge and countdown, quantity,
      add to cart, image, back to list preserving filters
- [ ] Product detail — open a **deleted / out-of-stock / non-existent id** by editing
      the URL; expect a friendly message, never a blank page or a raw stack trace
- [ ] **Promos `/promos`** — active, scheduled (not yet started), and expired promos
- [ ] **Stickers** page — image and PDF/print link
- [ ] **Contact** — the WhatsApp quote link opens with the right prefilled text
- [ ] **404** — an unknown URL shows the styled not-found page
- [ ] **Navbar** — links, cart badge count, language switcher, theme toggle, mobile
      hamburger drawer opens and closes

## 3. Cart and checkout

- [ ] Add items to the cart from products and from a product detail page
- [ ] Cart — quantities editable, line totals recalculate, remove item, empty state
- [ ] Cart — delivery fee applied, and **free delivery above the threshold**
- [ ] **Checkout `/checkout`** — fill in name, phone, address; toggle pickup vs delivery
      and confirm the fee and the available methods change accordingly
- [ ] Checkout — a **promo code** applied shows the discounted total
- [ ] Checkout — submit with **each required field empty**, then one field at a time;
      each produces a visible, specific error near that field
- [ ] Checkout — invalid phone format, and an email field with a malformed address
- [ ] Checkout — out-of-stock item in the cart is rejected with a clear message
- [ ] Checkout — successful order shows a confirmation and the cart empties
- [ ] Checkout — the placed order appears in the customer's history with the right
      status, total, and delivery method
- [ ] Checkout — **double submit / refresh mid-order** must not create two orders

## 4. Account area (customer)

- [ ] `/profile` — details render and save; avatar upload works
- [ ] `/my-history` — activity list renders, icons and labels correct, empty state
- [ ] `/account` — overview, addresses, and the order list
- [ ] `/account/orders/:id` — order detail from the list; **another customer's order
      must be a 404/403, never a 200 with someone else's data**
- [ ] **Wishlist** — add from a product card and from product detail; the heart
      reflects saved state and survives a reload
- [ ] Wishlist — duplicate add is idempotent (count does not double)
- [ ] Wishlist — remove an item; empty state appears when the last one goes
- [ ] Wishlist — a saved product that is later deleted or out of stock renders a
      graceful badge, not a broken card
- [ ] Change password and sign out — you cannot reach a protected page afterwards
- [ ] Sign out then press the browser **back** button — private data is not shown

## 5. Auth screens

- [ ] `/login` — valid, wrong password, unknown email, empty submit
- [ ] `/signup` — password rules are stated and enforced; duplicate email rejected
- [ ] `/forgot-password` — unknown address must **not** reveal whether the account
      exists (identical message either way)
- [ ] `/reset-password` — valid token, expired token, mismatched confirmation
- [ ] The **show/hide password eye icon** sits on the correct side in **ar** (RTL)

## 6. Admin (`/admin`, admin account only)

- [ ] A **customer** visiting `/admin` is refused, and so is an anonymous visitor
- [ ] Overview — counts and recent activity match what the data says
- [ ] **Products** — create with image, edit, change stock, delete (with confirm)
- [ ] Products — image upload failure (wrong file type / too large) shows a real error
- [ ] Products — a field left blank produces a field-level error, not a silent save
- [ ] **Promotions** — create, schedule a future window, edit, delete
- [ ] Promotions — a promo that is scheduled but inactive must not discount the price
- [ ] Promotions — a promo ending exactly now is inactive, not active
- [ ] **Orders** — list, filter, change status; the customer sees the new status
- [ ] **Categories** — create, rename, delete a category that still has products
      (must warn, not silently orphan them)
- [ ] **Social media** — save Instagram / Facebook / TikTok links and confirm they
      appear in the footer
- [ ] **Delivery settings** — toggle pickup and delivery off; the storefront and
      checkout must both respect it
- [ ] **Stickers image** — upload replaces the image everywhere it is used
- [ ] **Users** — list, change role, delete; the hardcoded `Mohamed` account cannot be
      deleted
- [ ] **Users** — a client cannot be promoted, or an admin demoted, by a `client` account
- [ ] **Backup** button — reports progress and does not hang or double-fire

## 7. Analytics dashboard (admin)

- [ ] Every panel renders with **no data at all** (fresh database) — no `NaN`, no
      `Infinity`, no blank canvas, no crash
- [ ] Panels with a **single day** of data, and with a **partial current day**
- [ ] Range switcher (7 / 30 / 90 days, custom) updates every panel
- [ ] Revenue, order count, and AOV agree with a manual count of the orders list
- [ ] **Revenue by day** buckets orders on the correct calendar day — check one order
      placed close to midnight (see "Known risk areas")
- [ ] **Top products** — a product later deleted still shows its historical revenue
- [ ] A product with a **corrupt / truncated** items snapshot degrades to an empty
      panel and logs a warning, instead of failing the whole page
- [ ] **Low stock** respects the configured threshold and matches the products list
- [ ] Charts remain readable in **dark mode** (axis labels, gridlines, tooltips)
- [ ] Charts remain readable in **ar** (see RTL section)
- [ ] Empty-state copy is localised, not English-only

## 8. Social embeds

- [ ] **Instagram** reel — the embed renders; a **private or deleted** post shows a
      graceful fallback, not a broken iframe
- [ ] **Facebook** post — same
- [ ] **TikTok** — the short-link form resolves to a numeric id and renders
- [ ] Removing all social links → footer shows its empty state and requests **no**
      third-party scripts
- [ ] **Privacy/offline:** with the network blocked, the rest of the page is still
      usable and no broken-embeds layout appears
- [ ] A slow third-party embed does not block the page from becoming interactive

## 9. RTL (`ar`) — highest risk

- [ ] `<html dir="rtl">` and `lang="ar"` are set when Arabic is selected
- [ ] **Reload in Arabic** — direction is still RTL, not reset to LTR
- [ ] Navbar, sidebar/drawer, and breadcrumbs mirror correctly
- [ ] **Product grid and cards** — image, title, price, and heart icon mirror
- [ ] **Order timeline** — the connector line and dots are on the correct side
- [ ] **Checkout form** — labels, inputs, and the error messages sit on the right side
- [ ] **Password eye icon** is on the left of the field
- [ ] **Pagination** — "previous" and "next" arrows point the correct way
- [ ] **Table columns** in admin (products, orders, users) are right-aligned
- [ ] **Charts** — x-axis reads right-to-left or is at least not inverted/confusing
- [ ] **Modals, dropdowns, sheets** open from and align to the correct edge
- [ ] Numerals, prices, and the phone number are formatted acceptably (Latin digits
      are acceptable, mirrored currency placement is not)
- [ ] **No horizontal overflow** in any RTL page at 375px

## 10. Dark mode

- [ ] Toggle to dark on every page in the list; nothing stays white or unreadable
- [ ] **Hard reload while in dark mode** — does the page flash white before React
      mounts? *(Known issue — see below. Record whether you can see it.)*
- [ ] Form inputs, selects, checkboxes, and the native date picker are legible
- [ ] Modals, dropdowns, toasts, and the cart sheet have dark surfaces
- [ ] Charts, badges, and status pills keep sufficient contrast
- [ ] Product **images** do not disappear or gain a white halo on a dark background
- [ ] The logo/hero background still reads against the dark surface
- [ ] OS-level "system" preference is honoured on first visit

## 11. Error, empty, and boundary states

- [ ] Every list page with zero data: products, promos, stickers, orders, wishlist,
      messages, users, activities, notifications
- [ ] **Unknown product / order / category id** → friendly message, no stack trace
- [ ] **Non-numeric id** in the URL (`/products/abc`) → 4xx, no server crash
- [ ] **Negative / huge ids** → rejected cleanly
- [ ] Page number beyond the last page → empty list, not an error
- [ ] **Unknown sort / filter values** in the query string → ignored, list still renders
- [ ] **Long search term, special characters, and an emoji** in search do not break layout
- [ ] Server offline / 500 → a readable message, not a blank page
- [ ] Very long product name, description, or customer name wraps without breaking the
      card, table, or PDF print
- [ ] **No page ever shows a raw stack trace, a JSON blob, or `undefined`/`NaN`** to a
      visitor

## 12. PWA, assets, and print

- [ ] Manifest loads; install prompt is available
- [ ] Offline: the app shell loads and shows a sensible offline state
- [ ] `sw.js` and `registerSW.js` are served **uncached**; a new deploy is picked up on
      reload
- [ ] Favicon and apple-touch-icon render on a home-screen install
- [ ] **Print** view (`Print` page) produces a clean, unpaginated-clipped A4 layout in
      light **and** dark
- [ ] Logo is sharp on a high-DPI screen (it is a 312 kB PNG — check it is not visibly
      soft on a 2× display)

## 13. Final sweep

- [ ] Browser console is **free of errors and warnings** on every page (React key
      warnings, failed chunk loads, 404 assets, hydration mismatches)
- [ ] No layout shift when a lazy route chunk loads (the skeleton should hold its height)
- [ ] Keyboard-only pass: tab through the home page, product detail, checkout, and
      login; every control reachable, focus ring visible, modals trap focus and close
      on `Esc`
- [ ] Lighthouse / DevTools: record LCP, CLS, and total transfer size for `/` and
      `/products` — the homepage loads **26 Google font families** *(known issue)*

---

## Known risk areas (from the static + API pass — confirm these in the browser)

These were found by code inspection and API probing, not visually. Each maps to a
checklist item above.

1. **Dark mode may flash white on load.** `index.html` has no pre-paint theme script,
   so `.dark` is only applied when React mounts, while `:root` is near-white
   (`--background: 210 40% 99.5%`) and `.dark` is near-black. `next-themes` 0.4.6 no
   longer exports `ThemeScript`, so this needs a small inline script in `index.html`
   that reads the stored theme (and `prefers-color-scheme` when the stored value is
   `system`) before first paint. → §10
2. **Two competing Google Fonts requests, 26 families.** `index.html` requests 26
   families render-blocking; `index.css` has a second `@import` for `DM Sans`,
   `Outfit`, and `Cairo`. At least 18 of the 26 families appear unused. An `@import`
   inside CSS is also discovered only after the stylesheet parses, which delays font
   display. → §13
3. **Physical CSS properties will not mirror in Arabic.** There is no RTL plugin
   (only `tailwindcss-animate` and `@tailwindcss/typography`), so `ml-/mr-/pl-/pr-`,
   `left-/right-`, `text-left/text-right`, and `border-r` are all physical. Expect
   misalignment on the order timeline, password eye icon, pagination arrows, admin
   tables, and `NotificationDropdown`. → §9
4. **The admin panel is largely hardcoded French.** It imports `useTranslation` but
   most labels are literal strings, so an admin using `en` or `ar` sees French. A few
   customer-facing strings are also hardcoded (`NotificationDropdown` "Aucune
   notification", `CartSheet` "Total"). Locale key parity itself is clean: 445 keys
   in fr/en and 456 in ar, the extra 11 being required Arabic plural forms. → §6
5. **`POST /api/messages` is not called by the client** and its 401 body says
   *"Veuillez vous connecter pour passer une commande"* (place an order) although the
   endpoint records a **quote request**. Dead endpoint with misleading copy. → §5
6. **SPA deep links return HTTP 404 from Express** (the body is `index.html`). nginx
   compensates with `try_files $uri $uri/ /index.html`, so this only bites if nginx
   is bypassed. Verify a hard refresh on `/products` and a shared deep link. → §2
