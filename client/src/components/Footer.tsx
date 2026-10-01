import { Link } from "wouter";
import { MapPin, Phone, Mail } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa";
import logo from "@assets/bb_market_logo.png";
import { useTranslation } from "react-i18next";
import { SOCIAL_PLATFORMS } from "@shared/schema";
import { useSocialMedia } from "@/hooks/use-social-media";
import { platformIcon } from "@/components/SocialEmbed";

const PLATFORM_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok" };
const PLATFORM_ACCENT: Record<string, string> = {
  instagram: "text-pink-400",
  facebook: "text-blue-300",
  tiktok: "text-white",
};

export function Footer() {
  const { t } = useTranslation();
  const { data: socialData } = useSocialMedia();
  const socialUrlFor = (platform: string) => {
    const row = (socialData || []).find((item) => item.platform === platform);
    const url = row?.url?.trim();
    return url ? url : null;
  };
  const mapUrl = "https://www.bing.com/maps/search?v=2&pc=FACEBK&mid=8100&mkt=fr-FR&FORM=FBKPL1&q=Avenue+Khezama%2C+Sousse%2C+Tunisia%2C+4051&cp=35.849300%7E10.613900&lvl=11&style=r";
  return (
    <footer className="bg-[#063f2e] text-white pt-16 pb-8 mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid md:grid-cols-3 gap-12 mb-12">
          <div>
            <img src={logo} alt="B&B Market" className="h-20 w-auto bg-white rounded-2xl p-2 mb-5" />
            <p className="text-white/70 text-sm leading-7">{t("footer.desc")}</p>
            <div className="flex gap-3 mt-6">
              {SOCIAL_PLATFORMS.map((platform) => {
                const url = socialUrlFor(platform);
                if (!url) return null;
                return (
                  <Social key={platform} href={url} label={PLATFORM_LABEL[platform]}>
                    <span className={PLATFORM_ACCENT[platform]}>{platformIcon(platform, "w-5 h-5")}</span>
                  </Social>
                );
              })}
              <Social href="https://wa.me/21627903117" label="WhatsApp"><FaWhatsapp className="w-5 h-5" /></Social>
            </div>
          </div>
          <div>
            <h4 className="font-display font-bold text-lg mb-5">{t("footer.nav_title")}</h4>
            <div className="space-y-3 text-white/70">
              <Link href="/products" className="block hover:text-white">{t("nav.products")}</Link>
              <Link href="/contact" className="block hover:text-white">{t("nav.contact")}</Link>
              <Link href="/login" className="block hover:text-white">{t("auth.login")}</Link>
              <Link href="/account" className="block hover:text-white">{t("nav.account", "Mon compte")}</Link>
            </div>
          </div>
          <div>
            <h4 className="font-display font-bold text-lg mb-5">{t("footer.contact_title")}</h4>
            <div className="space-y-4 text-sm text-white/75">
              <a href={mapUrl} target="_blank" rel="noreferrer" className="flex gap-3 hover:text-white"><MapPin className="w-5 h-5 text-[#ff6200] shrink-0" /> Avenue Khezama, Sousse, Tunisia 4051</a>
              <a href="tel:+21627903117" className="flex gap-3 hover:text-white"><Phone className="w-5 h-5 text-[#ff6200]" /> +216 27 903 117</a>
              <a href="mailto:bbmarket26@gmail.com" className="flex gap-3 hover:text-white"><Mail className="w-5 h-5 text-[#ff6200]" /> bbmarket26@gmail.com</a>
            </div>
          </div>
        </div>
        <div className="border-t border-white/10 pt-8 text-center text-sm text-white/50">© {new Date().getFullYear()} B&B Market. {t("footer.rights", "Tous droits réservés.")}</div>
      </div>
    </footer>
  );
}

function Social({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="w-10 h-10 rounded-full bg-white/10 hover:bg-[#ff6200] transition-colors flex items-center justify-center">{children}</a>;
}
