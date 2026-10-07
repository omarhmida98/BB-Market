import { z } from "zod";

// Categories are not a fixed list: they live in the `categories` table and are
// managed in Admin → Categories. Every picker (the admin product form, the
// homepage section picker, the public Products and Promos filters) reads them
// from `/api/categories`. A product's `category` column stores the category
// *name*, which is the value used to filter. There is deliberately no hardcoded
// category constant here — an old demo list once lived at this spot.

export type Product = {
  id: number;
  name: string;
  description: string;
  imageUrl: string;
  /**
   * The category id — the relational source of truth (migration 0009/0010).
   * `null` means uncategorised (a legacy row whose text category matched no
   * category); the UI shows a translated "Uncategorised" state for it.
   */
  categoryId: number | null;
  /**
   * Display name of the category, resolved by joining `categories` on
   * `categoryId`, so a rename reflects immediately. `null` when uncategorised.
   * The legacy text column is never surfaced here.
   */
  category: string | null;
  quantity: number;
  price: number;
  /** ISO timestamp. Added by migration 0002; absent on rows written before it. */
  createdAt?: string | number | Date | null;
  /**
   * Promotion, added by migration 0003. All three are nullable: `null` promo
   * price means "no promotion", and a null bound means the offer is open-ended
   * on that side. Never decide pricing from these fields directly — go through
   * `resolvePromotion` in shared/promotions.ts, which the client and the
   * checkout both use so what is shown and what is charged cannot diverge.
   */
  promoPrice?: number | string | null;
  promoStart?: string | number | Date | null;
  promoEnd?: string | number | Date | null;
};

/**
 * Catalogue query parameters for GET /api/products.
 *
 * Everything here is applied by the database (WHERE / ORDER BY / LIMIT / OFFSET);
 * the browser never filters, sorts or slices a product list. The admin page uses
 * the same endpoint with a larger `limit` and the `name` / `stock` / `stock_asc`
 * sorts, so there is exactly one place that knows how to query the catalogue.
 */
export const PRODUCT_SORTS = [
  "newest",
  "price_asc",
  "price_desc",
  "name_asc",
  "stock_asc",
  "stock_desc",
] as const;

export type ProductSort = (typeof PRODUCT_SORTS)[number];

/**
 * A product is "low stock" when it is still sellable but barely so.
 *
 * This is the single source of truth for the cutoff. The `low` filter in
 * `queryProducts`, the badge on the public product card and the admin
 * overview all derive from it, so the filter and the UI can never disagree.
 */
export const PRODUCT_LOW_STOCK_THRESHOLD = 5;

/**
 * `low` is deliberately exclusive of `out`: a product with quantity 0 is out of
 * stock, not low, so the two buckets stay disjoint and counting them together
 * cannot double-count a product.
 */
export const PRODUCT_STOCK_FILTERS = ["all", "in", "out", "low"] as const;
export type ProductStockFilter = (typeof PRODUCT_STOCK_FILTERS)[number];

/**
 * `promo=active` restricts the catalogue to products whose promotion is live
 * *right now*. Only the live state is exposed, because a scheduled or expired
 * offer does not change the price, so listing those would show products that
 * carry no discount. The date-window half of the test stays in SQL; see
 * `promotionFilter` in server/storage.ts.
 */
export const PRODUCT_PROMO_FILTERS = ["all", "active"] as const;
export type ProductPromoFilter = (typeof PRODUCT_PROMO_FILTERS)[number];

/** Hard ceiling so one request can never ask the database for the whole table. */
export const PRODUCT_MAX_LIMIT = 100;
export const PRODUCT_DEFAULT_LIMIT = 24;

