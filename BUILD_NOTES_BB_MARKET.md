# B&B Market build status

## Implemented
- B&B Market branding, logo, orange/green palette, dark/light mode.
- French, English and Arabic (RTL) language infrastructure.
- Navbar: Products, Contact, Cart, language/theme/account.
- Product catalogue with price and stock.
- Dynamic admin-managed categories.
- Shopping cart and checkout.
- Orders stored in database with status workflow.
- Server-side order price validation (client prices are not trusted).
- Stock validation and automatic stock decrement after an order is placed.
- Clean B&B Market admin dashboard for overview, products, categories and orders.
- Admin access for bbmarket26@gmail.com and omar.hmida.lgl@gmail.com.
- Product/category/order mutations protected by admin authorization.
- SQLite local development database and PostgreSQL schema support.

## Still planned / optional
- Delivery fee rules and delivery zones.
- Online payment provider, if required.
- Product variants (size/color), if required.
- Promo/discount model tied directly to products.
- Customer order-history redesign.
- Production deployment configuration and SMTP/payment secrets.
