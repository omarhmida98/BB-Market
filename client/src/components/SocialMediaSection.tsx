import { SOCIAL_PLATFORMS, type SocialPlatform } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { useSocialMedia } from "@/hooks/use-social-media";
import { SocialEmbed, platformIcon } from "@/components/SocialEmbed";

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  tiktok: "TikTok",
};

const PLATFORM_ACCENT: Record<SocialPlatform, string> = {
  instagram: "text-pink-500",
  facebook: "text-blue-600 dark:text-blue-400",
  tiktok: "text-slate-900 dark:text-white",
};

export function SocialMediaSection() {
  const { t } = useTranslation();
  const { data, isLoading } = useSocialMedia();

  const urlFor = (platform: SocialPlatform): string | null => {
    const row = (data || []).find((item) => item.platform === platform);
    const url = row?.url?.trim();
    return url ? url : null;
  };

  return (
    <section className="py-20" id="social-media">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <p className="text-[#ff6200] font-black uppercase tracking-[.22em] text-xs mb-2">B&B MARKET</p>
          <h2 className="text-3xl sm:text-4xl font-display font-black text-foreground">
            {t("social.title", "Suivez-nous")}
          </h2>
          <p className="text-muted-foreground mt-2">
            {t("social.subtitle", "Nos dernières publications, directement depuis nos réseaux sociaux.")}
          </p>
        </div>

        {isLoading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {SOCIAL_PLATFORMS.map((platform) => (
              <div
                key={platform}
                className="rounded-3xl border border-border bg-card/80 backdrop-blur p-6 h-[320px] animate-pulse"
                aria-hidden="true"
              />
            ))}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {SOCIAL_PLATFORMS.map((platform) => {
              const url = urlFor(platform);
              return (
                <article
                  key={platform}
                  className="rounded-3xl border border-border bg-card/80 backdrop-blur shadow-sm p-5 sm:p-6 flex flex-col"
                >
                  <header className="flex items-center gap-3 mb-5">
                    <div className="w-11 h-11 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <span className={PLATFORM_ACCENT[platform]}>
                        {platformIcon(platform, "w-5 h-5")}
                      </span>
                    </div>
                    <div>
                      <h3 className="font-black leading-tight">{PLATFORM_LABEL[platform]}</h3>
                      <p className="text-xs text-muted-foreground">
                        {url ? t("social.live", "Publication configurée") : t("social.none", "Aucune publication")}
                      </p>
                    </div>
                  </header>

                  <div className="flex-1 flex items-start justify-center overflow-hidden">
                    {url ? (
                      <SocialEmbed platform={platform} url={url} />
                    ) : (
                      <div className="w-full rounded-2xl border border-dashed border-border bg-card/60 py-14 px-5 text-center text-muted-foreground">
                        <span className="block opacity-40 mb-3">{platformIcon(platform, "w-8 h-8 mx-auto")}</span>
                        <span className="text-sm">{t("social.empty", "Bientôt disponible")}</span>
                      </div>
                    )}
                  </div>

                  {url && (
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-5 inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-bold hover:border-[#ff6200]/50 hover:text-[#ff6200] transition-colors"
                    >
                      {t("social.open", "Voir sur")} {PLATFORM_LABEL[platform]}
                    </a>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
