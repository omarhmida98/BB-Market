import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginCredentials } from "@shared/schema";
import { motion } from "framer-motion";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Globe,
  Lock,
  Loader2,
  LogIn,
  ShieldCheck,
  Sparkles,
  User,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";

import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { SiteBackground } from "@/components/SiteBackground";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";

const ADMIN_EMAILS = ["bbmarket26@gmail.com", "omar.hmida.lgl@gmail.com"];

const featureCards = [
  {
    titleKey: "auth.login_feature_secure_title",
    descriptionKey: "auth.login_feature_secure_desc",
    icon: ShieldCheck,
  },
  {
    titleKey: "auth.login_feature_fast_title",
    descriptionKey: "auth.login_feature_fast_desc",
    icon: Sparkles,
  },
  {
    titleKey: "auth.login_feature_support_title",
    descriptionKey: "auth.login_feature_support_desc",
    icon: Globe,
  },
];

export default function Login() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { user, loginMutation } = useAuth();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const redirectTo = new URLSearchParams(window.location.search).get("redirect") || "/products";

  const form = useForm<LoginCredentials>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
    },
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (user) {
      const admin = ADMIN_EMAILS.includes(user.email?.toLowerCase?.() || "") || user.role === "admin" || user.role === "superadmin";
      setLocation(admin ? "/admin" : redirectTo);
    }
  }, [user, redirectTo, setLocation]);

  const onSubmit = (data: LoginCredentials) => {
    loginMutation.mutate(data, {
      onSuccess: (loggedInUser: any) => {
        toast({
          title: t("auth.login_success_title"),
          description: t("auth.login_success_desc"),
        });
        const admin = ADMIN_EMAILS.includes(loggedInUser?.email?.toLowerCase?.() || "") || loggedInUser?.role === "admin" || loggedInUser?.role === "superadmin";
        setLocation(admin ? "/admin" : redirectTo);
      },
    });
  };

  const isSubmitting = loginMutation.isPending;

  const usernameErrorId = useMemo(() => (errors.username ? "username-error" : undefined), [errors.username]);
  const passwordErrorId = useMemo(() => (errors.password ? "password-error" : undefined), [errors.password]);

  return (
    <div className="min-h-screen font-sans relative overflow-hidden">
      <SiteBackground />
      <Navbar />

      <div className="relative pt-32 pb-20 lg:pt-36 lg:pb-28">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-10 xl:gap-16 items-center">
            <motion.div
              initial={{ opacity: 0, x: -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
              className="space-y-8"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/10 bg-white/70 backdrop-blur px-4 py-2 text-sm font-semibold text-primary shadow-sm">
                <Sparkles className="h-4 w-4" />
                {t("auth.login_badge")}
              </div>

              <div className="space-y-5 max-w-xl">
                <h1 className="text-4xl sm:text-5xl xl:text-6xl font-display font-extrabold text-slate-900 leading-[1.05] tracking-tight">
                  {t("auth.login_title")}
                </h1>
                <p className="text-lg text-slate-600 leading-relaxed max-w-2xl">
                  {t("auth.login_desc")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                {featureCards.map((feature) => {
                  const Icon = feature.icon;
                  return (
                    <div
                      key={feature.titleKey}
                      className="rounded-2xl border border-white/70 bg-white/75 backdrop-blur-md p-4 shadow-[0_10px_30px_rgba(15,23,42,0.05)]"
                    >
                      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h3 className="text-sm font-bold text-slate-900">{t(feature.titleKey)}</h3>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{t(feature.descriptionKey)}</p>
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-primary/5 px-4 py-3 text-sm text-slate-600 max-w-xl">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span>{t("auth.secure_connection_note", "Your connection to this page is encrypted.")}</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, duration: 0.55, ease: "easeOut" }}
              className="relative"
            >
              <div className="absolute -inset-4 rounded-[2.75rem] bg-gradient-to-r from-primary/15 via-sky-400/10 to-cyan-500/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2.5rem] border border-white/60 bg-white/85 backdrop-blur-xl shadow-[0_24px_80px_rgba(15,23,42,0.12)]">
                <div className="h-2 bg-gradient-to-r from-primary via-sky-400 to-cyan-400" />

                <div className="p-8 sm:p-10">
                  <div className="mb-8 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold uppercase tracking-[0.24em] text-primary/70">
                        {t("auth.login_badge")}
                      </p>
                      <h2 className="mt-2 text-2xl font-display font-bold text-slate-900">
                        {t("auth.login_button")}
                      </h2>
                    </div>

                    <div className="hidden sm:flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-slate-900/20">
                      <LogIn className="h-5 w-5" />
                    </div>
                  </div>

                  <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
                    {loginMutation.isError && (
                      <div
                        role="alert"
                        className="flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700"
                      >
                        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                        <span>
                          {t(
                            "auth.login_error_desc",
                            "We couldn't sign you in. Check your username and password and try again.",
                          )}
                        </span>
                      </div>
                    )}

                    <div className="space-y-2">
                      <label htmlFor="username" className="text-sm font-bold text-slate-700">
                        {t("auth.username_label")}
                      </label>
                      <div className="relative">
                        <User
                          className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="username"
                          {...register("username")}
                          autoComplete="username"
                          aria-invalid={!!errors.username}
                          aria-describedby={usernameErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-5 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.username
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.username_placeholder")}
                        />
                      </div>
                      {errors.username && (
                        <p id="username-error" className="text-sm text-red-600">
                          {errors.username.message as string}
                        </p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label htmlFor="password" className="text-sm font-bold text-slate-700">
                          {t("auth.password_label")}
                        </label>
                        <Link href="/forgot-password" className="text-sm font-semibold text-primary hover:underline">
                          {t("auth.forgot_password_link", "Forgot password?")}
                        </Link>
                      </div>

                      <div className="relative">
                        <Lock
                          className="absolute start-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-slate-400"
                          aria-hidden="true"
                        />
                        <input
                          id="password"
                          {...register("password")}
                          type={showPassword ? "text" : "password"}
                          autoComplete="current-password"
                          aria-invalid={!!errors.password}
                          aria-describedby={passwordErrorId}
                          className={`w-full rounded-2xl border bg-slate-50 px-11 pe-12 py-3.5 text-slate-900 transition-all placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-4 focus:ring-primary/10 ${
                            errors.password
                              ? "border-red-300 focus:border-red-400"
                              : "border-slate-200 focus:border-primary"
                          }`}
                          placeholder={t("auth.password_placeholder")}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((value) => !value)}
                          className="absolute end-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-600"
                          aria-label={showPassword ? t("auth.hide_password", "Hide password") : t("auth.show_password", "Show password")}
                        >
                          {showPassword ? <EyeOff className="h-4.5 w-4.5" /> : <Eye className="h-4.5 w-4.5" />}
                        </button>
                      </div>
                      {errors.password && (
                        <p id="password-error" className="text-sm text-red-600">
                          {errors.password.message as string}
                        </p>
                      )}
                    </div>

                    <label className="flex items-center gap-2.5 text-sm text-slate-600 select-none">
                      <input
                        type="checkbox"
                        {...register("rememberMe" as any)}
                        className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-4 focus:ring-primary/20"
                      />
                      {t("auth.remember_me", "Remember me")}
                    </label>

                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className="group flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-5 py-4 font-bold text-white shadow-[0_16px_40px_rgba(15,23,42,0.18)] transition-all hover:-translate-y-0.5 hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-900/10 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                    >
                      {isSubmitting ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin" /> {t("auth.logging_in")}
                        </>
                      ) : (
                        <>
                          <LogIn className="h-5 w-5" /> {t("auth.login_button")}
                          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                        </>
                      )}
                    </button>

                    <div className="flex items-center gap-3 py-1 text-xs font-medium text-slate-400">
                      <div className="h-px flex-1 bg-slate-200" />
                      <span>{t("auth.or", "ou")}</span>
                      <div className="h-px flex-1 bg-slate-200" />
                    </div>

                    <GoogleSignInButton onAuthenticated={() => setLocation(redirectTo)} />

                    <div className="pt-2 text-center text-sm text-slate-600">
                      <span>{t("auth.no_account")}</span>{" "}
                      <Link href="/signup" className="font-bold text-primary hover:underline">
                        {t("auth.signup_link")}
                      </Link>
                    </div>
                  </form>
                </div>
              </div>
            </motion.div>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
