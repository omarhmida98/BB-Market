import { pgTable, text as pgText, serial, integer as pgInteger, boolean, timestamp as pgTimestamp, doublePrecision as pgDoublePrecision, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText, integer, real, index as sqliteIndex, uniqueIndex as sqliteUniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// --- PostgreSQL Schema ---

export const pgProducts = pgTable("products", {
  id: serial("id").primaryKey(),
  name: pgText("name").notNull(),
  description: pgText("description").notNull(),
  imageUrl: pgText("image_url").notNull(),
  category: pgText("category").notNull(),
  // price/quantity were `text` until migration 0002. They are numbers now so the
  // catalogue can be sorted and filtered in SQL: on PostgreSQL `text > integer`
  // is an operator error, and on both dialects a text column sorts
  // lexicographically ("100" < "9"). The client already coerced both to numbers
  // with Number(), so this only makes the database agree with the app.
  quantity: pgInteger("quantity").notNull().default(0),
  price: pgDoublePrecision("price").notNull().default(0),
  // --- Promotion (migration 0003) ---
  //
  // Nullable columns on `products` rather than a separate `product_promotions`
  // table, deliberately:
  //
  //   - A product has at most one promotion, so a 1:1 side table would only add
  //     a join to the catalogue query and to every checkout read.
  //   - No promotion history is required, so there is no second row to keep.
  //   - NULL means "no promotion", so every row written before 0003 keeps
  //     working with no backfill at all.
  //
  // `promo_price` is numeric for the same reason `price` is: sorting or
  // comparing money stored as text is lexicographic and wrong ("100" < "9").
  //
  // Both bounds are nullable because a promotion may be open-ended: NULL start
  // means "already started", NULL end means "runs until an admin stops it".
  promoPrice: pgDoublePrecision("promo_price"),
  promoStart: pgTimestamp("promo_start"),
  promoEnd: pgTimestamp("promo_end"),
  // "newest" needs a real, stable sort key. Existing rows are backfilled with the
  // migration timestamp; the id tiebreak in the ORDER BY keeps paging stable.
  createdAt: pgTimestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Default sort (newest) plus its id tiebreak. Declared ascending on purpose:
  // both SQLite and PostgreSQL walk a B-tree backwards, so this one index serves
  // ORDER BY created_at DESC, id DESC without a sort step.
  index("idx_products_created_at").on(t.createdAt, t.id),
  // Category filter. Selective, and used on its own or combined with a sort.
  index("idx_products_category").on(t.category),
  // Price sort (low -> high / high -> low) without a filesort.
  index("idx_products_price").on(t.price),
  // Stock filter and the admin "sort by stock".
  index("idx_products_quantity").on(t.quantity),
  // "promotions only" filter. Partial, so the index holds only promoted rows
  // and stays small no matter how large the catalogue grows. PostgreSQL and
  // SQLite both support partial indexes with identical syntax.
  index("idx_products_promoted").on(t.id).where(sql`${t.promoPrice} is not null`),
]);

export const pgMessages = pgTable("messages", {
  id: serial("id").primaryKey(),
  name: pgText("name").notNull(),
  email: pgText("email"),
  phone: pgText("phone").notNull(),
  message: pgText("message").notNull(),
  selectedItems: pgText("selected_items"),
  read: boolean("read").notNull().default(false),
  status: pgText("status").notNull().default("pending"),
  approvedBy: pgText("approved_by"),
  approvedAt: pgTimestamp("approved_at"),
  rejectedBy: pgText("rejected_by"),
  rejectedAt: pgTimestamp("rejected_at"),
  createdAt: pgTimestamp("created_at").defaultNow(),
});

export const pgUsers = pgTable("users", {
  id: serial("id").primaryKey(),
  username: pgText("username").notNull().unique(),
  email: pgText("email").notNull().unique(),
  fullName: pgText("full_name"),
  phone: pgText("phone"),
  password: pgText("password").notNull(),
  role: pgText("role").notNull().default("admin"),
  googleId: pgText("google_id"),
  resetToken: pgText("reset_token"),
  resetTokenExpires: pgTimestamp("reset_token_expires"),
});

export const pgPromos = pgTable("promos", {
  id: serial("id").primaryKey(),
  productName: pgText("product_name"),
  category: pgText("category"),
  description: pgText("description"),
  imageUrl: pgText("image_url").notNull(),
  createdAt: pgTimestamp("created_at").defaultNow(),
});

export const pgStickerCatalogs = pgTable("sticker_catalogs", {
  id: serial("id").primaryKey(),
  title: pgText("title").notNull(),
  description: pgText("description").notNull(),
  imageUrl: pgText("image_url").notNull(), // Switched from pdfUrl
});

export const pgSettings = pgTable("settings", {
  id: serial("id").primaryKey(),
  instagramReel: pgText("instagram_reel"),
  facebookReel: pgText("facebook_reel"),
  tiktokReel: pgText("tiktok_reel"),
  stickersImageUrl: pgText("stickers_image_url"), // Switched from pdfUrl
  // --- Delivery & pickup configuration (admin controlled) ---
  pickupEnabled: boolean("pickup_enabled").notNull().default(true),
  deliveryEnabled: boolean("delivery_enabled").notNull().default(true),
  deliveryFee: pgText("delivery_fee").notNull().default("7"),
  freeDeliveryThreshold: pgText("free_delivery_threshold").notNull().default("100"),
  deliveryNote: pgText("delivery_note"),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
});

export const pgUserActivities = pgTable("user_activities", {
  id: serial("id").primaryKey(),
  userId: pgInteger("user_id").notNull(),
  type: pgText("type").notNull(),
  details: pgText("details"),
  createdAt: pgTimestamp("created_at").defaultNow(),
});


export const pgCategories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: pgText("name").notNull().unique(),
  slug: pgText("slug").notNull().unique(),
  active: boolean("active").notNull().default(true),
  createdAt: pgTimestamp("created_at").defaultNow(),
});

