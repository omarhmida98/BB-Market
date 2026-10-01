-- Analytics read index. See the SQLite migration for the full rationale, including
-- why the index does not lead with `status`. The only difference here is that
-- `created_at` is a timestamp rather than an integer, so the btree stores
-- timestamps directly with no conversion.
CREATE INDEX "idx_orders_created_at" ON "orders" USING btree ("created_at");