export const productQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(PRODUCT_MAX_LIMIT).default(PRODUCT_DEFAULT_LIMIT),
  search: z.string().trim().max(120).default(""),
  // Legacy name filter, kept for backward compatibility with old links; the app
  // now sends `categoryId`. When both are present `categoryId` wins.
  category: z.string().trim().max(120).default(""),
  // Relational category filter — the one the app uses. Absent query param -> no
  // filter; "" / invalid -> ignored (preprocessed so it never becomes NaN).
  categoryId: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z.number().int().positive().optional(),
  ),
  stock: z.enum(PRODUCT_STOCK_FILTERS).catch("all").default("all"),
  promo: z.enum(PRODUCT_PROMO_FILTERS).catch("all").default("all"),
  sort: z.enum(PRODUCT_SORTS).catch("newest").default("newest"),
  /**
   * Upper price bound, used by the "price under X" homepage shelf.
   *
   * Preprocessed rather than `z.coerce.number()` because an absent query
   * parameter arrives as `undefined`, and coercing that gives NaN instead of
   * "no bound" - which would then poison the SQL comparison. Empty string is
   * treated the same way, since that is what an unset admin input posts.
   *
   * Left `.optional()` and deliberately not given a `.default(undefined)`: Zod
   * narrows a defaulted optional to a *required* `number` in the output type,
   * which would force every existing caller of `productQuerySchema` to pass one.
   */
  maxPrice: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : Number(value)),
    z.number().min(0).max(1_000_000).optional(),
  ),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;

/**
 * The homepage is a list of shelves, and each shelf is a named slice of the
 * catalogue the admin configures without touching code.
 *
 * `newest`, `low_stock` and `promotions` are deliberately the same three buckets
 * the catalogue already exposes (`sort=newest`, `stock=low`, `promo=active`), so
 * a shelf never needs its own idea of what "on offer" or "running out" means.
 * `best_sellers` is the only type with no catalogue counterpart, because it is
 * derived from order history rather than from the product table.
 *
 * `price_under` carries its own ceiling and `category` names a category; the two
 * are only meaningful for their own type, which is why `homepageSectionInputSchema`
 * enforces that pairing instead of trusting the form to send the right fields.
 */
export const HOMEPAGE_SECTION_TYPES = [
  "newest",
  "best_sellers",
  "low_stock",
  "promotions",
  "category",
  "price_under",
] as const;

export type HomepageSectionType = (typeof HOMEPAGE_SECTION_TYPES)[number];

/**
 * The languages a shelf's authored text can carry.
 *
 * The array order is the fallback order as well as the admin tab order: French
 * is the authoring default and the only required language, so it sits first and
 * every other language falls back to it (see `shared/homepage.ts`).
 */
export const HOMEPAGE_LOCALES = ["fr", "en", "ar"] as const;
export type HomepageLocale = (typeof HOMEPAGE_LOCALES)[number];

/**
 * Bounds on how many products one shelf may request.
 *
 * The ceiling is the point: a homepage shelf is a preview, and a preview that
 * downloads the whole catalogue defeats the paginated catalogue endpoint that
 * `queryProducts` exists to provide. The floor keeps a shelf from rendering as a
 * single lonely card on a wide desktop row.
 */
export const HOMEPAGE_SECTION_MIN_PRODUCTS = 4;
export const HOMEPAGE_SECTION_MAX_PRODUCTS = 12;
export const HOMEPAGE_SECTION_DEFAULT_PRODUCTS = 10;

/**
 * What a shelf tile image upload accepts.
 *
 * Shared so the admin form can refuse a file before sending it and the server
 * can refuse it again on arrival, from the same list. The server check is the
 * one that counts; the client one only spares the admin a wasted upload.
 */
export const HOMEPAGE_TILE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const HOMEPAGE_TILE_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const HOMEPAGE_TILE_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;

/**
 * Every piece of customer-visible text is stored once per language.
 *
 * The columns are split (`title_fr`, `title_en`, `title_ar`) rather than kept in
 * a single JSON blob because the database remains queryable and the schema keeps
 * the "French is required, the rest are optional" rule visible. `titleFr` is the
 * only NOT NULL field: it is both the authoring default and the guaranteed
 * fallback base, so a shelf always has something to render. The removed
 * single-language `title`/`tileTitle`/... columns are renamed to their `_fr`
 * twins in migration 0007, which is what moves the existing content into French
 * without a copy-and-drop window.
 */
