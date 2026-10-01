import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, Lock, Loader2, CheckCircle2, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useTranslation } from "react-i18next";

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenParam = params.get("token");
    setToken(tokenParam);
    if (!tokenParam) {
      toast({ title: t("reset.invalid_title", "Lien invalide"), description: t("reset.invalid_desc", "Le lien de réinitialisation est absent ou invalide."), variant: "destructive" });
    }
  }, [toast, t]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!token) {
      toast({ title: t("reset.invalid_title", "Lien invalide"), description: t("reset.invalid_desc_alt", "Le lien de réinitialisation est invalide."), variant: "destructive" });
      return;
    }

    if (password.length < 6) {
      toast({ title: t("reset.too_short_title", "Mot de passe trop court"), description: t("reset.too_short_desc", "Le mot de passe doit contenir au moins 6 caractères."), variant: "destructive" });
      return;
    }

    if (password !== confirmPassword) {
      toast({ title: t("reset.mismatch_title", "Les mots de passe ne correspondent pas"), description: t("reset.mismatch_desc", "Veuillez saisir deux mots de passe identiques."), variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      await apiRequest("POST", "/api/reset-password", { token, newPassword: password });
      setDone(true);
      toast({ title: t("reset.success_title", "Mot de passe mis à jour"), description: t("reset.success_desc", "Votre mot de passe a bien été réinitialisé.") });
    } catch (error: any) {
      toast({ title: t("reset.error_title", "Erreur"), description: error.message || t("reset.error_desc", "Impossible de réinitialiser le mot de passe."), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden bg-slate-50">
      <SiteBackground />
      <Navbar />

      <div className="relative mx-auto flex min-h-[80vh] max-w-4xl items-center justify-center px-4 py-20">
        <div className="w-full max-w-md rounded-[2rem] border border-white/60 bg-white/85 p-8 shadow-[0_20px_80px_rgba(15,23,42,0.12)] backdrop-blur-xl">
          <div className="mb-8 flex items-center justify-between">
            <div>
                  <h1 className="mt-2 text-3xl font-bold text-slate-900">{t("reset.title", "Nouveau mot de passe")}</h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Lock className="h-5 w-5" />
            </div>
          </div>

          {done ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">{t("reset.done_title", "C'est bon !")}</h2>
              <p className="text-sm leading-6 text-slate-600">
                {t("reset.done_hint", "Votre mot de passe a été réinitialisé avec succès. Vous pouvez maintenant vous reconnecter.")}
              </p>
              <button
                type="button"
                onClick={() => setLocation("/login")}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("reset.go_to_login", "Aller à la connexion")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="password" className="text-sm font-bold text-slate-700">{t("reset.password_label", "Nouveau mot de passe")}</label>
                <div className="relative">
                  <Lock className="absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-11 pe-12 py-3.5 text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute end-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={t("reset.toggle_password", "Afficher ou masquer le mot de passe")}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="confirmPassword" className="text-sm font-bold text-slate-700">{t("reset.confirm_label", "Confirmer le mot de passe")}</label>
                <div className="relative">
                  <Lock className="absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="confirmPassword"
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-11 py-3.5 text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !token}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.25)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("reset.updating", "Mise à jour...")}</> : t("reset.submit", "Réinitialiser le mot de passe")}
              </button>

              <div className="text-center text-sm text-slate-600">
                <Link href="/login" className="inline-flex items-center gap-2 font-semibold text-primary hover:underline">
                  <ArrowLeft className="h-4 w-4" />
                  {t("reset.back_to_login", "Retour à la connexion")}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>

      <Footer />
    </div>
  );
}
