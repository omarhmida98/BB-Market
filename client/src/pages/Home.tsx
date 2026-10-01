import { motion } from "framer-motion";
import { Link } from "wouter";
import { ArrowRight, ShoppingBag, Truck, ShieldCheck, Headphones, Instagram, MapPin } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ProductCard } from "@/components/ProductCard";
import { SocialMediaSection } from "@/components/SocialMediaSection";
import { useFeaturedProducts, usePromotedProducts } from "@/hooks/use-products";
import { SiteBackground } from "@/components/SiteBackground";
import { useTranslation } from "react-i18next";
import { Flame } from "lucide-react";

export default function Home() {
  const { t } = useTranslation();
  // Six rows from the database, not the first six of the whole catalogue. The
  // old version downloaded every product to render this strip.
  const { data } = useFeaturedProducts(6);
  const featured = data?.items ?? [];

  // Live promotions, filtered and capped in SQL (limit 8). The section hides
  // itself entirely when nothing is on offer, rather than leaving an empty
  // heading and an empty grid on the homepage.
  const { data: promoData } = usePromotedProducts(8);
  const promoted = promoData?.items ?? [];

  return (
    <div className="min-h-screen relative bg-background text-foreground">
      <SiteBackground />
      <Navbar />

      <main>
        <section className="relative pt-32 pb-20 lg:pt-40 lg:pb-28 overflow-hidden">
          <div className="absolute -top-28 -left-20 w-96 h-96 rounded-full bg-[#ff6200]/10 blur-3xl" />
          <div className="absolute top-24 right-0 w-[30rem] h-[30rem] rounded-full bg-primary/10 blur-3xl" />
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
            <div className="grid lg:grid-cols-2 gap-12 items-center">
              <motion.div initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55 }}>
                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-secondary border border-[#ff6200]/15 text-primary font-bold text-sm mb-6">
                  <ShoppingBag className="w-4 h-4 text-[#ff6200]" /> {t("hero.badge", "Shopping & vente au détail à Sousse")}
                </div>
                <h1 className="text-5xl sm:text-6xl lg:text-7xl font-display font-black leading-[.98] tracking-tight text-foreground">
                  {t("hero.welcome", "Bienvenue chez")} <span className="text-primary">B&B</span> <span className="text-[#ff6200]">Market</span>
                </h1>
                <p className="mt-6 text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-xl">
                  {t("hero.desc", "Découvrez nos produits, nouveautés et offres dans une expérience d'achat simple, moderne et rapide.")}
                </p>
                <div className="mt-8 flex flex-wrap gap-4">
                  <Link href="/products" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold shadow-lg shadow-primary/20 hover:-translate-y-0.5 transition-all">
                    {t("hero.btn_products", "Voir les produits")} <ArrowRight className="w-5 h-5" />
                  </Link>
                  <Link href="/contact" className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-background border border-border font-bold hover:border-[#ff6200]/50 hover:text-[#ff6200] transition-all">
                    {t("hero.btn_contact", "Nous contacter")}
                  </Link>
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, scale: .94 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: .1, duration: .55 }} className="relative">
                <div className="absolute inset-8 rounded-[3rem] bg-gradient-to-br from-[#ff6200]/20 to-primary/25 blur-3xl" />
                <div className="relative rounded-[2.5rem] border border-border bg-card/85 backdrop-blur-xl shadow-2xl p-8 sm:p-12">
                  <img src="/bb-market-logo.png" alt="B&B Market" className="w-full max-w-md mx-auto rounded-3xl object-contain" />
                </div>
              </motion.div>
            </div>
          </div>
        </section>

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10">
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              [ShoppingBag, t("home.products", "Large choix de produits")],
              [Truck, t("home.delivery", "Commande simple")],
              [ShieldCheck, t("home.quality", "Qualité & confiance")],
              [Headphones, t("home.support", "Support WhatsApp")],
            ].map(([Icon, label]: any) => (
              <div key={label} className="rounded-2xl border border-border bg-card/80 backdrop-blur p-5 flex items-center gap-4 shadow-sm">
                <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center"><Icon className="w-5 h-5" /></div>
                <span className="font-bold text-sm">{label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="py-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
              <div>
                <p className="text-[#ff6200] font-black uppercase tracking-[.22em] text-xs mb-2">B&B MARKET</p>
                <h2 className="text-3xl sm:text-4xl font-display font-black text-foreground">{t("featured.title", "Nos produits")}</h2>
                <p className="text-muted-foreground mt-2">{t("featured.subtitle", "Découvrez une sélection de nos articles.")}</p>
              </div>
              <Link href="/products" className="text-primary font-bold inline-flex items-center gap-2">{t("featured.view_all", "Tout voir")} <ArrowRight className="w-4 h-4" /></Link>
            </div>
            {featured.length ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">{featured.map(p => <ProductCard key={p.id} product={p} />)}</div>
            ) : (
              <div className="rounded-3xl border border-dashed border-border bg-card/60 py-16 text-center text-muted-foreground">{t("home.empty", "Les produits ajoutés depuis l'administration apparaîtront ici.")}</div>
            )}
          </div>
        </section>

        {promoted.length > 0 && (
          <section className="pb-20">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
                <div>
                  <p className="text-red-500 font-black uppercase tracking-[.22em] text-xs mb-2 inline-flex items-center gap-1.5">
                    <Flame className="w-4 h-4" />
                    {t("promotions.badge", "Offres en cours")}
                  </p>
                  <h2 className="text-3xl sm:text-4xl font-display font-black text-foreground">
                    {t("promotions.title", "Nos promotions")}
                  </h2>
                  <p className="text-muted-foreground mt-2">
                    {t("promotions.subtitle", "Profitez de nos prix promotionnels en cours.")}
                  </p>
                </div>
                {/* Deep-links into the catalogue with the promotion filter already
                    applied, so "see all promotions" and the strip agree on which
                    products count as promoted. */}
                <Link
                  href="/products?promo=active"
                  className="text-primary font-bold inline-flex items-center gap-2"
                >
                  {t("promotions.view_all", "Toutes les promotions")} <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {promoted.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </div>
          </section>
        )}

        <SocialMediaSection />

        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="rounded-[2rem] bg-[#063f2e] text-white p-8 sm:p-12 grid md:grid-cols-2 gap-8 items-center overflow-hidden relative">
            <div className="absolute -right-16 -bottom-28 w-80 h-80 bg-[#ff6200]/25 blur-3xl rounded-full" />
            <div className="relative">
              <h2 className="text-3xl font-display font-black text-white">{t("home.visit", "Retrouvez B&B Market à Sousse")}</h2>
              <p className="mt-3 text-white/70">Avenue Khezama, Sousse, Tunisia 4051</p>
              <a href="https://www.bing.com/maps/search?v=2&pc=FACEBK&mid=8100&mkt=fr-FR&FORM=FBKPL1&q=Avenue+Khezama%2C+Sousse%2C+Tunisia%2C+4051&cp=35.849300%7E10.613900&lvl=11&style=r" target="_blank" rel="noreferrer" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#ff6200] px-5 py-3 font-bold text-white"><MapPin className="w-5 h-5" /> {t("home.map", "Voir sur la carte")}</a>
            </div>
            <div className="relative md:text-end">
              <Link href="/#social-media" className="inline-flex items-center gap-2 text-lg font-bold hover:text-[#ffb27e]"><Instagram className="w-6 h-6" /> {t("home.social", "Suivez-nous sur nos réseaux")}</Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
