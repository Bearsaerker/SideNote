# SideNote Dev Guide

Guide for local development, debug mode, and switching between local and production plugin installs in Obsidian.

## 1) Build and run locally

```bash
cd /ABSOLUTE/PATH/TO/SideNote
npm install
npm run dev
```

- Keep `npm run dev` running while you test.
- `npm run build` creates a production bundle.

## 2) Point a vault to local code (symlink)

Do this in Terminal, not in `.env`.

```bash
VAULT="/ABSOLUTE/PATH/TO/YOUR/VAULT"
REPO="/ABSOLUTE/PATH/TO/SideNote"
PLUGIN_ID="side-note"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_ID"
BACKUP_ROOT="$VAULT/.obsidian/plugins-backups"
BACKUP_DIR="$BACKUP_ROOT/${PLUGIN_ID}.prod-backup-$(date +%Y%m%d-%H%M%S)"

mkdir -p "$VAULT/.obsidian/plugins" "$BACKUP_ROOT"
if [ -d "$PLUGIN_DIR" ] && [ ! -L "$PLUGIN_DIR" ]; then mv "$PLUGIN_DIR" "$BACKUP_DIR"; fi
if [ -L "$PLUGIN_DIR" ]; then rm "$PLUGIN_DIR"; fi
ln -s "$REPO" "$PLUGIN_DIR"
echo "Prod backup: $BACKUP_DIR"
```

Important:

- Keep backups in `.obsidian/plugins-backups`, not `.obsidian/plugins`.
- Do not keep two plugin folders with the same manifest id (`side-note`) under `.obsidian/plugins`.

## 3) Enable and verify in Obsidian

1. Open the vault.
2. Settings -> Community plugins -> enable `SideNote`.
3. In DevTools console, verify loaded path:

```js
const id = "side-note";
console.log("manifest dir:", app.plugins.manifests[id]?.dir);
console.log("loaded plugin dir:", app.plugins.plugins[id]?.manifest?.dir);
```

Expected local path:

- `.obsidian/plugins/side-note`

## 4) Debug mode

Debug is controlled by build mode (no UI toggle):

- `npm run dev` -> debug enabled (`[SideNote debug] ...`) + debug marker.
- `npm run build` -> debug disabled.

Useful checks in DevTools:

```js
window.__SIDENOTE_DEBUG__;
window.__SIDENOTE_DEBUG_STORE__;
```

Notes:

- In dev build (`npm run dev`), auto-reload watcher is available and active.
- In production build (`npm run build`), auto-reload is not active.

## 5) Reload behavior (when you need manual actions)

With `npm run dev` running, you normally do not need to paste console commands:

When manual reload may still be needed:

- If you edit files outside the bundle flow (for example styles.css / manifest.json).
- If Obsidian gets stuck with stale runtime cache (rare): full app restart (Cmd+Q).

Manual reload is only a fallback:

- If Obsidian runtime cache gets stale.
- If you change files outside the current watcher path (for example `styles.css` or `manifest.json`).

Fallback options:

```js
await app.plugins.disablePlugin("side-note");
await app.plugins.enablePlugin("side-note");
```

If still stale, fully restart Obsidian (`Cmd+Q` and reopen).

## 6) Switch back to production plugin

```bash
VAULT="/ABSOLUTE/PATH/TO/YOUR/VAULT"
PLUGIN_ID="side-note"
PLUGIN_DIR="$VAULT/.obsidian/plugins/$PLUGIN_ID"
BACKUP_ROOT="$VAULT/.obsidian/plugins-backups"
BACKUP="$(ls -dt "$BACKUP_ROOT/${PLUGIN_ID}.prod-backup-"* 2>/dev/null | head -n1)"

if [ -L "$PLUGIN_DIR" ]; then rm "$PLUGIN_DIR"; fi
if [ -n "$BACKUP" ]; then
  mv "$BACKUP" "$PLUGIN_DIR"
  echo "Restored prod from: $BACKUP"
else
  echo "No backup found. Reinstall from Community Plugins."
fi
```
