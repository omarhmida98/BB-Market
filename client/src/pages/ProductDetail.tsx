import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { useProduct } from "@/hooks/use-products";
import { Link, useRoute } from "wouter";
import { Loader2, ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import NotFound from "./not-found";
import { ImageViewerModal } from "@/components/ImageViewerModal";
import { PromoPrice } from "@/components/PromoPrice";
import { AddToCart } from "@/components/AddToCart";
import { FavoriteButton } from "@/components/FavoriteButton";
import { useState } from "react";

import { useTranslation } from "react-i18next";
import { SiteBackground } from "@/components/SiteBackground";

export default function ProductDetail() {
  const { t } = useTranslation();
  const [, params] = useRoute("/products/:id");
  const id = params ? parseInt(params.id) : 0;
  const [isImageViewerOpen, setIsImageViewerOpen] = useState(false);

  const { data: product, isLoading, isError } = useProduct(id);


  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex justify-center items-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin" />
      </div>
    );
  }

  if (!product || isError) {
    return <NotFound />;
  }




  return (
    <div className="min-h-screen font-sans relative bg-background text-foreground">
      <SiteBackground />
      <Navbar />

      <div className="pt-32 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

          <Link href="/products" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary transition-colors mb-8">
            <ArrowLeft className="w-4 h-4 rtl:rotate-180" /> {t("product_detail.back_to_products")}
          </Link>

          <div className="bg-card/80 backdrop-blur-md rounded-3xl overflow-hidden shadow-xl border border-border">
            <div className="grid lg:grid-cols-2">
              {/* Image Section */}
              <div className="relative h-96 lg:h-auto bg-gray-100 dark:bg-slate-900 cursor-pointer" onClick={() => setIsImageViewerOpen(true)}>
                {/* Decorative pattern */}
                <div className="absolute inset-0 opacity-5 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:16px_16px]"></div>

                <img
                  src={product.imageUrl}
                  alt={product.name}
                  className="absolute inset-0 w-full h-full object-cover hover:brightness-110 transition-all"
                />
              </div>

              {/* Content Section */}
              <div className="p-8 lg:p-12 flex flex-col justify-center min-w-0">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                >
                  <span className="inline-block px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-semibold mb-6 max-w-full break-words">
                    {product.category}
                  </span>

                  <h1 className="text-4xl lg:text-5xl font-display font-bold text-foreground mb-6 leading-tight break-words">
                    <bdi>{product.name}</bdi>
                  </h1>

                  {/* Same component as the card and the admin list, so all three always agree on
                      the price. It also renders the "offer ends" line when a
                      window is set. */}
                  <div className="mb-5">
                    <PromoPrice product={product} size="lg" />
                  </div>

                  <div className="prose prose-lg text-muted-foreground mb-8 leading-relaxed break-words">
                    <p><bdi>{product.description}</bdi></p>
                  </div>

                  {/* Primary purchase action, using the shared cart store. */}
                  <AddToCart product={product} />

                  {/* `end-*` so the button follows the RTL flip and sits opposite
                      the category pill. */}
                  <div className="flex justify-end mt-5">
                    <FavoriteButton product={product} variant="inline" size="lg" />
                  </div>

                </motion.div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <ImageViewerModal
        isOpen={isImageViewerOpen}
        onClose={() => setIsImageViewerOpen(false)}
        imageUrl={product.imageUrl}
        title={product.name}
        description={product.description}
      />

      <Footer />
    </div>
  );
}
