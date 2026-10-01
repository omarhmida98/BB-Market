import { useSyncExternalStore } from 'react';

export interface SelectionItem {
    id: number | string;
    name: string;
    description?: string;
    imageUrl?: string;
    type: 'product' | 'promo';
    quantity: number;
    price?: number;
}

function normalizeSelection(items: any[]): SelectionItem[] {
    return items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        type: item.type,
        quantity: item.quantity || 1,
        price: Number(item.price || 0),
    }));
}

function serializeSelection(items: SelectionItem[]) {
    return JSON.stringify(items.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        imageUrl: item.imageUrl,
        type: item.type,
        quantity: item.quantity,
        price: item.price || 0,
    })));
}

const STORAGE_KEY = 'bb_market_cart';
const selectionListeners = new Set<() => void>();
let selectionCache: SelectionItem[] | null = null;

function readStoredSelection() {
    if (typeof window === 'undefined') {
        return [] as SelectionItem[];
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
        return [] as SelectionItem[];
    }

    try {
        return normalizeSelection(JSON.parse(saved));
    } catch (e) {
        console.error('Failed to parse selection', e);
        return [] as SelectionItem[];
    }
}

function ensureSelectionCache() {
    if (selectionCache === null) {
        selectionCache = readStoredSelection();
    }
    return selectionCache;
}

function emitSelectionChange() {
    selectionListeners.forEach((listener) => listener());
}

function setSelection(nextSelection: SelectionItem[]) {
    selectionCache = nextSelection;

    if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSelection));
    }

    emitSelectionChange();
}

function updateSelection(updater: (current: SelectionItem[]) => SelectionItem[]) {
    const current = ensureSelectionCache();
    const next = updater(current);

    if (serializeSelection(current) === serializeSelection(next)) {
        return;
    }

    setSelection(next);
}

export function useSelection() {
    const selection = useSyncExternalStore(
        (listener) => {
            selectionListeners.add(listener);

            const handleStorage = () => {
                selectionCache = readStoredSelection();
                emitSelectionChange();
            };

            window.addEventListener('storage', handleStorage);

            return () => {
                selectionListeners.delete(listener);
                window.removeEventListener('storage', handleStorage);
            };
        },
        () => ensureSelectionCache(),
        () => []
    );

    const addToSelection = (item: Omit<SelectionItem, 'quantity'> & { quantity?: number }) => {
        updateSelection((prev) => {
            const existing = prev.find((i) => i.id === item.id && i.type === item.type);
            if (existing) {
                return prev;
            }
            return [...prev, { ...item, quantity: item.quantity || 1 }];
        });
    };

    const removeFromSelection = (id: number | string, type: 'product' | 'promo') => {
        updateSelection((prev) => prev.filter((i) => !(i.id === id && i.type === type)));
    };

    const updateQuantity = (id: number | string, type: 'product' | 'promo', quantity: number) => {
        updateSelection((prev) => prev.map((item) =>
            (item.id === id && item.type === type)
                ? { ...item, quantity: Math.max(1, quantity) }
                : item
        ));
    };

    const clearSelection = () => {
        setSelection([]);
    };

    const isSelected = (id: number | string, type: 'product' | 'promo') => {
        return !!selection.find(i => i.id === id && i.type === type);
    };

    return {
        selection,
        addToSelection,
        removeFromSelection,
        updateQuantity,
        clearSelection,
        isSelected,
        count: selection.length,
        totalItems: selection.reduce((sum, item) => sum + item.quantity, 0)
    };
}