export const pgOrders = pgTable("orders", {
  id: serial("id").primaryKey(),
  userId: pgInteger("user_id"),
  customerName: pgText("customer_name").notNull(),
  email: pgText("email"),
  phone: pgText("phone").notNull(),
  address: pgText("address"),
  notes: pgText("notes"),
  itemsJson: pgText("items_json").notNull(),
  subtotal: pgText("subtotal").notNull().default("0"),
  total: pgText("total").notNull().default("0"),
  // Fulfillment snapshot: how the customer wanted the order handed over.
  // Kept separate from paymentMethod (cash_on_delivery | pickup | whatsapp).
  fulfillmentMethod: pgText("fulfillment_method").notNull().default("delivery"),
  // Fee actually charged, computed server-side from the delivery settings.
  deliveryFee: pgText("delivery_fee").notNull().default("0"),
  status: pgText("status").notNull().default("pending"),
  paymentMethod: pgText("payment_method").notNull().default("cash_on_delivery"),
  createdAt: pgTimestamp("created_at").defaultNow(),
}, (t) => [
  // Analytics read index (migration 0005). Every dashboard aggregate filters orders
  // by a created_at range, and without this the plan is a full scan of the table
  // however narrow the range. `status` is deliberately not the leading column: the
  // predicate is `status <> 'cancelled'`, and a btree seek needs an equality or
  // range bound on the leading column, which `<>` cannot provide.
  index("idx_orders_created_at").on(t.createdAt),
]);

export const pgSocialMediaEmbeds = pgTable("social_media_embeds", {
  id: serial("id").primaryKey(),
  platform: pgText("platform").notNull().unique(),
  url: pgText("url"),
  createdAt: pgTimestamp("created_at").defaultNow(),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
});

