
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { useSelection } from "@/hooks/use-selection";
import { useTranslation } from "react-i18next";
import { ShoppingBag, X, Trash2, ArrowRight, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ScrollArea } from "@/components/ui/scroll-area";

interface CartSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function CartSheet({ open, onOpenChange }: CartSheetProps) {
    const { t } = useTranslation();
    const { selection, count, totalItems, removeFromSelection, updateQuantity, clearSelection } = useSelection();
    const totalPrice = selection.reduce((sum, item) => sum + Number(item.price || 0) * item.quantity, 0);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-md flex flex-col p-0">
                <SheetHeader className="p-6 border-b">
                    <div className="flex items-center gap-2">
                        <div className="p-2 bg-primary/10 rounded-lg text-primary">
                            <ShoppingBag className="w-5 h-5" />
                        </div>
                        <SheetTitle className="text-xl font-bold">
                            {t("selection_float.title")}
                        </SheetTitle>
                        <span className="ms-auto bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full text-xs font-bold">
                            {totalItems} {totalItems > 1 ? t("selection_float.item_count_plural") : t("selection_float.item_count_singular")}
                        </span>
                    </div>
                </SheetHeader>

                <ScrollArea className="flex-1 px-6">
                    {count === 0 ? (
                        <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                            <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                                <ShoppingBag className="w-10 h-10 text-slate-300" />
                            </div>
                            <h3 className="text-lg font-semibold text-slate-900 mb-1">
                                {t("contact.selection_empty")}
                            </h3>
                            <p className="text-slate-500 text-sm max-w-[200px]">
                                {t("products.subtitle")}
                            </p>
                            <Link href="/products" onClick={() => onOpenChange(false)}>
                                <Button
                                    variant="outline"
                                    className="mt-6 rounded-xl"
                                >
                                    {t("featured.view_all")}
                                </Button>
                            </Link>
                        </div>
                    ) : (
                        <div className="py-6 space-y-6">
                            {selection.map((item) => (
                                <div key={`${item.id}-${item.type}`} className="flex gap-4 group">
                                    <div className="relative h-20 w-20 flex-shrink-0 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                                        {item.imageUrl ? (
                                            <img
                                                src={item.imageUrl}
                                                alt={item.name}
                                                className="h-full w-full object-cover"
                                            />
                                        ) : (
                                            <div className="h-full w-full flex items-center justify-center text-slate-400">
                                                <ShoppingBag className="w-8 h-8 opacity-20" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col flex-1 min-w-0">
                                        <div className="flex justify-between items-start">
                                            <h4 className="font-bold text-slate-900 line-clamp-1 pe-4 break-all">
                                                {item.name}
                                            </h4>
                                            <button
                                                onClick={() => removeFromSelection(item.id, item.type)}
                                                className="text-slate-400 hover:text-red-500 transition-colors p-1"
                                                title={t("product_card.remove")}
                                            >
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                        <p className="text-xs text-slate-500 line-clamp-2 mt-1 mb-2">
                                            {item.description}
                                        </p>
                                        <div className="text-sm font-black text-primary">{Number(item.price || 0).toFixed(3)} DT</div>

                                        <div className="flex items-center justify-between mt-auto gap-4">
                                            <span className="text-[10px] font-medium text-slate-400 whitespace-nowrap">
                                                {t("products.quantity")}
                                            </span>

                                            <div className="flex items-center gap-1.5 bg-slate-100 rounded-lg p-1 border border-slate-200 shadow-sm shrink-0">
                                                <button
                                                    onClick={() => updateQuantity(item.id, item.type, item.quantity - 1)}
                                                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white border border-slate-200 text-slate-600 hover:text-primary hover:border-primary/30 transition-all active:scale-95 disabled:opacity-40"
                                                    disabled={item.quantity <= 1}
                                                    title={t("product_card.remove")}
                                                >
                                                    <Minus className="w-4 h-4" />
                                                </button>
                                                <span className="text-xs font-bold min-w-[1.5rem] text-center text-slate-900">
                                                    {item.quantity}
                                                </span>
                                                <button
                                                    onClick={() => updateQuantity(item.id, item.type, item.quantity + 1)}
                                                    className="w-7 h-7 flex items-center justify-center rounded-md bg-white border border-slate-200 text-slate-600 hover:text-primary hover:border-primary/30 transition-all active:scale-95"
                                                    title={t("product_card.select")}
                                                >
                                                    <Plus className="w-4 h-4" />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>

                {count > 0 && (
                    <div className="p-6 border-t bg-slate-50/50">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-sm font-medium text-slate-500">
                                {totalItems} {totalItems > 1 ? t("selection_float.item_count_plural") : t("selection_float.item_count_singular")}
                            </span>
                            <button
                                onClick={clearSelection}
                                className="text-xs font-semibold text-red-500 hover:text-red-600 flex items-center gap-1.5 transition-colors"
                            >
                                <Trash2 className="w-3.5 h-3.5" />
                                {t("selection_float.clear")}
                            </button>
                        </div>

                        <div className="flex items-center justify-between mb-6 text-lg font-black">
                            <span>Total</span><span className="text-primary">{totalPrice.toFixed(3)} DT</span>
                        </div>

                        <div className="space-y-3">
                            <Link href="/checkout" onClick={() => onOpenChange(false)}>
                                <Button className="w-full h-14 rounded-2xl font-bold text-base shadow-lg shadow-primary/20 flex items-center justify-center gap-2 group">
                                    {t("selection_float.order")}
                                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                                </Button>
                            </Link>
                            <Button
                                variant="ghost"
                                className="w-full text-slate-500 font-medium"
                                onClick={() => onOpenChange(false)}
                            >
                                {t("product_detail.back_to_products")}
                            </Button>
                        </div>
                    </div>
                )}
            </SheetContent>
        </Sheet>
    );
}
