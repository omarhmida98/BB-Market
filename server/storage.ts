import type { Product, InsertProduct, InsertMessage, Message, Promo, InsertPromo, User, InsertUser, Settings, InsertSettings, StickerCatalog, InsertStickerCatalog, UserActivity, Category, InsertCategory, Order, InsertOrder, SocialMediaEmbed, SocialPlatform, DeliverySettings, ProductQuery, ProductListResponse, HomepageSection, HomepageSectionInput, HomepageSectionPatch, HomepageSectionType, HomepageShelf } from "shared/schema.js";
import { PRODUCT_LOW_STOCK_THRESHOLD, HOMEPAGE_SECTION_DEFAULT_PRODUCTS, HOMEPAGE_SECTION_MAX_PRODUCTS, HOMEPAGE_SECTION_MIN_PRODUCTS, productQuerySchema } from "shared/schema.js";
import { db, products, messages, promos, users, settings, stickerCatalogs, userActivities, categories, orders, socialMediaEmbeds, wishlist, homepageSections } from "./db.js";
import { toWishlistItem, type WishlistItem, type WishlistListResponse } from "shared/wishlist.js";
import { normaliseStoredRole } from "./roles.js";
import { eq, desc, asc, and, sql, count, inArray, notInArray, type SQL } from "drizzle-orm";
import { resolveDbTarget } from "./db-target.js";
import { getBestSellingProductIds } from "./analytics.js";
import { dbg } from "./debug.js";

export interface IStorage {
  queryProducts(query: ProductQuery): Promise<ProductListResponse>;
  /**
   * Products for one homepage shelf, resolved from that shelf's stored
   * configuration and capped at `section.maxProducts`.
   *
   * `excludeIds` is how cross-shelf de-duplication works: products already placed
   * on an earlier shelf are passed in so the same item is not offered three times
   * on one page. Excluding in SQL rather than filtering in the browser is what
   * keeps the result honest - a shelf that filtered after a LIMIT would show four
   * products when ten were asked for.
   */
  queryHomepageSectionProducts(section: HomepageSection, excludeIds?: number[]): Promise<Product[]>;
  /**
   * Every enabled shelf with its products, in display order, empty shelves dropped.
   *
   * This is the single read the homepage makes.
   */
  queryHomepageShelves(): Promise<HomepageShelf[]>;
  getProduct(id: number): Promise<Product | undefined>;
  createMessage(message: InsertMessage): Promise<Message>;
  getMessages(): Promise<Message[]>;
  deleteMessage(id: number): Promise<boolean>;
  updateMessageStatus(id: number, status: string): Promise<Message | undefined>;
  updateMessageStatusWithActor(id: number, status: string, actorUsername: string): Promise<Message | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  updateProduct(id: number, product: Partial<InsertProduct>): Promise<Product | undefined>;
  updateProductStock(id: number, quantity: number): Promise<Product | undefined>;
  deleteProduct(id: number): Promise<boolean>;
  getPromos(): Promise<Promo[]>;
  createPromo(promo: InsertPromo): Promise<Promo>;
  updatePromo(id: number, promo: Partial<InsertPromo>): Promise<Promo | undefined>;
  deletePromo(id: number): Promise<boolean>;
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUserPassword(id: number, password: string): Promise<void>;
  setResetToken(id: number, token: string | null, expires: Date | null): Promise<void>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  deleteUser(id: number): Promise<boolean>;
  updateUser(id: number, data: Partial<Pick<User, "fullName" | "phone" | "email">>): Promise<User | undefined>;
  updateUserGoogleId(id: number, googleId: string): Promise<void>;
  createUserActivity(userId: number, type: string, details?: string): Promise<void>;
  getUserActivities(): Promise<UserActivity[]>;
  getUserActivitiesByUserId(userId: number): Promise<UserActivity[]>;
  getCategories(): Promise<Category[]>;
  createCategory(category: InsertCategory & { slug: string }): Promise<Category>;
  updateCategory(id: number, category: Partial<InsertCategory> & { slug?: string }): Promise<Category | undefined>;
  deleteCategory(id: number): Promise<boolean>;
  getOrders(): Promise<Order[]>;
  getOrdersByUserId(userId: number): Promise<Order[]>;
  /**
   * Fetch one order *scoped to its owner*.
   *
   * The owner id is part of the WHERE clause rather than checked afterwards. A
   * `getOrder(id)` followed by `order.userId === user.id` comparison would also
   * pass today, but it loads someone else's address and phone into memory first,
   * and any future caller who forgets the comparison leaks a customer's data.
   * Making it a single owner-scoped query means the wrong row is never fetched,
   * and a miss is indistinguishable from a nonexistent id.
   */
  getOrderByIdForUser(id: number, userId: number): Promise<Order | undefined>;
  createOrder(order: Omit<Order, "id" | "createdAt">): Promise<Order>;
  updateOrderStatus(id: number, status: string): Promise<Order | undefined>;
  /**
   * Every favourite of one customer, newest first, each joined to its product.
   *
   * `userId` is a required argument and never optional: there is no
   * "get the wishlist" without an owner, because a list without an owner is
   * everyone's list.
   */
  listWishlist(userId: number): Promise<WishlistListResponse>;
  /** True when this product is already favourited by this customer. */
  isWishlisted(userId: number, productId: number): Promise<boolean>;
  /**
   * Favourite a product, idempotently.
   *
   * Returns false when the product does not exist, so the route can answer 404
   * without a second existence check that could race the delete.
   */
  addWishlistItem(userId: number, productId: number): Promise<{ created: boolean } | undefined>;
  /** Unfavourite. Scoped by owner, so another customer cannot remove this one. */
  removeWishlistItem(userId: number, productId: number): Promise<boolean>;
  // Sticker Catalogs
  getStickerCatalogs(): Promise<StickerCatalog[]>;
  createStickerCatalog(data: InsertStickerCatalog): Promise<StickerCatalog>;
  updateStickerCatalog(id: number, data: Partial<InsertStickerCatalog>): Promise<StickerCatalog | undefined>;
  deleteStickerCatalog(id: number): Promise<boolean>;
  // Social Media Embeds
  getSocialMediaEmbeds(): Promise<SocialMediaEmbed[]>;
  upsertSocialMediaEmbed(platform: SocialPlatform, url: string | null): Promise<SocialMediaEmbed>;
  deleteSocialMediaEmbed(platform: SocialPlatform): Promise<boolean>;
  // Homepage Sections
  getHomepageSections(includeDisabled?: boolean): Promise<HomepageSection[]>;
  getHomepageSection(id: number): Promise<HomepageSection | undefined>;
  createHomepageSection(section: HomepageSectionInput): Promise<HomepageSection>;
  updateHomepageSection(id: number, patch: HomepageSectionPatch): Promise<HomepageSection | undefined>;
  deleteHomepageSection(id: number): Promise<boolean>;
  /** Apply an explicit display order to the listed ids, in the order given. */
  reorderHomepageSections(orderedIds: number[]): Promise<HomepageSection[]>;

}