/**
 * Customer wishlist (migration 0004): one row per (user, product) pair.
 *
 * A join table rather than a product column, because a product can be favourited
 * by any number of customers and the "who saved this" direction is only ever
 * queried as "what did *this* customer save" - the reverse is never needed, and
 * storing it would put customer ids on the catalogue row itself.
 *
 * `ON DELETE CASCADE` on `product_id` is what makes deleting a product safe:
 * every customer's entry disappears with it instead of surviving as a row
 * pointing at an id that no longer resolves. Without this the wishlist page
 * would need to defend against dangling references forever, in every query.
 *
 * `user_id` deliberately has no cascade: accounts are deleted explicitly and
 * their wishlist with them (see `deleteUser`), which is rarer than products
 * being retired, and an explicit delete is easier to reason about than relying on
 * a cascade nobody sees.
 *
 * The unique constraint is the whole duplicate-prevention story. "Cannot favourite
 * the same product twice" is a database invariant here, not an application check:
 * a check-then-insert in the route would race two concurrent clicks into two
 * rows. `onConflictDoNothing` in `addWishlistItem` turns the violation into a
 * no-op, which is what makes a duplicate add idempotent rather than an error.
 */
export const pgWishlist = pgTable("wishlist", {
  id: serial("id").primaryKey(),
  userId: pgInteger("user_id").notNull(),
  // `onDelete: "cascade"` is what makes deleting a product safe: the rows go with
  // it instead of surviving as references to an id that no longer resolves.
  productId: pgInteger("product_id").notNull().references(() => pgProducts.id, { onDelete: "cascade" }),
  createdAt: pgTimestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Serves `WHERE user_id = ? ORDER BY created_at DESC`, the only query shape
  // this table has. User ids are few and each list is short, so the index stays
  // small regardless of catalogue size.
  index("idx_wishlist_user_created").on(t.userId, t.createdAt),
  // The duplicate guard. Named so a failed insert explains itself in the logs.
  uniqueIndex("uq_wishlist_user_product").on(t.userId, t.productId),
]);

/**
 * Notifications (migration 0008): one row per recipient.
 *
 * The row stores facts about an order event, not a sentence - see
 * shared/notifications.ts for why. `user_id` is the recipient and the only
 * thing every read is filtered by, which is what keeps one customer's history
 * out of another's.
 *
 * There is deliberately no foreign key to `orders`: a notification is history,
 * and it should still read "your order was delivered" if the order row is later
 * removed. Account deletion clears a user's rows explicitly (see `deleteUser`).
 */
export const pgNotifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: pgInteger("user_id").notNull(),
  audience: pgText("audience").notNull(),
  type: pgText("type").notNull(),
  orderId: pgInteger("order_id"),
  orderStatus: pgText("order_status"),
  orderTotal: pgDoublePrecision("order_total"),
  customerName: pgText("customer_name"),
  read: boolean("read").notNull().default(false),
  createdAt: pgTimestamp("created_at").notNull().defaultNow(),
}, (t) => [
  // Serves the list: `WHERE user_id = ? ORDER BY created_at DESC`.
  index("idx_notifications_user_created").on(t.userId, t.createdAt),
  // Serves the unread badge: `WHERE user_id = ? AND read = false`.
  index("idx_notifications_user_read").on(t.userId, t.read),
]);

/**
 * Homepage shelves, one row per horizontal strip of products (migration 0006).
 *
 * This table holds configuration, not catalogue data: it says *which* slice of
 * the catalogue to show and in what order, and the actual products are read by
 * the same bounded, filtered query the catalogue page uses. Nothing here stores
 * a product id, so deleting or editing a product can never leave a shelf
 * pointing at something that no longer exists.
 *
 * `max_products` is bounded in the schema as well as in Zod, because the bound is
 * what keeps a shelf a preview rather than a full-catalogue download.
 */
