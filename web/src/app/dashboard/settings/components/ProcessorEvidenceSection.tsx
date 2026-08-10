"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Download, KeyRound, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { Button, Card } from "@/components/ui";
import { useEvent } from "@/contexts/EventContext";
import { processorEvidenceApi, type ProcessorEvidenceKey } from "@/lib/api";

const MAX_KEY_PACKAGE_BYTES = 128 * 1024;

/** Event-scoped processor custody without exposing routine signing controls. */
export function ProcessorEvidenceSection() {
  const { selectedEventId, availableEvents } = useEvent();
  const selectedEvent = availableEvents.find((item) => item.id === selectedEventId);
  const [keys, setKeys] = useState<ProcessorEvidenceKey[]>([]);
  const [label, setLabel] = useState("");
  const [keyPackage, setKeyPackage] = useState<Record<string, unknown> | null>(null);
  const [packageName, setPackageName] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const eventKeys = useMemo(() => keys, [keys]);
  const current = eventKeys.find((key) => key.state === "active")
    || eventKeys.find((key) => key.state === "pending_root_approval")
    || null;

  const load = async () => {
    if (!selectedEventId) { setKeys([]); return; }
    setKeys(await processorEvidenceApi.listKeys(selectedEventId));
  };
  useEffect(() => {
    setKeys([]);
    void load().catch((error) => setMessage(`Error: ${String(error)}`));
    // The selected event is the scope boundary for local processor custody.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEventId]);

  async function run(name: string, operation: () => Promise<void>) {
    setBusy(name); setMessage("");
    try { await operation(); }
    catch (error) { setMessage(`Error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(""); }
  }

  async function generate() {
    if (!selectedEventId) return;
    await run("generate", async () => {
      const created = await processorEvidenceApi.generateKey(selectedEventId, label || undefined);
      await processorEvidenceApi.enrolKey(selectedEventId, created.key.key_id);
      await load();
      setMessage("Processor key created locally and submitted. Ask the Server root to approve the pending event assignment.");
    });
  }

  async function importPackage() {
    if (!selectedEventId || !keyPackage) return;
    await run("import", async () => {
      const imported = await processorEvidenceApi.importKey(selectedEventId, keyPackage, passphrase, label || undefined);
      setPassphrase(""); setKeyPackage(null); setPackageName("");
      await processorEvidenceApi.enrolKey(selectedEventId, imported.key.key_id);
      await load();
      setMessage("Encrypted key imported into the operating-system credential store and submitted for root approval.");
    });
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = "";
    if (!file) return;
    if (file.size > MAX_KEY_PACKAGE_BYTES) { setMessage("Error: The processor key package is too large."); return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("The file is not a JSON object.");
      setKeyPackage(parsed as Record<string, unknown>); setPackageName(file.name); setMessage("");
    } catch (error) { setMessage(`Error: ${error instanceof Error ? error.message : "Invalid key package"}`); }
  }

  async function refresh() {
    if (!selectedEventId) return;
    await run("refresh", async () => {
      await processorEvidenceApi.refreshEventStatus(selectedEventId); await load();
      setMessage("Processor-key status refreshed from the Server.");
    });
  }

  if (!selectedEventId) return <p className="text-sm text-foreground-muted">Select an event to configure its Desktop processor key.</p>;

  const status = current?.state === "active" ? "Ready" : current?.state === "pending_root_approval" ? "Waiting for root approval" : "Setup required";
  return <div className="space-y-6">
    <div>
      <h3 className="text-lg font-semibold text-foreground">Desktop processor identity</h3>
      <p className="mt-1 text-sm text-foreground-muted">One processor identity is bound to {selectedEvent?.name || "this event"}. Its private key remains in this operating-system account.</p>
    </div>
    {message && <div className={`rounded-lg border px-4 py-3 text-sm ${message.startsWith("Error") ? "border-red-300 bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-200" : "border-green-300 bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-200"}`}>{message}</div>}

    <Card><div className="flex flex-wrap items-start justify-between gap-4 p-5">
      <div className="flex items-start gap-3">
        {current?.state === "active" ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-green-600" /> : <ShieldCheck className="mt-0.5 h-5 w-5 text-amber-600" />}
        <div><p className="font-medium">{status}</p><p className="mt-1 text-sm text-foreground-muted">{current ? `${current.display_label || current.processor_id} · ${current.key_id}` : "Publishing and permitted-data acknowledgement remain blocked until setup is complete."}</p></div>
      </div>
      {current && <Button variant="outline" onClick={refresh} disabled={!!busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button>}
    </div></Card>

    {!current && <div className="grid gap-4 lg:grid-cols-2">
      <Card><div className="space-y-4 p-5">
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 text-blue-600" /><div><h4 className="font-medium">Generate on this Desktop</h4><p className="text-sm text-foreground-muted">Recommended when this workstation will retain the processor key.</p></div></div>
        <label className="block text-sm">Optional display label<input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={128} className="mt-1 block w-full rounded-lg border border-bordercl-strong bg-surface px-3 py-2" placeholder="Event operations workstation" /></label>
        <Button onClick={generate} disabled={!!busy}>{busy === "generate" ? "Creating…" : "Generate and submit"}</Button>
      </div></Card>
      <Card><div className="space-y-4 p-5">
        <div className="flex items-start gap-3"><Upload className="mt-0.5 h-5 w-5 text-blue-600" /><div><h4 className="font-medium">Import an encrypted key</h4><p className="text-sm text-foreground-muted">Use a package created independently on the public processor-key page.</p></div></div>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-bordercl-strong px-4 py-4 text-sm"><Download className="h-4 w-4" />{packageName || "Choose encrypted processor-key JSON"}<input type="file" accept="application/json,.json" onChange={chooseFile} className="sr-only" /></label>
        <label className="block text-sm">Key passphrase<input type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} autoComplete="new-password" className="mt-1 block w-full rounded-lg border border-bordercl-strong bg-surface px-3 py-2" /></label>
        <Button onClick={importPackage} disabled={!!busy || !keyPackage || passphrase.length < 16}>{busy === "import" ? "Importing…" : "Import and submit"}</Button>
      </div></Card>
    </div>}

    {current && <details className="rounded-lg border border-border p-4 text-sm"><summary className="cursor-pointer font-medium">Technical key details</summary><dl className="mt-3 grid gap-2 break-all text-xs sm:grid-cols-[10rem_1fr]"><dt>Processor</dt><dd>{current.processor_id}</dd><dt>Key</dt><dd>{current.key_id}</dd><dt>Fingerprint</dt><dd>{current.public_key_sha256}</dd><dt>Event identity</dt><dd>{current.event_evidence_id}</dd><dt>Server instance</dt><dd>{current.server_instance_id || "Pending"}</dd></dl></details>}
  </div>;
}