export type HomepageSection = {
  id: number;
  titleFr: string;
  titleEn: string | null;
  titleAr: string | null;
  type: HomepageSectionType;
  /**
   * The category a `category`-type shelf shows. `categoryId` is the source of
   * truth; `category` is the display name resolved by joining `categories`, so a
   * rename reflects immediately. Both null when the shelf is not category-typed.
   */
  categoryId: number | null;
  category: string | null;
  /** Only read when `type` is `price_under`. */
  maxPrice: number | null;
  maxProducts: number;
  displayOrder: number;
  enabled: boolean;
  /**
   * Optional tall promo tile shown at the head of the shelf. Every field is
   * nullable on purpose: a half-configured tile (image but no CTA) should still
   * render, and an admin who sets no image at all gets a plain gradient tile
   * rather than a broken image. The image URL and link are language-independent;
   * only the text is translated.
   */
  tileImageUrl: string | null;
  tileTitleFr: string | null;
  tileTitleEn: string | null;
  tileTitleAr: string | null;
  tileSubtitleFr: string | null;
  tileSubtitleEn: string | null;
  tileSubtitleAr: string | null;
  tileCtaLabelFr: string | null;
  tileCtaLabelEn: string | null;
  tileCtaLabelAr: string | null;
  tileHref: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

/**
 * Validation messages are i18n keys, not sentences.
 *
 * The server cannot know the reader's language - the same error can reach a
 * French, English or Arabic admin - so it returns a key and the client resolves
 * it through `t()`. Messages that are not keys (a raw driver error) are passed
 * through untouched by `sectionErrorMessage`.
 */
const homepageSectionBase = z.object({
  titleFr: z.string().trim().min(1, "admin.homepage_error_title_required").max(120),
  titleEn: z.string().trim().max(120).optional().nullable(),
  titleAr: z.string().trim().max(120).optional().nullable(),
  type: z.enum(HOMEPAGE_SECTION_TYPES),
  // Relational category for a `category`-type shelf; the admin picker sends it.
  // Empty string / null -> no category. The legacy `category` name is accepted
  // for compatibility but the server derives it from categoryId.
  categoryId: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable(),
  ).optional().nullable(),
  category: z.string().trim().max(120).optional().nullable(),
  maxPrice: z.coerce.number().min(0).max(1_000_000).optional().nullable(),
  maxProducts: z.coerce
    .number()
    .int()
    .min(HOMEPAGE_SECTION_MIN_PRODUCTS)
    .max(HOMEPAGE_SECTION_MAX_PRODUCTS)
    .default(HOMEPAGE_SECTION_DEFAULT_PRODUCTS),
  displayOrder: z.coerce.number().int().min(0).max(10_000).default(0),
  enabled: z.boolean().optional().default(true),
  tileImageUrl: z.string().trim().max(2048).optional().nullable(),
  tileTitleFr: z.string().trim().max(120).optional().nullable(),
  tileTitleEn: z.string().trim().max(120).optional().nullable(),
  tileTitleAr: z.string().trim().max(120).optional().nullable(),
  tileSubtitleFr: z.string().trim().max(240).optional().nullable(),
  tileSubtitleEn: z.string().trim().max(240).optional().nullable(),
  tileSubtitleAr: z.string().trim().max(240).optional().nullable(),
  tileCtaLabelFr: z.string().trim().max(80).optional().nullable(),
  tileCtaLabelEn: z.string().trim().max(80).optional().nullable(),
  tileCtaLabelAr: z.string().trim().max(80).optional().nullable(),
  tileHref: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .nullable()
    .refine((value) => !value || value.startsWith("/") || /^https?:\/\//i.test(value), {
      message: "admin.homepage_error_href_invalid",
    }),
});

