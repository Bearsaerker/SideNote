declare const __DEV__: boolean;

export const IS_DEV_MODE = typeof __DEV__ !== "undefined" ? __DEV__ : true;
export const DEV_AUTO_RELOAD = IS_DEV_MODE;
export const DEV_AUTO_RELOAD_INTERVAL_MS = 1200;

export function isDebugEnabled(): boolean {
    return IS_DEV_MODE;
}
