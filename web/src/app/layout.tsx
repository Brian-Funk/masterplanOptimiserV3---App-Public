"use client";

import "./globals.css";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { ShortcutProvider } from "@/contexts/ShortcutContext";
import { ToastProvider } from "@/contexts/ToastContext";
import { GlobalShortcuts } from "@/components/GlobalShortcuts";
import { LogDumpErrorBoundary } from "@/components/LogDumpErrorBoundary";
import { RendererErrorReporter } from "@/components/RendererErrorReporter";
import { ToastContainer } from "@/components/ui/ToastContainer";
import {
  GlobalPendingDeletionWorkBanner,
  PendingDeletionWorkProvider,
} from "@/contexts/PendingDeletionWorkContext";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { getApiUrl } from "@/lib/environment";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isPdfExport = pathname === "/pdf-export";

  useEffect(() => {
    if (isPdfExport) return;
    // Cleanup optimization jobs when window is closing
    const handleBeforeUnload = () => {
      const apiUrl = getApiUrl();
      fetch(`${apiUrl}/api/v1/optimize/cleanup-on-close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        keepalive: true,
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isPdfExport]);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <title>Masterplan Optimiser</title>
        <meta
          name="description"
          content="Desktop masterplan optimisation tool for live events."
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  var stored = localStorage.getItem('dark-mode');
                  if (stored === 'dark' || (stored === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                    document.documentElement.classList.add('dark');
                  }
                } catch(e) {}
              })();
            `,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          <ShortcutProvider>
            <ToastProvider>
              <PendingDeletionWorkProvider>
                {!isPdfExport && <RendererErrorReporter />}
                <LogDumpErrorBoundary>
                  {!isPdfExport && <GlobalShortcuts />}
                  {!isPdfExport && <GlobalPendingDeletionWorkBanner />}
                  {children}
                  {!isPdfExport && <ToastContainer />}
                </LogDumpErrorBoundary>
              </PendingDeletionWorkProvider>
            </ToastProvider>
          </ShortcutProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