/**
 * A shelf whose type cannot be satisfied renders nothing, which would look like a
 * bug rather than a misconfiguration. Rejecting the pair here means the admin gets
 * an error naming the field to fix instead of a silently missing shelf.
 */
function validateHomepageSectionShape(
  value: { type: HomepageSectionType; categoryId?: number | null; category?: string | null; maxPrice?: number | null },
  ctx: z.RefinementCtx,
) {
  // A category shelf needs a real category id now (the picker sends it).
  if (value.type === "category" && !(Number(value.categoryId) > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["categoryId"], message: "admin.homepage_error_category_required" });
  }
  if (value.type === "price_under" && !(Number(value.maxPrice) > 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["maxPrice"], message: "admin.homepage_error_price_required" });
  }
}

export const homepageSectionInputSchema = homepageSectionBase.superRefine(validateHomepageSectionShape);
export type HomepageSectionInput = z.infer<typeof homepageSectionInputSchema>;

/**
 * Patch form: every field optional, because an edit sends only what changed.
 *
 * Deliberately NOT the full schema with `.partial()`: the refine above only knows
 * how to judge a complete section. The PATCH route instead merges the patch over
 * the stored row and validates the *result*, so flipping a shelf from `category`
 * to `newest` while leaving `category` populated still passes, and flipping it
 * *to* `category` without naming one still fails.
 */
export const homepageSectionPatchSchema = homepageSectionBase.partial();
export type HomepageSectionPatch = z.infer<typeof homepageSectionPatchSchema>;

/**
 * A section plus the products resolved for it, which is what the homepage renders.
 *
 * One payload for the whole page rather than one request per shelf. The
 * alternative - a request per shelf, each excluding what the previous one showed -
 * makes every shelf refetch as soon as the shelf before it resolves, so the page
 * costs roughly twice the requests it has shelves and still arrives in pieces.
 * Resolving them together is one round trip and de-duplication is exact, because
 * the same pass decides what each shelf gets.
 */
export type HomepageShelf = HomepageSection & { products: Product[] };

export type Message = {
  id: number;
  name: string;
  email: string | null;
  phone: string;
  message: string;
  selectedItems: string | null;
  read: boolean;
  status: string;
  approvedBy: string | null;
  approvedAt: Date | string | null;
  rejectedBy: string | null;
  rejectedAt: Date | string | null;
  createdAt: Date | string | null;
};

export const MESSAGE_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
} as const;

export type Promo = {
  id: number;
  productName: string | null;
  /** Relational category; `category` is the joined display name (null = none). */
  categoryId: number | null;
  category: string | null;
  description: string | null;
  imageUrl: string;
  createdAt: Date | string | null;
};

export type User = {
  id: number;
  username: string;
  email: string;
  fullName: string | null;
  phone: string | null;
  password: string;
  role: string;
  googleId: string | null;
  resetToken: string | null;
  resetTokenExpires: Date | string | null;
};

export type Settings = {
  id: number;
  instagramReel: string | null;
  facebookReel: string | null;
  tiktokReel: string | null;
  stickersImageUrl: string | null;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  deliveryNote: string | null;
  updatedAt: Date | string | null;
  };
  
  /** How an order is handed over to the customer. */
  export const FULFILLMENT_METHODS = ["delivery", "pickup"] as const;
  export type FulfillmentMethod = (typeof FULFILLMENT_METHODS)[number];
  
  /** Delivery & pickup rules, as configured by the admin. */
  export type DeliverySettings = {
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFee: number;
  freeDeliveryThreshold: number;
  deliveryNote: string | null;
  };
  
  export const DEFAULT_DELIVERY_SETTINGS: DeliverySettings = {
  pickupEnabled: true,
  deliveryEnabled: true,
  deliveryFee: 7,
  freeDeliveryThreshold: 100,
  deliveryNote: null,
  };
  
  /**
   * Single source of truth for the delivery fee. The browser only ever displays a
   * preview; the server recomputes this from the saved settings on every order so
   * a tampered client payload can never change what is charged.
   */
  export function computeDeliveryFee(settings: DeliverySettings, fulfillmentMethod: FulfillmentMethod, subtotal: number): number {
  if (fulfillmentMethod === "pickup") return 0;
  if (!settings.deliveryEnabled) return 0;
  const threshold = Number(settings.freeDeliveryThreshold || 0);
  // Reaching the threshold makes home delivery free.
  if (threshold > 0 && Number(subtotal) >= threshold) return 0;
  return Math.max(0, Number(settings.deliveryFee || 0));
  }
  
