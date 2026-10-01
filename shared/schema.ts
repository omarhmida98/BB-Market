import { z } from "zod";

export const PRODUCT_CATEGORIES = [
  "Naissance Boy",
  "Naissance Girl",
  "Mariage",
  "Accessoire",
  "Anniversaire",
  "Soutenance",
  "العمرة",
  "Emballage",
  "Patisserie",
  "Cadeaux & Décor",
  "Nouveautés",
  "Ramadan",
  "Saint Valentin",
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export type Product = {
  id: number;
  name: string;
  description: string;
  imageUrl: string;
  category: string;
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
  category: z.string().trim().max(120).default(""),
  stock: z.enum(PRODUCT_STOCK_FILTERS).catch("all").default("all"),
  promo: z.enum(PRODUCT_PROMO_FILTERS).catch("all").default("all"),
  sort: z.enum(PRODUCT_SORTS).catch("newest").default("newest"),
});

export type ProductQuery = z.infer<typeof productQuerySchema>;

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
  category: z.string().min(1, "Catégorie requise"),
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
  category: z.string(),
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
  "promoPrice" | "promoStart" | "promoEnd"
> & {
  promoPrice?: number | string | null;
  promoStart?: string | null;
  promoEnd?: string | null;
};
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type InsertPromo = z.infer<typeof insertPromoSchema>;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type InsertStickerCatalog = z.infer<typeof insertStickerCatalogSchema>;
export type InsertCategory = z.infer<typeof insertCategorySchema>;
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type UpsertSocialMediaEmbed = z.infer<typeof upsertSocialMediaEmbedSchema>;
export type LoginCredentials = z.infer<typeof loginSchema>;