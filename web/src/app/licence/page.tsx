import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

export const dynamic = "force-static";

export default function LicencePage() {
  const licence = fs.readFileSync(
    path.join(process.cwd(), "legal-artifacts", "LICENSE"),
    "utf8",
  );
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <article className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-3xl font-bold">Software licence</h1>
        <p>This is the exact read-only AGPL-3.0-only licence shipped with this Desktop build.</p>
        <p className="break-all">The corresponding source for this exact build is available at <a className="text-primary underline" href={process.env.NEXT_PUBLIC_SOURCE_URL} rel="noreferrer" target="_blank">{process.env.NEXT_PUBLIC_SOURCE_REPOSITORY_URL}@{process.env.NEXT_PUBLIC_SOURCE_REVISION}</a>. Modified builds must identify their own repository and exact commit.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border bg-surface p-5 text-xs">{licence}</pre>
        <Link className="text-primary underline" href="/third-party-notices">Open third-party notices</Link>
      </article>
    </main>
  );
}