export type StickerCatalog = {
  id: number;
  title: string;
  description: string;
  imageUrl: string;
};

export type UserActivity = {
  id: number;
  userId: number;
  type: string;
  details: string | null;
  createdAt: Date | string | null;
};

export type Category = {
  id: number;
  name: string;
  slug: string;
  active: boolean;
  createdAt: Date | string | null;
};

export type Order = {
  id: number;
  userId: number | null;
  customerName: string;
  email: string | null;
  phone: string;
  address: string | null;
  notes: string | null;
  itemsJson: string;
  subtotal: number;
  total: number;
  /** How the order is handed over. Snapshot at checkout, independent from paymentMethod. */
  fulfillmentMethod: FulfillmentMethod;
  /** Fee actually charged, computed server-side. */
  deliveryFee: number;
  status: string;
  paymentMethod: string;
  createdAt: Date | string | null;
  };

export const SOCIAL_PLATFORMS = ["instagram", "facebook", "tiktok"] as const;
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number];

export type SocialMediaEmbed = {
  id: number;
  platform: SocialPlatform;
  url: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
};

export const insertProductSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  description: z.string().min(1, "Description requise"),
  imageUrl: z.string().min(1, "Image requise"),
  // The relational category the product belongs to. Required on create; the
  // server resolves its current name into the legacy `category` text column so
  // the NOT NULL constraint stays satisfied.
  categoryId: z.coerce.number().int().positive({ message: "Catégorie requise" }),
  // Kept optional for compatibility; the server derives it from categoryId.
  category: z.string().optional().default(""),
  quantity: z.string().optional().default("0"),
  price: z.union([z.string(), z.number()]).optional().default("0"),
  // Promotion, added by migration 0003. Optional throughout: omitting them is
  // exactly how a product is created without a promotion, and an existing row
  // keeps working because the new columns are nullable.
  //
  // Accepts "", null and undefined as "no promotion". `checkPromotion` below
  // runs the cross-field rules (promo < price, end >= start) because Zod cannot
  // express those without a refinement on the whole object.
  promoPrice: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((val) => {
      if (val === null || val === undefined || val === "") return null;
      const num = typeof val === "string" ? Number(val) : val;
      return Number.isFinite(num) ? num : NaN;
    })
    .refine((val) => val === null || val >= 0, {
      message: "Le prix promotionnel ne peut pas être négatif",
    }),
  promoStart: z.string().optional().nullable(),
  promoEnd: z.string().optional().nullable(),
});

/**
 * Cross-field promotion rules for the product create/edit routes.
 *
 * This is a re-export rather than a second implementation: `shared/promotions.ts`
 * owns the promotion rules, and the admin form imports the exact same function
 * for its live preview. Duplicating these checks in a Zod schema is how the
 * browser and the server end up disagreeing about what is a valid promotion.
 */
export { validatePromotion as checkPromotion } from "./promotions.js";

export const insertMessageSchema = z.object({
  name: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide").optional().nullable(),
  phone: z.string().min(8, "Numéro de téléphone invalide (min 8 caractères)"),
  message: z.string().min(1, "Message requis"),
  selectedItems: z.string().optional(),
});

export const insertPromoSchema = z.object({
  productName: z.string().optional(),
  // Relational category (optional — a promo may be uncategorised). The server
  // derives the legacy `category` name from it.
  categoryId: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : Number(value)),
    z.number().int().positive().nullable(),
  ).optional().nullable(),
  category: z.string().optional(),
  description: z.string().optional(),
  imageUrl: z.string().min(1, "Image requise"),
});

