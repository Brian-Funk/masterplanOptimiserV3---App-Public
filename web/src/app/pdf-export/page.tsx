"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Calendar, { type CalendarTask } from "@/components/Calendar";
import type { PdfExportPayload } from "@/lib/electronDiagnostics";

type PdfJob = PdfExportPayload & { generatedAt: string };

function waitForImages(): Promise<void> {
  const pending = Array.from(document.images)
    .filter((image) => !image.complete)
    .map(
      (image) =>
        new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        }),
    );
  return Promise.all(pending).then(() => undefined);
}

function fitCalendars() {
  document.querySelectorAll<HTMLElement>("[data-pdf-calendar-frame]").forEach((frame) => {
    const content = frame.querySelector<HTMLElement>("[data-pdf-calendar-content]");
    if (!content) return;
    content.style.transform = "none";
    content.style.width = "100%";
    const widthScale = frame.clientWidth / Math.max(content.scrollWidth, 1);
    const heightScale = frame.clientHeight / Math.max(content.scrollHeight, 1);
    const scale = Math.min(1, widthScale, heightScale);
    content.style.transform = `scale(${scale})`;
    content.style.width = `${100 / scale}%`;
  });
}

export default function PdfExportPage() {
  const [job, setJob] = useState<PdfJob | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const root = document.documentElement;
    const enforceLight = () => root.classList.remove("dark");
    enforceLight();
    const observer = new MutationObserver(enforceLight);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    const jobId = new URLSearchParams(window.location.search).get("job");
    if (!jobId || !window.electron?.getPdfExportJob) {
      setError("PDF export job is unavailable.");
      return () => observer.disconnect();
    }
    window.electron
      .getPdfExportJob(jobId)
      .then(setJob)
      .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!job) return;
    const jobId = new URLSearchParams(window.location.search).get("job");
    let cancelled = false;
    const ready = async () => {
      await document.fonts.ready;
      await waitForImages();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      fitCalendars();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!cancelled && jobId && window.electron?.notifyPdfExportReady) {
        await window.electron.notifyPdfExportReady(jobId);
      }
    };
    ready().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      cancelled = true;
    };
  }, [job]);

  if (error) {
    return <main className="pdf-error">{error}</main>;
  }
  if (!job) {
    return <main className="pdf-error">Preparing PDF schedule...</main>;
  }

  return (
    <main className="pdf-document">
      {job.days.map((day, index) => (
        <section className="pdf-page" key={day.date}>
          <header className="pdf-header">
            <div className="pdf-brand">
              <Image src="/logo_normal.svg" alt="MP-OPT" width={118} height={40} priority />
              <div className="pdf-brand-divider" />
              <div>
                <p className="pdf-kicker">Optimised Schedule</p>
                <h1>{job.title}</h1>
              </div>
            </div>
            <div className="pdf-event-meta">
              <strong>{job.eventName}</strong>
              {job.eventLocation && <span>{job.eventLocation}</span>}
              <span>{day.dayLabel}</span>
            </div>
          </header>

          <div className="pdf-calendar-frame" data-pdf-calendar-frame>
            <div className="pdf-calendar-content" data-pdf-calendar-content>
              <Calendar
                tasks={day.tasks as CalendarTask[]}
                viewType="daily"
                selectedDate={day.date}
                eventStartDate={day.date}
                eventEndDate={day.date}
                scheduleDayRange={job.scheduleDayRange as any}
                scheduleDayBoundary={job.scheduleDayBoundary as any}
                onTaskEdit={() => undefined}
                presentationMode
                pdfMode
                density="comfortable"
              />
            </div>
          </div>

          <footer className="pdf-footer">
            <span>Generated {new Date(job.generatedAt).toLocaleString()}</span>
            <span>
              {index + 1} / {job.days.length}
            </span>
          </footer>
        </section>
      ))}
      <style jsx global>{`
        @page {
          size: A4 landscape;
          margin: 0;
        }
        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          color: #111827 !important;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .pdf-document {
          background: #ffffff;
          color: #111827;
          color-scheme: light;
          font-family: "Source Sans 3", sans-serif;
          --color-surface: #ffffff;
          --color-surface-alt: #f9fafb;
          --color-surface-inset: #f3f4f6;
          --color-surface-hover: #f3f4f6;
          --color-surface-overlay: #ffffff;
          --color-foreground: #111827;
          --color-foreground-secondary: #374151;
          --color-foreground-muted: #6b7280;
          --color-foreground-faint: #9ca3af;
          --color-border: #e5e7eb;
          --color-border-subtle: #eef2f7;
          --color-border-strong: #d1d5db;
        }
        .pdf-page {
          box-sizing: border-box;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr) auto;
          gap: 4mm;
          width: 297mm;
          height: 210mm;
          padding: 9mm 10mm 7mm;
          overflow: hidden;
          break-after: page;
          page-break-after: always;
          background: #ffffff;
        }
        .pdf-page:last-child {
          break-after: auto;
          page-break-after: auto;
        }
        .pdf-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8mm;
          border-bottom: 1px solid #dbe3f0;
          padding-bottom: 3mm;
        }
        .pdf-brand {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 4mm;
        }
        .pdf-brand img {
          object-fit: contain;
        }
        .pdf-brand-divider {
          width: 1px;
          height: 12mm;
          background: linear-gradient(#2563eb, #7c3aed);
        }
        .pdf-kicker {
          margin: 0 0 0.5mm;
          color: #4f46e5;
          font-size: 8pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .pdf-header h1 {
          max-width: 150mm;
          margin: 0;
          overflow: hidden;
          color: #111827;
          font-size: 18pt;
          font-weight: 700;
          line-height: 1.1;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .pdf-event-meta {
          display: flex;
          max-width: 85mm;
          flex-direction: column;
          align-items: flex-end;
          color: #4b5563;
          font-size: 9pt;
          line-height: 1.25;
          text-align: right;
        }
        .pdf-event-meta strong {
          color: #111827;
          font-size: 10pt;
        }
        .pdf-calendar-frame {
          min-height: 0;
          overflow: hidden;
        }
        .pdf-calendar-content {
          transform-origin: top left;
        }
        [data-pdf-mode="true"] {
          overflow: visible !important;
          border-color: #dbe3f0 !important;
          background: #ffffff !important;
          color: #111827 !important;
        }
        [data-pdf-mode="true"] * {
          animation: none !important;
          transition: none !important;
        }
        .pdf-footer {
          display: flex;
          justify-content: space-between;
          border-top: 1px solid #e5e7eb;
          padding-top: 2mm;
          color: #6b7280;
          font-size: 7.5pt;
        }
        .pdf-error {
          padding: 2rem;
          background: white;
          color: #991b1b;
          font-family: "Source Sans 3", sans-serif;
        }
      `}</style>
    </main>
  );
}
