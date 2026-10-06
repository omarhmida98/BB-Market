import { Link, useLocation } from "wouter";
import { useState } from "react";
import { Menu, X, ShoppingCart, LogOut, UserCircle2, LayoutDashboard } from "lucide-react";
import logo from "@assets/bb_market_logo.png";
import { useSelection } from "@/hooks/use-selection";
import { useTranslation } from "react-i18next";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { CartSheet } from "./CartSheet";
import { useAuth } from "@/hooks/use-auth";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationDropdown } from "./NotificationDropdown";

const ADMIN_EMAILS = ["bbmarket26@gmail.com", "omar.hmida.lgl@gmail.com"];

export function Navbar() {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { user, logoutMutation } = useAuth();

  const isAdmin = !!user && (ADMIN_EMAILS.includes(user.email?.toLowerCase?.() || "") || user.role === "admin" || user.role === "superadmin");

  const links = [
    { href: "/products", label: t("nav.products") },
    { href: "/contact", label: t("nav.contact") },
  ];

  const handleLogout = () => {
    logoutMutation.mutate(undefined, { onSuccess: () => setLocation("/") });
  };

  return (
    <>
      <nav className="fixed w-full z-50 bg-background/90 backdrop-blur-xl border-b border-border/70 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-20 items-center">
            <Link href="/" className="flex items-center gap-3">
              <img src={logo} alt="B&B Market" className="h-14 w-auto object-contain" />
            </Link>

            <div className="hidden md:flex items-center gap-7">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm font-bold transition-colors ${location === link.href ? "text-primary" : "text-muted-foreground hover:text-primary"}`}
                >
                  {link.label}
                </Link>
              ))}
              <CartCounter onOpenCart={() => setIsCartOpen(true)} label={t("nav.cart", "Panier")} />
              <LanguageSwitcher />
              <ThemeToggle />
              {isAdmin && (
                <Link href="/admin" className="inline-flex items-center gap-2 rounded-full bg-secondary px-4 py-2 text-sm font-bold text-secondary-foreground hover:bg-secondary/80">
                  <LayoutDashboard className="w-4 h-4" /> Admin
                </Link>
              )}
              {/* Renders nothing when signed out. Shown to customers and admins
                  alike; the server decides which notifications each one gets. */}
              <NotificationDropdown />
              {user ? (
                <Link
                  href="/account"
                  className={`text-sm font-bold transition-colors ${
                    location === "/account" ? "text-primary" : "text-muted-foreground hover:text-primary"
                  }`}
                  data-testid="nav-account"
                >
                  {t("nav.account", "Mon compte")}
                </Link>
              ) : null}
              {user ? (
                <button onClick={handleLogout} className="p-2 rounded-full text-muted-foreground hover:text-primary" aria-label={t("auth.logout")}> <LogOut className="w-5 h-5" /> </button>
              ) : (
                <Link href="/login" className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground hover:opacity-90">
                  <UserCircle2 className="w-4 h-4" /> {t("auth.login")}
                </Link>
              )}
            </div>

            <div className="flex md:hidden items-center gap-1">
              <CartCounter onOpenCart={() => setIsCartOpen(true)} compact label={t("nav.cart", "Panier")} />
              <NotificationDropdown />
              <ThemeToggle />
              <button onClick={() => setIsOpen(!isOpen)} className="p-2 rounded-md text-muted-foreground hover:text-primary">
                {isOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </div>

        {isOpen && (
          <div className="md:hidden bg-background border-t border-border px-4 py-4 space-y-2">
            {links.map((link) => (
              <Link key={link.href} href={link.href} onClick={() => setIsOpen(false)} className="block rounded-xl px-4 py-3 font-semibold hover:bg-secondary">
                {link.label}
              </Link>
            ))}
            <div className="flex items-center justify-between px-2 py-2">
              <LanguageSwitcher />
              {isAdmin && <Link href="/admin" onClick={() => setIsOpen(false)} className="text-sm font-bold text-primary">{t("nav.admin", "Admin")}</Link>}
              {user ? (
                <>
                  <Link href="/account" onClick={() => setIsOpen(false)} className="text-sm font-semibold">
                    {t("nav.account", "Mon compte")}
                  </Link>
                  <button onClick={handleLogout} className="text-sm font-semibold">{t("auth.logout")}</button>
                </>
              ) : (
                <Link href="/login" onClick={() => setIsOpen(false)} className="text-sm font-semibold">{t("auth.login")}</Link>
              )}
            </div>
          </div>
        )}
      </nav>
      <CartSheet open={isCartOpen} onOpenChange={setIsCartOpen} />
    </>
  );
}

function CartCounter({ onOpenCart, compact = false, label }: { onOpenCart: () => void; compact?: boolean; label: string }) {
  const { totalItems } = useSelection();
  return (
    <button onClick={onOpenCart} className="relative inline-flex items-center gap-2 p-2 text-muted-foreground hover:text-primary transition-colors" aria-label={label}>
      <ShoppingCart className="w-5 h-5" />
      {!compact && <span className="text-sm font-bold">{label}</span>}
      {totalItems > 0 && <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 bg-[#ff6200] text-white text-[10px] font-black rounded-full flex items-center justify-center border-2 border-background">{totalItems}</span>}
    </button>
  );
}