export const pgHomepageSections = pgTable("homepage_sections", {
  id: serial("id").primaryKey(),
  // Free text per language, not translation keys: the admin writes the heading
  // customers see, so each column holds that language as authored. `_fr` is the
  // only NOT NULL one - it is the authoring default and the fallback base every
  // other locale resolves to. Migration 0007 renames the old single-language
  // `title`/`tile_*` columns to their `_fr` twins, moving existing content into
  // French rather than discarding it.
  titleFr: pgText("title_fr").notNull(),
  titleEn: pgText("title_en"),
  titleAr: pgText("title_ar"),
  type: pgText("type").notNull().default("newest"),
  category: pgText("category"),
  maxPrice: pgDoublePrecision("max_price"),
  maxProducts: pgInteger("max_products").notNull().default(10),
  displayOrder: pgInteger("display_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  // Language-independent: the image and the destination are the same for every
  // visitor; only the overlaid text is translated.
  tileImageUrl: pgText("tile_image_url"),
  tileTitleFr: pgText("tile_title_fr"),
  tileTitleEn: pgText("tile_title_en"),
  tileTitleAr: pgText("tile_title_ar"),
  tileSubtitleFr: pgText("tile_subtitle_fr"),
  tileSubtitleEn: pgText("tile_subtitle_en"),
  tileSubtitleAr: pgText("tile_subtitle_ar"),
  tileCtaLabelFr: pgText("tile_cta_label_fr"),
  tileCtaLabelEn: pgText("tile_cta_label_en"),
  tileCtaLabelAr: pgText("tile_cta_label_ar"),
  tileHref: pgText("tile_href"),
  createdAt: pgTimestamp("created_at").notNull().defaultNow(),
  updatedAt: pgTimestamp("updated_at").defaultNow(),
}, (t) => [
  // Serves the only public query shape: enabled rows in display order. The id
  // tiebreak keeps the order total so two shelves configured at the same position
  // cannot swap places between requests.
  index("idx_homepage_sections_enabled_order").on(t.enabled, t.displayOrder, t.id),
]);

export const pgSchema = {
  products: pgProducts,
  messages: pgMessages,
  users: pgUsers,
  promos: pgPromos,
  stickerCatalogs: pgStickerCatalogs,
  settings: pgSettings,
  userActivities: pgUserActivities,
  categories: pgCategories,
  orders: pgOrders,
  socialMediaEmbeds: pgSocialMediaEmbeds,
  wishlist: pgWishlist,
  homepageSections: pgHomepageSections,
  notifications: pgNotifications,
};

// --- SQLite Schema ---

export const sqliteProducts = sqliteTable("products", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: sqliteText("name").notNull(),
  description: sqliteText("description").notNull(),
  imageUrl: sqliteText("image_url").notNull(),
  category: sqliteText("category").notNull(),
  // See pgProducts: both dialects are kept logically identical on purpose.
  quantity: integer("quantity").notNull().default(0),
  price: real("price").notNull().default(0),
  // See pgProducts for why promotion lives on `products` and why these are
  // nullable money columns.
  promoPrice: real("promo_price"),
  promoStart: integer("promo_start", { mode: "timestamp" }),
  promoEnd: integer("promo_end", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (t) => [
  // Same indexes, same column order, as the PostgreSQL table above. Mirrored
  // names so a query plan can be compared across the two dialects.
  sqliteIndex("idx_products_created_at").on(t.createdAt, t.id),
  sqliteIndex("idx_products_category").on(t.category),
  sqliteIndex("idx_products_price").on(t.price),
  sqliteIndex("idx_products_quantity").on(t.quantity),
  sqliteIndex("idx_products_promoted").on(t.id).where(sql`${t.promoPrice} is not null`),
]);
export const sqliteMessages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: sqliteText("name").notNull(),
  email: sqliteText("email"),
  phone: sqliteText("phone").notNull(),
  message: sqliteText("message").notNull(),
  selectedItems: sqliteText("selected_items"),
  read: integer("read", { mode: 'boolean' }).notNull().default(sql`0`),
  status: sqliteText("status").notNull().default("pending"),
  approvedBy: sqliteText("approved_by"),
  approvedAt: integer("approved_at", { mode: 'timestamp' }),
  rejectedBy: sqliteText("rejected_by"),
  rejectedAt: integer("rejected_at", { mode: 'timestamp' }),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const sqliteUsers = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: sqliteText("username").notNull().unique(),
  email: sqliteText("email").notNull().unique(),
  fullName: sqliteText("full_name"),
  phone: sqliteText("phone"),
  password: sqliteText("password").notNull(),
  role: sqliteText("role").notNull().default("admin"),
  googleId: sqliteText("google_id"),
  resetToken: sqliteText("reset_token"),
  resetTokenExpires: integer("reset_token_expires", { mode: 'timestamp' }),
});

