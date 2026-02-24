import { isDebugEnabled } from "./flags";

export interface SideNoteDebugStore {
    counts: Record<string, number>;
    events: Array<{ at: string; label: string; payload?: unknown }>;
}

export interface SideNoteDebugMarker {
    loadedAt: string;
    version: string;
    pluginId: string;
    storeInitialized: boolean;
}

declare global {
    interface Window {
        __SIDENOTE_DEBUG_STORE__?: SideNoteDebugStore;
        __SIDENOTE_DEBUG__?: SideNoteDebugMarker;
    }
}

export function getDebugStore(): SideNoteDebugStore | null {
    if (!isDebugEnabled()) return null;
    if (typeof window === "undefined") return null;
    if (!window.__SIDENOTE_DEBUG_STORE__) {
        window.__SIDENOTE_DEBUG_STORE__ = { counts: {}, events: [] };
    }
    return window.__SIDENOTE_DEBUG_STORE__;
}

export function debugLog(label: string, payload?: unknown): void {
    if (!isDebugEnabled()) return;
    const store = getDebugStore();
    if (store) {
        store.events.push({
            at: new Date().toISOString(),
            label,
            payload,
        });
        if (store.events.length > 300) {
            store.events.splice(0, store.events.length - 300);
        }
    }
    if (payload === undefined) {
        console.log(`[SideNote debug] ${label}`);
        return;
    }
    console.log(`[SideNote debug] ${label}`, payload);
}

export function debugCount(label: string): void {
    if (!isDebugEnabled()) return;
    const store = getDebugStore();
    if (store) {
        store.counts[label] = (store.counts[label] || 0) + 1;
    }
    console.count(`[SideNote debug] ${label}`);
}

export function setDebugMarker(version: string, pluginId: string): SideNoteDebugMarker | null {
    if (!isDebugEnabled()) return null;
    if (typeof window === "undefined") return null;

    const loadedAt = new Date().toISOString();
    const marker: SideNoteDebugMarker = {
        loadedAt,
        version,
        pluginId,
        storeInitialized: !!getDebugStore(),
    };

    window.__SIDENOTE_DEBUG__ = marker;
    console.log("[SideNote debug] plugin onload", marker);
    return marker;
}
