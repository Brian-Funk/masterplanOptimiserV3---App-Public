"use client";

import { useEffect, useMemo, useState } from "react";
import Calendar, { type CalendarTask } from "@/components/Calendar";
import type { PdfExportPayload } from "@/lib/electronDiagnostics";
import {
  buildPdfDayTaskModel,
  type PdfTaskDetail,
} from "@/lib/pdfScheduleDetails";

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

function waitAtMost(promise: Promise<unknown>, timeoutMs: number): Promise<void> {
  return Promise.race([
    promise.then(() => undefined),
    new Promise<void>((resolve) => window.setTimeout(resolve, timeoutMs)),
  ]);
}

/** Fit the visual timeline to portrait width without shrinking it to a fixed page height. */
function fitCalendars() {
  document.querySelectorAll<HTMLElement>("[data-pdf-calendar-frame]").forEach((frame) => {
    const content = frame.querySelector<HTMLElement>("[data-pdf-calendar-content]");
    if (!content) return;
    content.style.transform = "none";
    frame.style.height = "auto";
    const widthScale = frame.clientWidth / Math.max(content.scrollWidth, 1);
    const scale = Math.min(1, widthScale);
    content.style.transform = `scale(${scale})`;
    frame.style.height = `${Math.ceil(content.scrollHeight * scale)}px`;
  });
}