export const sqlitePromos = sqliteTable("promos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  productName: sqliteText("product_name"),
  category: sqliteText("category"),
  description: sqliteText("description"),
  imageUrl: sqliteText("image_url").notNull(),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const sqliteStickerCatalogs = sqliteTable("sticker_catalogs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: sqliteText("title").notNull(),
  description: sqliteText("description").notNull(),
  imageUrl: sqliteText("image_url").notNull(), // Switched from pdfUrl
});

export const sqliteSettings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  instagramReel: sqliteText("instagram_reel"),
  facebookReel: sqliteText("facebook_reel"),
  tiktokReel: sqliteText("tiktok_reel"),
  stickersImageUrl: sqliteText("stickers_image_url"), // Switched from pdfUrl
  // --- Delivery & pickup configuration (admin controlled) ---
  pickupEnabled: integer("pickup_enabled", { mode: 'boolean' }).notNull().default(sql`1`),
  deliveryEnabled: integer("delivery_enabled", { mode: 'boolean' }).notNull().default(sql`1`),
  deliveryFee: sqliteText("delivery_fee").notNull().default("7"),
  freeDeliveryThreshold: sqliteText("free_delivery_threshold").notNull().default("100"),
  deliveryNote: sqliteText("delivery_note"),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

export const sqliteUserActivities = sqliteTable("user_activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: sqliteText("type").notNull(),
  details: sqliteText("details"),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});


export const sqliteCategories = sqliteTable("categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: sqliteText("name").notNull().unique(),
  slug: sqliteText("slug").notNull().unique(),
  active: integer("active", { mode: "boolean" }).notNull().default(sql`1`),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
});

export const sqliteOrders = sqliteTable("orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  customerName: sqliteText("customer_name").notNull(),
  email: sqliteText("email"),
  phone: sqliteText("phone").notNull(),
  address: sqliteText("address"),
  notes: sqliteText("notes"),
  itemsJson: sqliteText("items_json").notNull(),
  subtotal: sqliteText("subtotal").notNull().default("0"),
  total: sqliteText("total").notNull().default("0"),
  // Fulfillment snapshot: how the customer wanted the order handed over.
  // Kept separate from paymentMethod (cash_on_delivery | pickup | whatsapp).
  fulfillmentMethod: sqliteText("fulfillment_method").notNull().default("delivery"),
  // Fee actually charged, computed server-side from the delivery settings.
  deliveryFee: sqliteText("delivery_fee").notNull().default("0"),
  status: sqliteText("status").notNull().default("pending"),
  paymentMethod: sqliteText("payment_method").notNull().default("cash_on_delivery"),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (t) => [
  // Analytics read index (migration 0005). Mirrors the PostgreSQL definition; see
  // that comment for why `status` does not lead the index.
  sqliteIndex("idx_orders_created_at").on(t.createdAt),
]);

export const sqliteSocialMediaEmbeds = sqliteTable("social_media_embeds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  platform: sqliteText("platform").notNull().unique(),
  url: sqliteText("url"),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
});

/**
 * SQLite twin of `pgWishlist` (migration 0004). See that definition for the
 * reasoning; the only dialect-specific part is `created_at`, which is unix
 * seconds on SQLite and a timestamp on PostgreSQL.
 *
 * Foreign keys need `PRAGMA foreign_keys = ON` on every connection to be enforced
 * at all, and SQLite defaults it OFF. `db.ts` sets it, so the cascade below is
 * real and not decorative - worth knowing before removing that pragma, because
 * without it a deleted product would silently leave dangling rows here.
 */
