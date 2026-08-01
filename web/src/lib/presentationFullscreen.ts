"use client";

type FullscreenResult = {
  success: boolean;
  isFullscreen: boolean;
  error?: string;
};

async function browserSetFullscreen(fullscreen: boolean): Promise<FullscreenResult> {
  try {
    if (fullscreen) {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      }
      return { success: true, isFullscreen: true };
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    return { success: true, isFullscreen: false };
  } catch (error) {
    return {
      success: false,
      isFullscreen: Boolean(document.fullscreenElement),
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getPresentationFullscreenState(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (window.electron?.getWindowFullscreenState) {
    try {
      const result = await window.electron.getWindowFullscreenState();
      if (result?.success && typeof result.isFullscreen === "boolean") {
        return result.isFullscreen;
      }
    } catch {
      // Fall back to the browser fullscreen state below.
    }
  }
  return Boolean(document.fullscreenElement);
}

export async function setPresentationFullscreen(
  fullscreen: boolean,
): Promise<FullscreenResult> {
  if (typeof window === "undefined") {
    return { success: false, isFullscreen: false, error: "Window unavailable" };
  }

  if (window.electron?.setWindowFullscreen) {
    try {
      const result = await window.electron.setWindowFullscreen(fullscreen);
      if (result?.success) {
        return {
          success: true,
          isFullscreen: Boolean(result.isFullscreen ?? fullscreen),
        };
      }
    } catch {
      // Fall back to the browser Fullscreen API below.
    }
  }

  return browserSetFullscreen(fullscreen);
}

export async function togglePresentationFullscreen(): Promise<FullscreenResult> {
  const current = await getPresentationFullscreenState();
  return setPresentationFullscreen(!current);
}