/**
 * Escape the LIKE wildcards so a visitor typing "50%" searches for that literal
 * text instead of turning the pattern into "anything starting with 50".
 */
function escapeLikePattern(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** Coerce anything form-ish (string, null, NaN) into a non-negative price. */
function toPrice(value: unknown): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Coerce anything form-ish into a non-negative whole stock count. */
function toQuantity(value: unknown): number {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Nullable counterpart of `toPrice`, for `promo_price`.
 *
 * Unlike the regular price, 0 is a *valid* promo value here (a genuinely free
 * promotional item), so this cannot clamp at 0 the way `toPrice` does. It only
 * maps the things that mean "absent" — "", null, undefined, NaN — to SQL NULL.
 * A negative value is rejected upstream by validatePromotion; clamping it here
 * as well keeps a bypassed route from storing an active negative price.
 */
function toNullablePrice(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return null;
  return n > 0 ? n : 0;
}

/**
 * Nullable counterpart for the promotion date bounds.
 *
 * An empty `datetime-local` input posts "", and JSON cannot carry a Date, so both
 * arrive as strings here. Anything unparseable becomes NULL rather than
 * Invalid Date, which keeps `resolvePromotion` from treating a broken bound as a
 * real instant.
 */
function toNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Build the WHERE clause for a catalogue query.
 *
 * `excludeIds` is not part of the public `ProductQuery`: it exists so a homepage
 * shelf can skip products an earlier shelf already showed. It is applied here
 * rather than in the component because it has to be applied *before* the LIMIT -
 * filtering a returned page afterwards would leave the shelf short.
 *
 * Exported so the load test can assert the plan uses the indexes without
 * having to go through HTTP.
 */
export function buildProductFilters(query: ProductQuery, excludeIds: number[] = []): SQL[] | undefined {
  const filters: SQL[] = [];

  const skip = excludeIds.filter((id) => Number.isInteger(id) && id > 0);
  if (skip.length > 0) {
    filters.push(notInArray(products.id, skip));
  }

  if (query.search) {
    // Case-insensitive substring on the name. `lower()` keeps this identical on
    // both dialects: PostgreSQL's LIKE is case-sensitive and SQLite's is only
    // case-insensitive for ASCII, so relying on the default would give two
    // different result sets from one API.
    //
    // A leading-wildcard LIKE cannot use a B-tree index, so this is a scan by
    // design. At catalogue sizes in the thousands that measures in single-digit
    // milliseconds (see server/scripts/loadtest-products.ts). If the catalogue
    // ever reaches six figures, this is the line to replace with PostgreSQL
    // pg_trgm or SQLite FTS5 rather than adding another index here.
    const pattern = `%${escapeLikePattern(query.search.toLowerCase())}%`;
    filters.push(sql`lower(${products.name}) like ${pattern} escape '\\'`);
  }

  if (query.category) {
    filters.push(sql`${products.category} = ${query.category}`);
  }

  if (query.stock === "in") {
    filters.push(sql`${products.quantity} > 0`);
  } else if (query.stock === "out") {
    // `= 0` rather than `<= 0`: negative stock is not representable in the UI
    // (writes go through toQuantity, which clamps at 0), so `= 0` is the exact
    // condition asked for and cannot silently match corrupt rows.
    filters.push(sql`${products.quantity} = 0`);
  } else if (query.stock === "low") {
    // Still sellable, but barely. `> 0` keeps `low` disjoint from `out`, so a
    // product can never be counted in both buckets.
    filters.push(sql`${products.quantity} > 0 AND ${products.quantity} <= ${PRODUCT_LOW_STOCK_THRESHOLD}`);
  }

  if (query.maxPrice !== undefined) {
    // `price` has been a numeric column since migration 0002 (double precision on
    // PostgreSQL, real on SQLite), so this is a numeric comparison and needs no
    // cast - and no dialect branch, unlike the money columns on `orders`.
    filters.push(sql`${products.price} <= ${query.maxPrice}`);
  }

  if (query.promo === "active") {
    // The "promotions only" filter, and it is the *server* that decides. The
    // predicate deliberately mirrors `resolvePromotion` in shared/promotions.ts
    // — a promo price that is set, non-negative, strictly below the regular
    // price, and inside the half-open window [promo_start, promo_end) — so the
    // filter, the badge and the checkout price can never disagree about which
    // products are on offer.
    //
    // `now` is bound once as a parameter, not read per row, so every row in this
    // query is judged against the same instant. The partial index
    // idx_products_promoted covers the first term and keeps the scan to promoted
    // rows only.
    const nowMs = Date.now();
    // The bound value has to match how the column is actually stored, and the two
    // dialects differ:
    //
    //   PostgreSQL `timestamp` is compared correctly against a JS Date.
    //   SQLite stores the same column as an INTEGER of epoch SECONDS (Drizzle's
    //   `mode: "timestamp"` divides by 1000), and better-sqlite3 cannot bind a
    //   Date at all — it throws. Worse, binding milliseconds would not throw,
    //   it would silently match every row: a millisecond instant is ~1000x
    //   larger than a second instant, so "promo_start <= now" becomes true for
    //   promotions that have not started yet and the filter lists future offers
    //   as live.
    //
    // Hence seconds on SQLite, Date on PostgreSQL.
    const nowBound: Date | number =
      resolveDbTarget().dialect === "postgresql" ? new Date(nowMs) : Math.floor(nowMs / 1000);
    filters.push(sql`${products.promoPrice} is not null
        and ${products.promoPrice} >= 0
        and ${products.promoPrice} < ${products.price}
        and (${products.promoStart} is null or ${products.promoStart} <= ${nowBound})
        and (${products.promoEnd} is null or ${products.promoEnd} > ${nowBound})`);
  }

  return filters.length > 0 ? filters : undefined;
}

/**
 * ORDER BY for a catalogue query.
 *
 * Every branch ends with `id` so the ordering is total. Without that tiebreak,
 * rows sharing a created_at (the migration backfills every pre-existing row with
 * the same timestamp) could repeat or vanish across pages.
 */
export function buildProductOrderBy(sort: ProductQuery["sort"]): SQL[] {
  switch (sort) {
    case "price_asc":
      return [asc(products.price), desc(products.id)];
    case "price_desc":
      return [desc(products.price), desc(products.id)];
    case "name_asc":
      return [sql`lower(${products.name}) asc`, asc(products.id)];
    case "stock_asc":
      return [asc(products.quantity), asc(products.id)];
    case "stock_desc":
      return [desc(products.quantity), desc(products.id)];
    case "newest":
    default:
      return [desc(products.createdAt), desc(products.id)];
  }
}

export class DatabaseStorage implements IStorage {
  /**
   * The one place that knows how to read the catalogue.
   *
   * Filtering, searching, sorting, the total and the page window are all done by
   * the database. The browser receives at most `limit` rows and never sees the
   * full table, which is what makes 3,000+ products viable.
   *
   * Why this replaced `getProducts()` rather than sitting next to it: the old
   * method had no ORDER BY at all, so its output order was whatever the database
   * felt like returning, and it read the entire table on every call. Keeping it
   * "for compatibility" would have left the homepage and the admin panel doing
   * exactly that. The single envelope is enforced by shared/routes.ts, so the
   * compiler catches any caller left behind.
   */
  async queryProducts(query: ProductQuery): Promise<ProductListResponse> {
    return this.runProductQuery(query, []);
  }

  /**
   * The shared body of every product read: filters, sort, total and page window.
   *
   * Split out so `queryHomepageSectionProducts` cannot grow its own subtly
   * different filtering path - the whole point of the shelf work is that a
   * homepage shelf is the same query as a catalogue page with a different limit.
   */
  private async runProductQuery(query: ProductQuery, excludeIds: number[]): Promise<ProductListResponse> {
    const filters = buildProductFilters(query, excludeIds);
    const where = filters ? and(...filters) : undefined;
    const offset = (query.page - 1) * query.limit;

    // COUNT and the page window run as two statements. They read the same
    // snapshot-per-statement but the count is only used for the total, so a
    // concurrent insert can make them disagree by one row for a single request,
    // which the UI absorbs. A window function would force both through one pass
    // at the cost of a full scan of the result set, which is the wrong trade at
    // this size.
    const [totals] = await db.select({ value: count() }).from(products).where(where);

    const items = await db
      .select()
      .from(products)
      .where(where)
      .orderBy(...buildProductOrderBy(query.sort))
      .limit(query.limit)
      .offset(offset);

    const total = Number(totals?.value ?? 0);

    return {
      items: items as unknown as Product[],
      page: query.page,
      limit: query.limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
    };
  }

  async getProduct(id: number): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createMessage(insertMessage: InsertMessage): Promise<Message> {
    const [message] = await db.insert(messages).values(insertMessage).returning();
    return message;
  }

  async getMessages(): Promise<Message[]> {
    return await db.select().from(messages).orderBy(desc(messages.createdAt));
  }

  async deleteMessage(id: number): Promise<boolean> {
    const result = await db.delete(messages).where(eq(messages.id, id)).returning();
    return result.length > 0;
  }

  async updateMessageStatus(id: number, status: string): Promise<Message | undefined> {
    const [message] = await db.update(messages).set({ status }).where(eq(messages.id, id)).returning();
    return message;
  }

  async updateMessageStatusWithActor(id: number, status: string, actorUsername: string): Promise<Message | undefined> {
    const now = new Date();
    const updateData: any = { status };

    if (status === "approved") {
      updateData.approvedBy = actorUsername;
      updateData.approvedAt = now;
    } else if (status === "rejected") {
      updateData.rejectedBy = actorUsername;
      updateData.rejectedAt = now;
    }

    const [message] = await db.update(messages).set(updateData).where(eq(messages.id, id)).returning();
    return message;
  }

  /**
   * price/quantity are numeric columns as of migration 0002. The admin form and
   * the order pipeline both hand us strings ("20.500"), and `updateProduct` is
   * called with a raw request body, so every write is normalised here rather than
   * at each call site. One choke point means no path can slip a text value back
   * into a numeric column and break sorting.
   */
  private normaliseProductNumbers<T extends Record<string, any>>(data: T): T {
    const next: Record<string, any> = { ...data };
    if (next.price !== undefined) next.price = toPrice(next.price);
    if (next.quantity !== undefined) next.quantity = toQuantity(next.quantity);
    // Promotion fields (migration 0003), normalised on the same choke point as
    // price and quantity. The admin form sends "" for an empty date input and ""
    // for a cleared promo price, which must become SQL NULL rather than 0 — a
    // promo of 0 would be a 100% discount, not an absent promotion.
    if ("promoPrice" in next) next.promoPrice = toNullablePrice(next.promoPrice);
    if ("promoStart" in next) next.promoStart = toNullableDate(next.promoStart);
    if ("promoEnd" in next) next.promoEnd = toNullableDate(next.promoEnd);
    return next as T;
  }

  async createProduct(insertProduct: InsertProduct): Promise<Product> {
    const [product] = await db.insert(products).values(this.normaliseProductNumbers(insertProduct as any)).returning();
    return product as unknown as Product;
  }

  async updateProduct(id: number, update: Partial<InsertProduct>): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set(this.normaliseProductNumbers(update as any))
      .where(eq(products.id, id))
      .returning();
    return product as unknown as Product | undefined;
  }

  async deleteProduct(id: number): Promise<boolean> {
    const result = await db.delete(products).where(eq(products.id, id)).returning();
    return result.length > 0;
  }

  async updateProductStock(id: number, quantity: number): Promise<Product | undefined> {
    const [product] = await db
      .update(products)
      .set({ quantity: toQuantity(quantity) })
      .where(eq(products.id, id))
      .returning();
    return product as unknown as Product | undefined;
  }

  async getPromos(): Promise<Promo[]> {
    return await db.select().from(promos).orderBy(desc(promos.createdAt));
  }

  async createPromo(insertPromo: InsertPromo): Promise<Promo> {
    const [promo] = await db.insert(promos).values(insertPromo).returning();
    return promo;
  }

  async updatePromo(id: number, update: Partial<InsertPromo>): Promise<Promo | undefined> {
    const [promo] = await db.update(promos).set(update).where(eq(promos.id, id)).returning();
    return promo;
  }

  async deletePromo(id: number): Promise<boolean> {
    const result = await db.delete(promos).where(eq(promos.id, id)).returning();
    return result.length > 0;
  }

  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

    async getUserByUsername(username: string): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.username, username));
        // A missing role means an incomplete row, so it resolves to the customer
        // role. This must never upgrade to admin: getUserByUsername backs the
        // public login endpoint.
        if (user) (user as any).role = normaliseStoredRole(user.role);
        return user;
    }

    async getUserByEmail(email: string): Promise<User | undefined> {
        const [user] = await db.select().from(users).where(eq(users.email, email));
        // The stored role is returned verbatim. This method previously forced
        // `superadmin` for a hardcoded pair of email addresses on every read,
        // which combined with the unverified /api/register endpoint into a full
        // admin takeover: register with an owner address, log in, done.
        if (user) (user as any).role = normaliseStoredRole(user.role);
        return user;
    }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async updateUserPassword(id: number, password: string): Promise<void> {
    dbg(`[DB] Updating password for user #${id}`);
    const result = await db.update(users).set({ password }).where(eq(users.id, id)).returning();
    if (result.length === 0) {
      console.error(`[DB] Password update failed: user #${id} not found`);
      throw new Error(`User with ID ${id} not found for password update`);
    }
  }

  async setResetToken(id: number, token: string | null, expires: Date | null): Promise<void> {
    await db.update(users).set({ resetToken: token, resetTokenExpires: expires }).where(eq(users.id, id)).returning();
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async getUsers(): Promise<User[]> {
    const allUsers = await db.select().from(users);
    return allUsers.map((u: User) => ({ ...u, role: u.role || "admin" }));
  }

  /**
   * Delete an account.
   *
   * Favourites are removed explicitly rather than by an `ON DELETE CASCADE` on
   * `wishlist.user_id`. Product deletion cascades from the database, but account
   * deletion happens far more rarely and is an explicitly requested action, so an
   * explicit statement is easier to audit than an invisible constraint — and the
   * order matters: the wishlist rows go first, because nothing here would stop the
   * user row from being deleted and leaving entries pointing at a missing owner.
   */
  async deleteUser(id: number): Promise<boolean> {
    const result = await db.delete(users).where(eq(users.id, id)).returning();
    if (result.length === 0) return false;
    await db.delete(wishlist).where(eq(wishlist.userId, id));
    return true;
  }

  async createUserActivity(userId: number, type: string, details?: string): Promise<void> {
    await db.insert(userActivities).values({ userId, type, details: details || null });
  }

  async getUserActivities(): Promise<UserActivity[]> {
    return await db.select().from(userActivities).orderBy(desc(userActivities.createdAt));
  }

  // Sticker Catalogs
  async getStickerCatalogs(): Promise<StickerCatalog[]> {
    return await db.select().from(stickerCatalogs);
  }

  async createStickerCatalog(data: InsertStickerCatalog): Promise<StickerCatalog> {
    const [catalog] = await db.insert(stickerCatalogs).values(data).returning();
    return catalog;
  }

  async updateStickerCatalog(id: number, update: Partial<InsertStickerCatalog>): Promise<StickerCatalog | undefined> {
    const [catalog] = await db.update(stickerCatalogs).set(update).where(eq(stickerCatalogs.id, id)).returning();
    return catalog;
  }

  async deleteStickerCatalog(id: number): Promise<boolean> {
    const result = await db.delete(stickerCatalogs).where(eq(stickerCatalogs.id, id)).returning();
    return result.length > 0;
  }

async updateUserRole(id: number, role: string): Promise<void> {
    await db.update(users).set({ role }).where(eq(users.id, id)).returning();
  }

  async updateUserGoogleId(id: number, googleId: string): Promise<void> {
    dbg(`[DB] Linking Google account for user #${id}`);
    await db.update(users).set({ googleId }).where(eq(users.id, id)).returning();
  }

  async getUserActivitiesByUserId(userId: number): Promise<UserActivity[]> {
    return await db.select().from(userActivities).where(eq(userActivities.userId, userId)).orderBy(desc(userActivities.createdAt));
  }

  async updateUser(id: number, data: Partial<Pick<User, "fullName" | "phone" | "email">>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }


  async getCategories(): Promise<Category[]> {
    return await db.select().from(categories).orderBy(categories.name);
  }

  async createCategory(category: InsertCategory & { slug: string }): Promise<Category> {
    const [created] = await db.insert(categories).values(category).returning();
    return created;
  }

  async updateCategory(id: number, category: Partial<InsertCategory> & { slug?: string }): Promise<Category | undefined> {
    const [updated] = await db.update(categories).set(category).where(eq(categories.id, id)).returning();
    return updated;
  }

  async deleteCategory(id: number): Promise<boolean> {
    const result = await db.delete(categories).where(eq(categories.id, id)).returning();
    return result.length > 0;
  }

  /** Money columns are TEXT and fulfillment is a plain string in the DB. */
  private toOrder(row: any): Order {
    return {
      ...row,
      subtotal: Number(row.subtotal || 0),
      total: Number(row.total || 0),
      deliveryFee: Number(row.deliveryFee || 0),
      fulfillmentMethod: row.fulfillmentMethod === "pickup" ? "pickup" : "delivery",
    };
  }

  async getOrders(): Promise<Order[]> {
    const rows = await db.select().from(orders).orderBy(desc(orders.createdAt));
    return rows.map((row: any) => this.toOrder(row));
  }

  async getOrdersByUserId(userId: number): Promise<Order[]> {
    // `eq` excludes NULL user_id, which is exactly right: guest orders (placed
    // before an account existed) have user_id IS NULL and must never be claimed
    // by whichever customer happens to hold the same email.
    const rows = await db.select().from(orders).where(eq(orders.userId, userId)).orderBy(desc(orders.createdAt));
    return rows.map((row: any) => this.toOrder(row));
  }

  async getOrderByIdForUser(id: number, userId: number): Promise<Order | undefined> {
    const [row] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, id), eq(orders.userId, userId)))
      .limit(1);
    return row ? this.toOrder(row) : undefined;
  }

  async createOrder(order: Omit<Order, "id" | "createdAt">): Promise<Order> {
    const [created] = await db.insert(orders).values({
      ...order,
      subtotal: String(order.subtotal),
      total: String(order.total),
      deliveryFee: String(order.deliveryFee),
    }).returning();
    return this.toOrder(created);
  }

  async updateOrderStatus(id: number, status: string): Promise<Order | undefined> {
    const [updated] = await db.update(orders).set({ status }).where(eq(orders.id, id)).returning();
    if (!updated) return undefined;
    return this.toOrder(updated);
  }

  /**
   * Delivery amounts are stored as TEXT (like every other money column in this
   * schema) and the flags come back as 0/1 on SQLite. Normalise them once here so
   * routes and the client always see booleans and numbers.
   */
  private toSettings(row: any): Settings {
    return {
      ...row,
      pickupEnabled: row.pickupEnabled === true || row.pickupEnabled === 1,
      deliveryEnabled: row.deliveryEnabled === true || row.deliveryEnabled === 1,
      deliveryFee: Number(row.deliveryFee ?? 0) || 0,
      freeDeliveryThreshold: Number(row.freeDeliveryThreshold ?? 0) || 0,
    };
  }

  async getSettings(): Promise<Settings> {
    const [s] = await db.select().from(settings).limit(1);
    if (!s) {
      // Create default settings if none exist
      const [newSettings] = await db.insert(settings).values({
        instagramReel: "",
        facebookReel: "",
        tiktokReel: ""
      }).returning();
      return this.toSettings(newSettings);
    }
    return this.toSettings(s);
  }

  /** The delivery & pickup rules only, for the public checkout. */
  async getDeliverySettings(): Promise<DeliverySettings> {
    const s = await this.getSettings();
    return {
      pickupEnabled: s.pickupEnabled,
      deliveryEnabled: s.deliveryEnabled,
      deliveryFee: s.deliveryFee,
      freeDeliveryThreshold: s.freeDeliveryThreshold,
      deliveryNote: s.deliveryNote || null,
    };
  }

  async updateSettings(insertSettings: InsertSettings): Promise<Settings> {
    const existing = await this.getSettings();
    // Money columns are TEXT: accept numbers from the Zod schema and store strings.
    const { deliveryFee, freeDeliveryThreshold, ...rest } = insertSettings;
    const [s] = await db.update(settings)
      .set({
        ...rest,
        ...(deliveryFee === undefined ? {} : { deliveryFee: String(deliveryFee) }),
        ...(freeDeliveryThreshold === undefined ? {} : { freeDeliveryThreshold: String(freeDeliveryThreshold) }),
        updatedAt: new Date(),
      })
      .where(eq(settings.id, existing.id))
      .returning();
    return this.toSettings(s);
  }

  async getSocialMediaEmbeds(): Promise<SocialMediaEmbed[]> {
    return await db.select().from(socialMediaEmbeds);
  }

  async upsertSocialMediaEmbed(platform: SocialPlatform, url: string | null): Promise<SocialMediaEmbed> {
    const [existing] = await db
      .select()
      .from(socialMediaEmbeds)
      .where(eq(socialMediaEmbeds.platform, platform));

    if (existing) {
      const [updated] = await db
        .update(socialMediaEmbeds)
        .set({ url, updatedAt: new Date() })
        .where(eq(socialMediaEmbeds.id, existing.id))
        .returning();
      return updated;
    }

    const [created] = await db
      .insert(socialMediaEmbeds)
      .values({ platform, url })
      .returning();
    return created;
  }

  async deleteSocialMediaEmbed(platform: SocialPlatform): Promise<boolean> {
    const result = await db
      .delete(socialMediaEmbeds)
      .where(eq(socialMediaEmbeds.platform, platform))
      .returning();
    return result.length > 0;
  }

  /**
   * Clamp a shelf's product count into the range the homepage is designed for.
   *
   * The route already validates with Zod, but the column is a plain integer: a
   * value written by hand, by an older build, or by a direct SQL edit must not be
   * able to turn one shelf into a full-catalogue download.
   */
  private clampSectionLimit(value: unknown): number {
    const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return HOMEPAGE_SECTION_DEFAULT_PRODUCTS;
    return Math.min(HOMEPAGE_SECTION_MAX_PRODUCTS, Math.max(HOMEPAGE_SECTION_MIN_PRODUCTS, Math.floor(n)));
  }

  /**
   * Turn a stored shelf into the catalogue query it stands for.
   *
   * This is the whole contract between the admin's "type" dropdown and what the
   * homepage renders, so it lives in one function rather than in a switch inside
   * the route: a new shelf type cannot be added to the admin UI without the
   * server knowing how to serve it.
   *
   * `best_sellers` is handled by the caller instead, because it is the one type
   * that cannot be expressed as a filtered catalogue query - it is a ranking
   * derived from order history, not a property of a product row.
   */
  private sectionQuery(section: HomepageSection): ProductQuery {
    const limit = this.clampSectionLimit(section.maxProducts);
    switch (section.type) {
      case "promotions":
        return productQuerySchema.parse({ limit, promo: "active", sort: "newest" });
      case "low_stock":
        // Ascending stock, so the products closest to running out lead the shelf.
        return productQuerySchema.parse({ limit, stock: "low", sort: "stock_asc" });
      case "category":
        return productQuerySchema.parse({ limit, category: section.category ?? "", sort: "newest" });
      case "price_under":
        return productQuerySchema.parse({ limit, maxPrice: Number(section.maxPrice) || undefined, sort: "price_asc" });
      case "newest":
      case "best_sellers":
      default:
        return productQuerySchema.parse({ limit, sort: "newest" });
    }
  }

  async queryHomepageSectionProducts(section: HomepageSection, excludeIds: number[] = []): Promise<Product[]> {
    const limit = this.clampSectionLimit(section.maxProducts);

    if (section.type === "best_sellers") {
      const ids = await getBestSellingProductIds(limit, excludeIds);
      if (ids.length === 0) return [];
      const rows = await db
        .select()
        .from(products)
        .where(inArray(products.id, ids));
      // An `IN (...)` query returns rows in whatever order the planner finds
      // cheapest, which is rarely the sales ranking this shelf exists to show, so
      // the id order is re-applied here. Rows missing from the map are products
      // deleted since they were sold: they drop out rather than rendering as an
      // empty card.
      const byId = new Map<number, unknown>(rows.map((row: any) => [Number(row.id), row]));
      return ids
        .map((id) => byId.get(id))
        .filter((row): row is unknown => row !== undefined) as unknown as Product[];
    }

    const response = await this.runProductQuery(this.sectionQuery(section), excludeIds);
    return response.items;
  }

  /**
   * Resolve every enabled shelf in one pass.
   *
   * Two properties this buys over resolving shelves independently:
   *
   * DE-DUPLICATION IS EXACT. Each shelf receives the ids already shown above it,
   * so a product appears once on the page even when two shelves would otherwise
   * both select it. Because the exclusion is applied before the LIMIT, a shelf
   * that loses candidates still fills its row from further down the list instead
   * of coming up short.
   *
   * ONE ROUND TRIP FOR THE HOMEPAGE. A per-shelf endpoint would make each shelf
   * refetch as soon as the shelf above it resolves, because the ids it must skip
   * are only known then.
   *
   * A shelf with no products is dropped entirely - a heading with nothing under it
   * reads as a broken page, and "low stock" or "price under X" legitimately
   * matches nothing once the shop runs out.
   */
  async queryHomepageShelves(): Promise<HomepageShelf[]> {
    const sections = await this.getHomepageSections(false);
    const shelves: HomepageShelf[] = [];
    const shown: number[] = [];

    for (const section of sections) {
      const products = await this.queryHomepageSectionProducts(section, shown);
      if (products.length === 0) continue;
      shown.push(...products.map((product) => Number(product.id)));
      shelves.push({ ...section, products });
    }

    return shelves;
  }

  private toHomepageSection(row: any): HomepageSection {
    return {
      ...row,
      type: row.type as HomepageSectionType,
      maxPrice: row.maxPrice === null || row.maxPrice === undefined ? null : Number(row.maxPrice),
      maxProducts: this.clampSectionLimit(row.maxProducts),
      displayOrder: Number(row.displayOrder ?? 0),
      enabled: row.enabled === true || row.enabled === 1,
    };
  }

  /**
   * Normalise a write the same way every other table in this file is normalised.
   *
   * The admin form sends "" for a cleared text input and "" for an emptied
   * number input. Left alone those become empty strings in the database, and
   * `section.category ?? ""` would then look like a configured category named ""
   * instead of "no category" - which fails the route's own validation on the next
   * edit. Coercing at this choke point means no caller can store one.
   */
  private normaliseHomepageSection<T extends Record<string, any>>(data: T): T {
    const next: Record<string, any> = { ...data };
    // Every nullable localized text column, plus the language-independent ones.
    // `titleFr` is deliberately absent: it is NOT NULL and Zod already rejects an
    // empty value, so coercing "" here would only turn a rejected write into a
    // database constraint error.
    const textKeys = [
      "category",
      "titleEn",
      "titleAr",
      "tileImageUrl",
      "tileTitleFr",
      "tileTitleEn",
      "tileTitleAr",
      "tileSubtitleFr",
      "tileSubtitleEn",
      "tileSubtitleAr",
      "tileCtaLabelFr",
      "tileCtaLabelEn",
      "tileCtaLabelAr",
      "tileHref",
    ] as const;
    for (const key of textKeys) {
      if (key in next) {
        const value = next[key];
        next[key] = typeof value === "string" && value.trim() === "" ? null : value ?? null;
      }
    }
    if ("maxPrice" in next) {
      const value = next.maxPrice;
      next.maxPrice = value === null || value === undefined || value === "" ? null : toPrice(value);
    }
    if ("maxProducts" in next && next.maxProducts !== undefined && next.maxProducts !== null) {
      next.maxProducts = this.clampSectionLimit(next.maxProducts);
    }
    return next as T;
  }

  async getHomepageSections(includeDisabled = false): Promise<HomepageSection[]> {
    const rows = await db
      .select()
      .from(homepageSections)
      .where(includeDisabled ? undefined : eq(homepageSections.enabled, true))
      .orderBy(asc(homepageSections.displayOrder), asc(homepageSections.id));
    return rows.map((row: any) => this.toHomepageSection(row));
  }

  async getHomepageSection(id: number): Promise<HomepageSection | undefined> {
    const [row] = await db.select().from(homepageSections).where(eq(homepageSections.id, id));
    return row ? this.toHomepageSection(row) : undefined;
  }

  async createHomepageSection(section: HomepageSectionInput): Promise<HomepageSection> {
    const [created] = await db
      .insert(homepageSections)
      .values(this.normaliseHomepageSection(section as Record<string, any>))
      .returning();
    return this.toHomepageSection(created);
  }

  async updateHomepageSection(id: number, patch: HomepageSectionPatch): Promise<HomepageSection | undefined> {
    const [updated] = await db
      .update(homepageSections)
      .set({ ...this.normaliseHomepageSection(patch as Record<string, any>), updatedAt: new Date() })
      .where(eq(homepageSections.id, id))
      .returning();
    return updated ? this.toHomepageSection(updated) : undefined;
  }

  async deleteHomepageSection(id: number): Promise<boolean> {
    const result = await db.delete(homepageSections).where(eq(homepageSections.id, id)).returning();
    return result.length > 0;
  }

  /**
   * Persist a new display order from an ordered list of ids.
   *
   * Positions are written as multiples of 10 rather than 0..n-1 so that inserting
   * a single shelf later only needs one row changed instead of renumbering every
   * row below it. Ids the caller did not mention keep their position, and unknown
   * ids are ignored rather than creating rows.
   */
  async reorderHomepageSections(orderedIds: number[]): Promise<HomepageSection[]> {
    const unique = orderedIds.filter((id) => Number.isInteger(id) && id > 0);
    for (let index = 0; index < unique.length; index += 1) {
      await db
        .update(homepageSections)
        .set({ displayOrder: (index + 1) * 10, updatedAt: new Date() })
        .where(eq(homepageSections.id, unique[index]));
    }
    return this.getHomepageSections(true);
  }

  /**
   * Load a customer's favourites with their products in one round trip.
   *
   * A single `innerJoin` rather than "read the ids, then call getProduct per id":
   * the latter is N+1, and a wishlist of 40 items would be 41 queries on the one
   * page where latency is most visible.
   *
   * The join is an INNER join on purpose. `wishlist.product_id` cascades on
   * product delete (migration 0004), so this normally cannot see a dangling
   * reference — but if foreign keys are ever off, or a row predates the cascade,
   * an inner join silently drops the orphan rather than shipping the account page
   * a card with no name and no image. A missing row is strictly better than a
   * broken one.
   */
  async listWishlist(userId: number): Promise<WishlistListResponse> {
    const rows = await db
      .select({
        id: wishlist.id,
        productId: wishlist.productId,
        createdAt: wishlist.createdAt,
        product: products,
      })
      .from(wishlist)
      .innerJoin(products, eq(products.id, wishlist.productId))
      .where(eq(wishlist.userId, userId))
      .orderBy(desc(wishlist.createdAt), desc(wishlist.id));

    const items = rows.map((row: any) =>
      toWishlistItem(
        { id: row.id, productId: row.productId, createdAt: row.createdAt },
        row.product as unknown as Product,
      ),
    );
    return { items, total: items.length };
  }

  async isWishlisted(userId: number, productId: number): Promise<boolean> {
    const [row] = await db
      .select({ id: wishlist.id })
      .from(wishlist)
      .where(and(eq(wishlist.userId, userId), eq(wishlist.productId, productId)))
      .limit(1);
    return !!row;
  }

  /**
   * Favourite a product, doing nothing if it already is.
   *
   * The product check and the insert are two statements rather than one, because
   * the database will reject a row for a missing product anyway (the foreign key)
   * — but a constraint violation surfaces as an error, and "you cannot favourite
   * a product that does not exist" is a 404, not a 500. Checking first also keeps
   * the idempotent path (already favourited) from ever touching the FK.
   *
   * `onConflictDoNothing` is what makes a duplicate add a no-op instead of an
   * error. The unique index on `(user_id, product_id)` is the actual guard; this
   * is how we absorb the violation rather than crash on it. Two clicks arriving
   * together therefore produce one row, not a 500 on the second.
   *
   * `created` reports whether a row was actually written, so the route can answer
   * 201 for a new favourite and 200 for a repeat. Both are successes; the flag
   * just lets the client avoid a needless refetch.
   */
  async addWishlistItem(userId: number, productId: number): Promise<{ created: boolean } | undefined> {
    const product = await this.getProduct(productId);
    if (!product) return undefined;

    const inserted = await db
      .insert(wishlist)
      .values({ userId, productId })
      .onConflictDoNothing({ target: [wishlist.userId, wishlist.productId] })
      .returning({ id: wishlist.id });

    return { created: inserted.length > 0 };
  }

  /**
   * Unfavourite, scoped to the owner.
   *
   * Returns false both when nothing matched and when the product does not exist,
   * which is deliberate: "you have not favourited this" and "this is not a thing
   * you can favourite" are the same answer from a customer's point of view, and
   * distinguishing them would leak whether an id exists in the catalogue.
   */
  async removeWishlistItem(userId: number, productId: number): Promise<boolean> {
    const result = await db
      .delete(wishlist)
      .where(and(eq(wishlist.userId, userId), eq(wishlist.productId, productId)))
      .returning({ id: wishlist.id });
    return result.length > 0;
  }
}

export const storage = new DatabaseStorage();