export const insertUserSchema = z.object({
  username: z.string().min(1, "Identifiant requis"),
  email: z.string().email("Adresse email invalide"),
  fullName: z.string().min(1, "Nom complet requis").optional(),
  phone: z.string().min(8, "Numéro de téléphone invalide").optional(),
  password: z.string().min(1, "Mot de passe requis"),
  role: z.string().optional(),
});

export const insertSettingsSchema = z.object({
  instagramReel: z.string().optional(),
  facebookReel: z.string().optional(),
  tiktokReel: z.string().optional(),
  stickersImageUrl: z.string().optional(),
  // --- Delivery & pickup ---
  pickupEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  deliveryFee: z.coerce.number().min(0, "Frais de livraison invalides").max(100000).optional(),
  freeDeliveryThreshold: z.coerce.number().min(0, "Seuil de livraison gratuite invalide").max(1000000).optional(),
  deliveryNote: z.string().max(2000).optional().nullable(),
}).refine(
  (s) => s.pickupEnabled !== false || s.deliveryEnabled !== false,
  { message: "Au moins une méthode (livraison ou retrait) doit être activée", path: ["deliveryEnabled"] },
);

export const insertStickerCatalogSchema = z.object({
  title: z.string().min(1, "Titre requis"),
  description: z.string().min(1, "Description requise"),
  imageUrl: z.string().min(1, "Image requise"),
});


export const insertCategorySchema = z.object({
  name: z.string().min(1, "Nom de catégorie requis"),
  slug: z.string().min(1).optional(),
  active: z.boolean().optional().default(true),
});

export const insertOrderSchema = z.object({
  customerName: z.string().min(1, "Nom requis"),
  email: z.string().email("Email invalide").optional().nullable(),
  phone: z.string().min(8, "Téléphone invalide"),
  address: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  paymentMethod: z.enum(["cash_on_delivery", "pickup", "whatsapp"]).default("cash_on_delivery"),
  // How the customer wants the order. `deliveryFee` and `total` are deliberately
  // absent: Zod strips unknown keys, so anything the browser sends for them is
  // discarded and the server computes the real amount from the saved settings.
  fulfillmentMethod: z.enum(FULFILLMENT_METHODS).default("delivery"),
  items: z.array(z.object({
    id: z.union([z.number(), z.string()]),
    name: z.string().min(1),
    quantity: z.number().int().min(1),
    price: z.number().min(0),
    imageUrl: z.string().optional(),
  })).min(1, "Le panier est vide"),
}).superRefine((order, ctx) => {
  // Home delivery needs somewhere to go. Store pickup does not.
  if (order.fulfillmentMethod === "delivery" && !order.address?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["address"],
      message: "Adresse de livraison requise",
    });
  }
});

export const upsertSocialMediaEmbedSchema = z.object({
  platform: z.enum(SOCIAL_PLATFORMS),
  // Empty string is allowed and means "no embed configured" (removes the link).
  url: z
    .string()
    .trim()
    .max(2048, "Lien trop long")
    .refine((value) => value === "" || /^https?:\/\//i.test(value), {
      message: "Le lien doit commencer par http:// ou https://",
    }),
});

export const loginSchema = z.object({
  username: z.string().min(1, "Identifiant requis"),
  password: z.string().min(1, "Mot de passe requis"),
});

