"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, RefreshCw, ShieldCheck } from "lucide-react";

import { Button, Card } from "@/components/ui";
import { processorEvidenceApi, type ProcessorEvidenceKey } from "@/lib/api";


function parseDocument(raw: string): Record<string, unknown> {
  const value = JSON.parse(raw);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error("The pasted value must be one JSON object.");
  }
  return value as Record<string, unknown>;
}


/** Desktop processor-key workflow. Controller keys never enter this application. */
export function ProcessorEvidenceSection() {
  const [keys, setKeys] = useState<ProcessorEvidenceKey[]>([]);
  const [processorId, setProcessorId] = useState("");
  const [supersedes, setSupersedes] = useState("");
  const [selectedKey, setSelectedKey] = useState("");
  const [challenge, setChallenge] = useState("");
  const [statement, setStatement] = useState("");
  const [output, setOutput] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const activeKeys = useMemo(() => keys.filter((key) => key.state === "active"), [keys]);

  const load = async () => {
    const next = await processorEvidenceApi.listKeys();
    setKeys(next);
    if (!selectedKey && next.some((key) => key.state === "active")) {
      setSelectedKey(next.find((key) => key.state === "active")!.key_id);
    }
  };

  useEffect(() => { load().catch((error) => setMessage(`Error: ${error}`)); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try { await operation(); }
    catch (error) { setMessage(`Error: ${error instanceof Error ? error.message : String(error)}`); }
    finally { setBusy(false); }
  };

  const generate = () => run(async () => {
    const result = await processorEvidenceApi.generateKey(processorId, supersedes || undefined);
    setOutput(JSON.stringify(result.registration, null, 2));
    setSelectedKey(result.key.key_id);
    await load();
    setMessage("Processor public-key package created. Verify the identity and fingerprint before the guarded Server ceremony.");
  });

  const sign = (kind: "registration" | "statement") => run(async () => {
    if (!selectedKey) throw new Error("Select an active processor key first.");
    const document = parseDocument(kind === "registration" ? challenge : statement);
    const result = kind === "registration"
      ? await processorEvidenceApi.signRegistration(selectedKey, document)
      : await processorEvidenceApi.signStatement(selectedKey, document);
    setOutput(JSON.stringify(result, null, 2));
    setMessage("The exact public document was signed locally. Only this proof package may be transferred.");
  });

  const retire = (key: ProcessorEvidenceKey) => run(async () => {
    if (!window.confirm(`Retire ${key.key_id} locally only after Server revocation?`)) return;
    await processorEvidenceApi.retireKey(key.key_id);
    await load();
    setMessage("Future local signing is disabled. Historic verification material remains available.");
  });

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-foreground">Processor signing key</h3>
        <p className="mt-1 text-sm text-foreground-muted">
          Desktop generates processor keys only. The private key stays in the operating-system credential store. Controller keys are created with the separate controller-custody utility and must never be pasted into Desktop.
        </p>
      </div>

      {message && <div className={`rounded-lg border px-4 py-3 text-sm ${message.startsWith("Error") ? "border-red-300 bg-red-50 text-red-800" : "border-green-300 bg-green-50 text-green-800"}`}>{message}</div>}

      <Card><div className="space-y-4 p-5">
        <div className="flex items-start gap-3"><KeyRound className="mt-0.5 h-5 w-5 text-blue-600" /><div><h4 className="font-medium">Generate during processor activation</h4><p className="text-sm text-foreground-muted">Use the processor identity already declared by the controller.</p></div></div>
        <label className="block text-sm">Processor ID
          <input value={processorId} onChange={(event) => setProcessorId(event.target.value)} placeholder="prc-example0001" className="mt-1 block w-full rounded-lg border border-bordercl-strong bg-surface px-3 py-2" />
        </label>
        <label className="block text-sm">Replaces local processor key, if rotating
          <select value={supersedes} onChange={(event) => setSupersedes(event.target.value)} className="mt-1 block w-full rounded-lg border-bordercl-strong bg-surface px-3 py-2"><option value="">New registration</option>{activeKeys.filter((key) => key.processor_id === processorId).map((key) => <option key={key.key_id} value={key.key_id}>{key.key_id}</option>)}</select>
        </label>
        <Button onClick={generate} disabled={busy || !processorId}>Generate processor key</Button>
      </div></Card>

      <Card><div className="space-y-4 p-5">
        <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-blue-600" /><div><h4 className="font-medium">Sign exact processor documents</h4><p className="text-sm text-foreground-muted">Challenges bind the instance, processor, role, fingerprint, action digest, expiry, and nonce.</p></div></div>
        <select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)} className="block w-full rounded-lg border-bordercl-strong bg-surface px-3 py-2"><option value="">Select a key</option>{activeKeys.map((key) => <option key={key.key_id} value={key.key_id}>{key.key_id} ({key.processor_id})</option>)}</select>
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="text-sm">Registration challenge JSON<textarea value={challenge} onChange={(event) => setChallenge(event.target.value)} rows={9} spellCheck={false} className="mt-1 block w-full rounded-lg border p-3 font-mono text-xs" /><Button className="mt-2" variant="secondary" onClick={() => sign("registration")} disabled={busy || !challenge}>Sign challenge</Button></label>
          <label className="text-sm">Processor statement JSON<textarea value={statement} onChange={(event) => setStatement(event.target.value)} rows={9} spellCheck={false} className="mt-1 block w-full rounded-lg border p-3 font-mono text-xs" /><Button className="mt-2" variant="secondary" onClick={() => sign("statement")} disabled={busy || !statement}>Sign statement</Button></label>
        </div>
      </div></Card>

      <Card><div className="space-y-3 p-5"><div className="flex items-center justify-between"><h4 className="font-medium">Public transfer package</h4><Button variant="secondary" onClick={() => run(async () => { await navigator.clipboard.writeText(output); setMessage("Public package copied."); })} disabled={!output || busy}><Copy className="mr-2 h-4 w-4" />Copy</Button></div><textarea readOnly value={output} rows={10} aria-label="Public processor transfer package" className="block w-full rounded-lg border bg-surface-subtle p-3 font-mono text-xs" /></div></Card>

      <div><div className="flex items-center justify-between"><h4 className="font-medium">Processor public-key inventory</h4><Button variant="ghost" onClick={() => run(load)} disabled={busy}><RefreshCw className="mr-2 h-4 w-4" />Refresh</Button></div>{keys.length === 0 ? <p className="text-sm text-foreground-muted">No local processor keys.</p> : keys.map((key) => <div key={key.key_id} className="mt-2 flex items-center justify-between rounded-lg border p-3 text-sm"><div><p className="font-mono">{key.key_id}</p><p className="text-foreground-muted">{key.processor_id} · processor · {key.state}</p></div>{key.state === "active" && <Button variant="ghost" onClick={() => retire(key)} disabled={busy}>Retire after Server revocation</Button>}</div>)}</div>
    </div>
  );
}
