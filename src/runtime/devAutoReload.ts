import { App, Notice } from "obsidian";
import { debugLog } from "./debug";
import { DEV_AUTO_RELOAD, DEV_AUTO_RELOAD_INTERVAL_MS, isDebugEnabled } from "./flags";

interface StartDevAutoReloadWatcherArgs {
    app: App;
    pluginId: string;
    registerInterval: (intervalId: number) => void;
}

export function startDevAutoReloadWatcher(args: StartDevAutoReloadWatcherArgs): void {
    if (!DEV_AUTO_RELOAD) return;

    const { app, pluginId, registerInterval } = args;
    const pluginMainPath = `.obsidian/plugins/${pluginId}/main.js`;
    let initialized = false;
    let lastMtime = 0;
    let reloadQueued = false;

    const tick = async () => {
        if (reloadQueued) return;
        if (!isDebugEnabled()) return;

        try {
            const stat = await app.vault.adapter.stat(pluginMainPath);
            if (!stat) return;

            if (!initialized) {
                initialized = true;
                lastMtime = stat.mtime;
                debugLog("dev auto reload watcher ready", { pluginMainPath, mtime: stat.mtime });
                return;
            }

            if (stat.mtime !== lastMtime) {
                lastMtime = stat.mtime;
                reloadQueued = true;
                debugLog("dev auto reload triggered", { pluginMainPath, mtime: stat.mtime });
                new Notice("SideNote dev: build updated, reloading app...");
                const appWithCommands = app as App & { commands?: { executeCommandById?: (id: string) => void } };
                appWithCommands.commands?.executeCommandById?.("app:reload");
            }
        } catch (error) {
            debugLog("dev auto reload watcher error", error);
        }
    };

    const timer = window.setInterval(() => {
        void tick();
    }, DEV_AUTO_RELOAD_INTERVAL_MS);
    registerInterval(timer);
}