export const sqliteWishlist = sqliteTable("wishlist", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  // Cascade, enforced by the `foreign_keys = ON` pragma in server/db.ts. See the
  // PostgreSQL definition above for why this reference exists.
  productId: integer("product_id").notNull().references(() => sqliteProducts.id, { onDelete: "cascade" }),
  createdAt: integer("created_at", { mode: 'timestamp' }).default(sql`(strftime('%s', 'now'))`),
}, (t) => [
  sqliteIndex("idx_wishlist_user_created").on(t.userId, t.createdAt),
  sqliteUniqueIndex("uq_wishlist_user_product").on(t.userId, t.productId),
]);

/**
 * SQLite twin of `pgNotifications` (migration 0008). See that definition for
 * the design.
 */
export const sqliteNotifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  audience: sqliteText("audience").notNull(),
  type: sqliteText("type").notNull(),
  orderId: integer("order_id"),
  orderStatus: sqliteText("order_status"),
  orderTotal: real("order_total"),
  customerName: sqliteText("customer_name"),
  read: integer("read", { mode: "boolean" }).notNull().default(sql`0`),
  createdAt: integer("created_at", { mode: 'timestamp' }).notNull().default(sql`(strftime('%s', 'now'))`),
}, (t) => [
  sqliteIndex("idx_notifications_user_created").on(t.userId, t.createdAt),
  sqliteIndex("idx_notifications_user_read").on(t.userId, t.read),
]);

/**
 * SQLite twin of `pgHomepageSections` (migration 0006). See that definition for
 * the design; only the dialect-specific bits differ - booleans are integers with
 * `mode: "boolean"`, and timestamps are epoch seconds.
 */
export const sqliteHomepageSections = sqliteTable("homepage_sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  titleFr: sqliteText("title_fr").notNull(),
  titleEn: sqliteText("title_en"),
  titleAr: sqliteText("title_ar"),
  type: sqliteText("type").notNull().default("newest"),
  category: sqliteText("category"),
  maxPrice: real("max_price"),
  maxProducts: integer("max_products").notNull().default(10),
  displayOrder: integer("display_order").notNull().default(0),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(sql`1`),
  tileImageUrl: sqliteText("tile_image_url"),
  tileTitleFr: sqliteText("tile_title_fr"),
  tileTitleEn: sqliteText("tile_title_en"),
  tileTitleAr: sqliteText("tile_title_ar"),
  tileSubtitleFr: sqliteText("tile_subtitle_fr"),
  tileSubtitleEn: sqliteText("tile_subtitle_en"),
  tileSubtitleAr: sqliteText("tile_subtitle_ar"),
  tileCtaLabelFr: sqliteText("tile_cta_label_fr"),
  tileCtaLabelEn: sqliteText("tile_cta_label_en"),
  tileCtaLabelAr: sqliteText("tile_cta_label_ar"),
  tileHref: sqliteText("tile_href"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull().default(sql`(strftime('%s', 'now'))`),
  updatedAt: integer("updated_at", { mode: "timestamp" }).default(sql`(strftime('%s', 'now'))`),
}, (t) => [
  sqliteIndex("idx_homepage_sections_enabled_order").on(t.enabled, t.displayOrder, t.id),
]);

export const sqliteSchema = {
  products: sqliteProducts,
  messages: sqliteMessages,
  users: sqliteUsers,
  promos: sqlitePromos,
  stickerCatalogs: sqliteStickerCatalogs,
  settings: sqliteSettings,
  userActivities: sqliteUserActivities,
  categories: sqliteCategories,
  orders: sqliteOrders,
  socialMediaEmbeds: sqliteSocialMediaEmbeds,
  wishlist: sqliteWishlist,
  homepageSections: sqliteHomepageSections,
  notifications: sqliteNotifications,
};