function PdfHeader({
  job,
  dayLabel,
}: {
  job: PdfJob;
  dayLabel: string;
}) {
  return (
    <header className="pdf-header">
      <div className="pdf-brand">
        {/* Use the original raster asset directly so Chromium preserves its blue/violet colour. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo_normal.png" alt="MP-OPT" width="54" height="54" />
        <div className="pdf-brand-divider" />
        <div className="pdf-title-block">
          <p className="pdf-kicker">Optimised Schedule</p>
          <h1>{job.title}</h1>
        </div>
      </div>
      <div className="pdf-event-meta">
        <strong>{job.eventName}</strong>
        {job.eventLocation && <span>{job.eventLocation}</span>}
        <span>{dayLabel}</span>
        <small>Generated {new Date(job.generatedAt).toLocaleString()}</small>
      </div>
    </header>
  );
}

function PdfTaskDetailRow({ detail }: { detail: PdfTaskDetail }) {
  return (
    <tr className="pdf-task-row" data-pdf-task-reference={detail.reference}>
      <td>
        <article className="pdf-task-detail">
          <div className="pdf-task-heading">
            <span className="pdf-task-reference">{detail.reference}</span>
            <div className="pdf-task-title">
              <h3>{detail.title}</h3>
              <span>{detail.taskType}</span>
            </div>
            <span className="pdf-task-time">{detail.time}</span>
          </div>
          <div className="pdf-task-accent" style={{ backgroundColor: detail.colour }} />
          <dl className="pdf-task-facts">
            {detail.location && (
              <div>
                <dt>Location</dt>
                <dd>{detail.location}</dd>
              </div>
            )}
            {detail.allocations.length > 0 && (
              <div>
                <dt>Allocations</dt>
                <dd>
                  {detail.allocations.map((allocation) => (
                    <span className="pdf-allocation-line" key={allocation}>
                      {allocation}
                    </span>
                  ))}
                </dd>
              </div>
            )}
            {detail.fields.map((field) => (
              <div key={`${field.label}-${field.value}`}>
                <dt>{field.label}</dt>
                <dd>{field.value}</dd>
              </div>
            ))}
          </dl>
        </article>
      </td>
    </tr>
  );
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
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason));
        if (window.electron?.notifyPdfExportFailed) {
          void window.electron.notifyPdfExportFailed(jobId, "PDF_JOB_LOAD_FAILED");
        }
      });
    return () => observer.disconnect();
  }, []);

  const renderedJob = useMemo(() => {
    if (!job) return { days: [], error: "" };
    try {
      return {
        days: job.days.map((day) => ({
          ...day,
          model: buildPdfDayTaskModel(day.tasks as CalendarTask[]),
        })),
        error: "",
      };
    } catch {
      return { days: [], error: "PDF_LAYOUT_FAILED" };
    }
  }, [job]);
  const days = renderedJob.days;

  useEffect(() => {
    if (!renderedJob.error) return;
    const jobId = new URLSearchParams(window.location.search).get("job");
    setError("The PDF schedule could not be laid out.");
    if (jobId && window.electron?.notifyPdfExportFailed) {
      void window.electron.notifyPdfExportFailed(jobId, renderedJob.error);
    }
  }, [renderedJob.error]);

  useEffect(() => {
    if (!job || days.length === 0) return;
    const jobId = new URLSearchParams(window.location.search).get("job");
    let cancelled = false;
    const ready = async () => {
      await waitAtMost(document.fonts.ready, 15000);
      await waitAtMost(waitForImages(), 15000);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      fitCalendars();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (!cancelled && jobId && window.electron?.notifyPdfExportReady) {
        await window.electron.notifyPdfExportReady(jobId);
      }
    };
    ready().catch((reason) => {
      setError(reason instanceof Error ? reason.message : String(reason));
      if (jobId && window.electron?.notifyPdfExportFailed) {
        void window.electron.notifyPdfExportFailed(jobId, "PDF_READY_FAILED");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [days, job]);

  if (error) {
    return <main className="pdf-error">{error}</main>;
  }
  if (!job) {
    return <main className="pdf-error">Preparing PDF schedule...</main>;
  }

  return (
    <main className="pdf-document">
      {days.map((day) => (
        <section className="pdf-day" key={day.date}>
          <PdfHeader job={job} dayLabel={day.dayLabel} />

          <section className="pdf-timeline-section" aria-label={`Schedule for ${day.dayLabel}`}>
            <div className="pdf-section-heading">
              <div>
                <p>Visual schedule</p>
                <h2>{day.dayLabel}</h2>
              </div>
              <span>
                {day.model.details.length} {day.model.details.length === 1 ? "task" : "tasks"}
              </span>
            </div>
            <div className="pdf-calendar-frame" data-pdf-calendar-frame>
              <div className="pdf-calendar-content" data-pdf-calendar-content>
                <Calendar
                  tasks={day.model.tasks}
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
          </section>

          <table className="pdf-details-table" aria-label={`Task details for ${day.dayLabel}`}>
            <thead>
              <tr>
                <th>
                  <div className="pdf-details-heading">
                    <div>
                      <p>Task details</p>
                      <h2>{day.dayLabel}</h2>
                    </div>
                    <span>
                      {job.eventName}
                      {job.eventLocation ? ` - ${job.eventLocation}` : ""}
                    </span>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {day.model.details.map((detail) => (
                <PdfTaskDetailRow detail={detail} key={detail.reference} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 9mm 10mm 12mm;
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
          width: 100%;
          background: #ffffff;
          color: #111827;
          color-scheme: light;
          font-family: "Source Sans 3", sans-serif;
          font-size: 10pt;
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
        .pdf-day {
          break-before: page;
          page-break-before: always;
        }
        .pdf-day:first-child {
          break-before: auto;
          page-break-before: auto;
        }
        .pdf-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6mm;
          margin-bottom: 5mm;
          border-bottom: 1px solid #dbe3f0;
          padding-bottom: 3mm;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .pdf-brand {
          display: flex;
          min-width: 0;
          align-items: center;
          gap: 3mm;
        }
        .pdf-brand img {
          width: 14mm;
          height: 14mm;
          flex: 0 0 auto;
          object-fit: contain;
        }
        .pdf-brand-divider {
          width: 1px;
          height: 13mm;
          flex: 0 0 auto;
          background: linear-gradient(#2563eb, #7c3aed);
        }
        .pdf-title-block {
          min-width: 0;
        }
        .pdf-kicker,
        .pdf-section-heading p,
        .pdf-details-heading p {
          margin: 0 0 0.5mm;
          color: #4f46e5;
          font-size: 7.5pt;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .pdf-header h1 {
          max-width: 105mm;
          margin: 0;
          overflow-wrap: anywhere;
          color: #111827;
          font-size: 16pt;
          font-weight: 700;
          line-height: 1.08;
        }
        .pdf-event-meta {
          display: flex;
          max-width: 62mm;
          flex: 0 0 auto;
          flex-direction: column;
          align-items: flex-end;
          color: #4b5563;
          font-size: 8.5pt;
          line-height: 1.25;
          text-align: right;
        }
        .pdf-event-meta strong {
          color: #111827;
          font-size: 9.5pt;
        }
        .pdf-event-meta small {
          margin-top: 1mm;
          color: #6b7280;
          font-size: 7pt;
        }
        .pdf-timeline-section {
          margin-bottom: 5mm;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .pdf-section-heading,
        .pdf-details-heading {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 5mm;
          border-bottom: 1px solid #e5e7eb;
          padding-bottom: 2mm;
        }
        .pdf-section-heading {
          margin-bottom: 2.5mm;
        }
        .pdf-section-heading h2,
        .pdf-details-heading h2 {
          margin: 0;
          color: #111827;
          font-size: 12pt;
          line-height: 1.15;
        }
        .pdf-section-heading > span,
        .pdf-details-heading > span {
          color: #6b7280;
          font-size: 8pt;
          font-weight: 500;
          text-align: right;
        }
        .pdf-calendar-frame {
          width: 100%;
          min-height: 0;
          overflow: hidden;
        }
        .pdf-calendar-content {
          width: 100%;
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
        [data-pdf-mode="true"] [data-presentation-card="true"] {
          padding: 6px !important;
        }
        [data-pdf-mode="true"] [data-presentation-card="true"] .line-clamp-2 {
          line-height: 1.12 !important;
        }
        .pdf-details-table {
          width: 100%;
          border-spacing: 0;
        }
        .pdf-details-table thead {
          display: table-header-group;
        }
        .pdf-details-table th,
        .pdf-details-table td {
          padding: 0;
          text-align: left;
        }
        .pdf-details-heading {
          margin-bottom: 2.5mm;
          background: #ffffff;
        }
        .pdf-task-row,
        .pdf-task-detail {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .pdf-task-row td {
          padding-bottom: 2.5mm;
        }
        .pdf-task-detail {
          position: relative;
          overflow: hidden;
          border: 1px solid #dbe3f0;
          border-radius: 2.5mm;
          background: #ffffff;
          box-shadow: 0 1px 2px rgb(15 23 42 / 0.05);
        }
        .pdf-task-accent {
          position: absolute;
          inset: 0 auto 0 0;
          width: 1.3mm;
        }
        .pdf-task-heading {
          display: grid;
          grid-template-columns: auto minmax(0, 1fr) auto;
          align-items: start;
          gap: 3mm;
          padding: 3mm 3.5mm 2.5mm 4.5mm;
          background: linear-gradient(90deg, #f8fafc, #ffffff);
        }
        .pdf-task-reference {
          border-radius: 1.5mm;
          background: #4f46e5;
          padding: 1mm 1.8mm;
          color: #ffffff;
          font-size: 8pt;
          font-weight: 700;
          letter-spacing: 0.04em;
          line-height: 1;
        }
        .pdf-task-title h3 {
          margin: 0;
          overflow-wrap: anywhere;
          color: #111827;
          font-size: 11pt;
          font-weight: 700;
          line-height: 1.2;
        }
        .pdf-task-title span {
          display: block;
          margin-top: 0.5mm;
          color: #6b7280;
          font-size: 8pt;
        }
        .pdf-task-time {
          white-space: nowrap;
          color: #312e81;
          font-family: "Source Sans 3", sans-serif;
          font-size: 9pt;
          font-weight: 700;
        }
        .pdf-task-facts {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 2.5mm 5mm;
          margin: 0;
          border-top: 1px solid #eef2f7;
          padding: 2.5mm 3.5mm 3mm 4.5mm;
        }
        .pdf-task-facts > div {
          min-width: 0;
        }
        .pdf-task-facts dt {
          margin: 0 0 0.5mm;
          color: #6b7280;
          font-size: 7.5pt;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .pdf-task-facts dd {
          margin: 0;
          overflow-wrap: anywhere;
          color: #1f2937;
          font-size: 9pt;
          line-height: 1.3;
          white-space: pre-wrap;
        }
        .pdf-allocation-line {
          display: block;
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
