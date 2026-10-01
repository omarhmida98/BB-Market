import { useEffect, useState } from "react";
import { Facebook, Instagram, ExternalLink } from "lucide-react";
import { FaTiktok } from "react-icons/fa";
import type { SocialPlatform } from "@shared/schema";

const INSTAGRAM_SCRIPT = "https://www.instagram.com/embed.js";
const TIKTOK_SCRIPT = "https://www.tiktok.com/embed.js";

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-embed-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
      return;
    }
    const el = document.createElement("script");
    el.src = src;
    el.async = true;
    el.setAttribute("data-embed-src", src);
    el.addEventListener("load", () => {
      el.dataset.loaded = "1";
      resolve();
    }, { once: true });
    el.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
    document.body.appendChild(el);
  });
}

/** TikTok blockquotes need the numeric video id; short links (vm.tiktok.com) don't expose it. */
function extractTikTokVideoId(url: string): string | null {
  const match = url.match(/video\/(\d+)/);
  return match ? match[1] : null;
}

export function platformIcon(platform: SocialPlatform, className = "w-5 h-5") {
  if (platform === "instagram") return <Instagram className={className} />;
  if (platform === "facebook") return <Facebook className={className} />;
  return <FaTiktok className={className} />;
}

function InstagramEmbed({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    let cancelled = false;
    loadScript(INSTAGRAM_SCRIPT)
      .then(() => {
        if (cancelled) return;
        // Instagram scans the DOM once on load. Re-process so a changed URL renders.
        window.setTimeout(() => {
          const instgrm = (window as any).instgrm;
          if (instgrm?.Embeds?.process) instgrm.Embeds.process();
        }, 50);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <ExternalLinkCard url={url} />;

  return (
    <blockquote
      key={url}
      className="instagram-media mx-auto"
      data-instgrm-permalink={url}
      data-instgrm-version="14"
    />
  );
}

function TikTokEmbed({ url }: { url: string }) {
  const videoId = extractTikTokVideoId(url);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
    // TikTok's embed.js only scans the DOM on load, so re-inject it for each URL.
    document.querySelector<HTMLScriptElement>(`script[data-embed-src="${TIKTOK_SCRIPT}"]`)?.remove();
    loadScript(TIKTOK_SCRIPT).catch(() => setFailed(true));
  }, [url]);

  if (failed || !videoId) return <ExternalLinkCard url={url} />;

  return (
    <blockquote
      key={url}
      className="tiktok-embed mx-auto"
      cite={url}
      data-video-id={videoId}
    />
  );
}

function FacebookEmbed({ url }: { url: string }) {
  // The plugins/post.php iframe renders a real Facebook post without needing an App ID.
  const src = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(url)}&show_text=true&width=500`;
  return (
    <iframe
      key={url}
      src={src}
      title="Facebook"
      className="w-full border-0"
      height="500"
      loading="lazy"
      allowFullScreen
    />
  );
}

function ExternalLinkCard({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col items-center justify-center gap-3 h-full min-h-[220px] p-6 text-center rounded-2xl border border-border bg-card/60 hover:border-[#ff6200]/50 transition-colors"
    >
      <ExternalLink className="w-7 h-7 text-[#ff6200]" />
      <span className="text-sm font-bold">Voir la publication</span>
      <span className="text-xs text-muted-foreground break-all line-clamp-2">{url}</span>
    </a>
  );
}

export function SocialEmbed({ platform, url }: { platform: SocialPlatform; url: string }) {
  if (platform === "instagram") return <InstagramEmbed url={url} />;
  if (platform === "facebook") return <FacebookEmbed url={url} />;
  return <TikTokEmbed url={url} />;
}
