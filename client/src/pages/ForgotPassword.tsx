import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useTranslation } from "react-i18next";

export default function ForgotPasswordPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      toast({ title: t("forgot.email_required_title", "Email requis"), description: t("forgot.email_required_desc", "Veuillez saisir votre adresse email."), variant: "destructive" });
      return;
    }

    setLoading(true);

    try {
      await apiRequest("POST", "/api/forgot-password", { email: cleanEmail });
      setSent(true);
      toast({ title: t("forgot.sent_title", "Lien envoyé"), description: t("forgot.sent_desc", "Un lien de réinitialisation a été envoyé à votre adresse email.") });
    } catch (error: any) {
      toast({ title: t("forgot.error_title", "Erreur"), description: error.message || t("forgot.error_desc", "Impossible d'envoyer le lien."), variant: "destructive" });
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
              <h1 className="mt-2 text-3xl font-bold text-slate-900">{t("forgot.title", "Mot de passe oublié")}</h1>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
          </div>

          {sent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-bold text-slate-900">{t("forgot.sent_title", "Lien envoyé")}</h2>
              <p className="text-sm leading-6 text-slate-600">
                {t("forgot.sent_hint", "Vérifiez votre boîte mail. Un lien de réinitialisation a été envoyé à votre adresse.")}
              </p>
              <button
                type="button"
                onClick={() => setLocation("/login")}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800"
              >
                <ArrowLeft className="h-4 w-4" />
                {t("forgot.back_to_login", "Retour à la connexion")}
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-2">
                <label htmlFor="email" className="text-sm font-bold text-slate-700">{t("forgot.email_label", "Adresse email")}</label>
                <div className="relative">
                  <Mail className="absolute start-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("forgot.email_placeholder", "vous@exemple.com")}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-11 py-3.5 text-slate-900 placeholder:text-slate-400 focus:border-primary focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 font-semibold text-white shadow-[0_12px_30px_rgba(37,99,235,0.25)] transition hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {t("forgot.sending", "Envoi...")}</> : t("forgot.submit", "Envoyer le lien")}
              </button>

              <div className="text-center text-sm text-slate-600">
                <Link href="/login" className="inline-flex items-center gap-2 font-semibold text-primary hover:underline">
                  <ArrowLeft className="h-4 w-4" />
                  {t("forgot.back_to_login", "Retour à la connexion")}
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
