import { lazy, Suspense } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import NotFound from "@/pages/not-found";
import Home from "@/pages/Home";
import { AuthProvider } from "./hooks/use-auth";
import { ScrollToTop } from "@/components/ScrollToTop";
import { WhatsAppButton } from "@/components/WhatsAppButton";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { ThemeProvider } from "next-themes";

/**
 * Route-level code splitting.
 *
 * Every page used to be a static import, so one 931 kB bundle held the admin panel,
 * the analytics dashboard, checkout, the account area and the auth screens, and a
 * first-time visitor on `/` downloaded all of it to render a home page. Only `Home`
 * and the catch-all `not-found` stay eager: the landing page is the first paint, so
 * making it lazy would trade a large win for a guaranteed extra round trip, and the
 * 404 page is small enough not to matter and would otherwise flash a skeleton for a
 * wrong URL.
 *
 * `Admin` is the single biggest win - it pulls in the whole analytics dashboard and
 * the social embed code - and is reachable only by an authenticated admin, so it is
 * now absent from a customer session entirely rather than merely parsed.
 */
const Products = lazy(() => import("@/pages/Products"));
const ProductDetail = lazy(() => import("@/pages/ProductDetail"));
const Promos = lazy(() => import("@/pages/Promos"));
const Contact = lazy(() => import("@/pages/Contact"));
const Checkout = lazy(() => import("@/pages/Checkout"));
const Login = lazy(() => import("@/pages/Login"));
const Signup = lazy(() => import("@/pages/Signup"));
const ForgotPasswordPage = lazy(() => import("@/pages/ForgotPassword"));
const ResetPasswordPage = lazy(() => import("@/pages/ResetPassword"));
const MyHistory = lazy(() => import("@/pages/MyHistory"));
const Profile = lazy(() => import("@/pages/Profile"));
const Account = lazy(() => import("@/pages/Account"));
const OrderDetail = lazy(() => import("@/pages/OrderDetail"));
const Admin = lazy(() => import("@/pages/AdminMarket"));

/**
 * Shown while a route chunk is in flight.
 *
 * Deliberately not a spinner: a centred spinner collapses the page to a few pixels
 * and then jumps, whereas a skeleton block keeps roughly the height of a page, so the
 * surrounding header and footer do not visibly reflow when the chunk lands.
 */
function RouteFallback() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-10" role="status" aria-busy="true">
      <span className="sr-only">{t("common.loading", "Chargement...")}</span>
      <Skeleton className="h-8 w-56" />
      <Skeleton className="mt-4 h-4 w-80" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
        <Skeleton className="h-64" />
      </div>
    </div>
  );
}

function Router() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/products" component={Products} />
        <Route path="/products/:id" component={ProductDetail} />
        <Route path="/promos" component={Promos} />
        <Route path="/contact" component={Contact} />
        <Route path="/checkout" component={Checkout} />
        <Route path="/login" component={Login} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/reset-password" component={ResetPasswordPage} />
        <Route path="/signup" component={Signup} />
        <Route path="/my-history" component={MyHistory} />
        <Route path="/profile" component={Profile} />
        {/* Customer account. `/account/orders/:id` must be declared after `/account`
            so the more specific path wins; wouter matches in order. */}
        <Route path="/account/orders/:id" component={OrderDetail} />
        <Route path="/account" component={Account} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

import { useTranslation } from "react-i18next";
import { useEffect } from "react";

function App() {
  const { i18n } = useTranslation();

  useEffect(() => {
    const lang = i18n.language;
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";

    // Add conditional font class for Arabic
    if (lang === "ar") {
      document.body.classList.add("font-arabic");
    } else {
      document.body.classList.remove("font-arabic");
    }
  }, [i18n.language]);

  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
    <GoogleOAuthProvider clientId={googleClientId}>
    <QueryClientProvider client={queryClient}>

      <AuthProvider>
        <TooltipProvider>
          <ScrollToTop />
          <Router />
          <WhatsAppButton />
          <Toaster />
        </TooltipProvider>
      </AuthProvider>

    </QueryClientProvider>
    </GoogleOAuthProvider>
    </ThemeProvider>
  );
}

export default App;
