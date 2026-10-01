import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function ThemeToggle() {
  const { t } = useTranslation();
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return <div className="w-10 h-10" />;

  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="w-10 h-10 rounded-full border border-border bg-background/80 text-foreground hover:text-primary hover:border-primary/40 transition-all flex items-center justify-center"
      aria-label={isDark ? t("theme.enable_light", "Activer le mode clair") : t("theme.enable_dark", "Activer le mode sombre")}
      title={isDark ? t("theme.light", "Mode clair") : t("theme.dark", "Mode sombre")}
    >
      {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