//  FIX: Schéma de transformation pour convertir quantity en nombre
// Ce schéma est utilisé pour la LECTURE des produits depuis l'API
export const productSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string(),
  imageUrl: z.string(),
  /**
   * Reading, not writing: `category` is the joined display name and is null for
   * an uncategorised row, while `categoryId` is the link itself. Both are
   * parsed leniently so a row from an old backup (no `category_id` column yet)
   * still decodes into the current `Product` shape instead of failing the list.
   */
  categoryId: z.preprocess(
    (value) => (value === "" || value === undefined ? null : value),
    z.number().nullable(),
  ),
  category: z.preprocess(
    (value) => (value === undefined ? null : value),
    z.union([z.string(), z.null()]),
  ),
  quantity: z.union([z.string(), z.number()]).transform((val) => {
    if (val === null || val === undefined || val === "") return 0;
    const num = typeof val === "string" ? parseInt(val, 10) : val;
    return isNaN(num) ? 0 : num;
  }),
  price: z.union([z.string(), z.number(), z.null(), z.undefined()]).transform((val) => {
    if (val === null || val === undefined || val === "") return 0;
    const num = typeof val === "string" ? parseFloat(val) : val;
    return isNaN(num) ? 0 : num;
  }),
  // Promotion columns (migration 0003). Parsed leniently on the way out because
  // an unparseable date must not fail the whole product list: it degrades to
  // `null`, which resolvePromotion reads as "no bound on that side".
  promoPrice: z
    .union([z.string(), z.number(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === "") return null;
      const num = typeof val === "string" ? parseFloat(val) : val;
      return isNaN(num) ? null : num;
    })
    .optional(),
  promoStart: z
    .union([z.string(), z.number(), z.date(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === "") return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString();
      const ms = typeof val === "number" ? val : Date.parse(val);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    })
    .optional(),
  promoEnd: z
    .union([z.string(), z.number(), z.date(), z.null(), z.undefined()])
    .transform((val) => {
      if (val === null || val === undefined || val === "") return null;
      if (val instanceof Date) return isNaN(val.getTime()) ? null : val.toISOString();
      const ms = typeof val === "number" ? val : Date.parse(val);
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    })
    .optional(),
}) as z.ZodType<Product>;

/**
 * The paginated envelope returned by GET /api/products.
 *
 * This replaced a bare `Product[]`. See the note on `queryProducts` in
 * server/storage.ts for why the array form was not kept alongside it.
 */
export const productListSchema = z.object({
  items: z.array(productSchema),
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export type ProductListResponse = z.infer<typeof productListSchema>;

export const messageSchema: z.ZodType<Message> = z.object({
  id: z.number(),
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string(),
  message: z.string(),
  selectedItems: z.string().nullable(),
  read: z.boolean(),
  status: z.string(),
  approvedBy: z.string().nullable(),
  approvedAt: z.union([z.string(), z.date()]).nullable(),
  rejectedBy: z.string().nullable(),
  rejectedAt: z.union([z.string(), z.date()]).nullable(),
  createdAt: z.union([z.string(), z.date()]).nullable(),
});

/**
 * Shape accepted by storage.createProduct / updateProduct.
 *
 * The promotion keys are widened to optional here even though
 * `insertProductSchema` always resolves them. Zod's `.transform()` makes a key
 * required in the *output* type, which would force every existing caller (demo
 * seeding, tests, scripts) to start passing nulls for a feature it does not use.
 * Widening here keeps "no promotion" the default instead of a breaking change.
 */
export type InsertProduct = Omit<
  z.infer<typeof insertProductSchema>,
  "promoPrice" | "promoStart" | "promoEnd" | "categoryId"
> & {
  promoPrice?: number | string | null;
  promoStart?: string | null;
  promoEnd?: string | null;
  /**
   * The relational link. Optional on purpose: a write may carry the id, or
   * only the legacy text name (demo seeding, older API callers), and storage
   * resolves either form through the `categories` table.
   */
  categoryId?: number | string | null;
};
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertPromo = z.infer<typeof insertPromoSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type InsertStickerCatalog = z.infer<typeof insertStickerCatalogSchema>;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type InsertHomepageSection = z.infer<typeof homepageSectionInputSchema>;
export type UpsertSocialMediaEmbed = z.infer<typeof upsertSocialMediaEmbedSchema>;
export type LoginCredentials = z.infer<typeof loginSchema>;