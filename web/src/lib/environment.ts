/**
 * Environment detection utility
 * Determines if running in desktop Electron app or web browser
 */

/** Return true when the frontend is running inside the Electron shell. */
export function isDesktopApp(): boolean {
  // Check if running in Electron (preload sets window.electron.isElectron)
  if (typeof window !== "undefined") {
    // @ts-ignore - Electron injects this via preload
    const isElectron = window.electron?.isElectron === true;
    return isElectron || navigator.userAgent.includes("Electron");
  }
  return false;
}

/** Resolve the local FastAPI base URL for desktop and browser development. */
export function getApiUrl(): string {
  if (isDesktopApp()) {
    const apiUrl = window.electron?.apiUrl;
    if (!apiUrl) throw new Error("Electron API URL was not provided by the desktop shell");
    return apiUrl;
  }

  // In web app (browser dev), use the configured URL or localhost fallback.
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";
}
