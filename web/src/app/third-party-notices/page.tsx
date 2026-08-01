import fs from "node:fs";
import path from "node:path";
import Link from "next/link";

export const dynamic = "force-static";

export default function ThirdPartyNoticesPage() {
  const notices = fs.readFileSync(
    path.join(process.cwd(), "legal-artifacts", "THIRD-PARTY-NOTICES.md"),
    "utf8",
  );
  return (
    <main className="min-h-screen bg-background px-6 py-12 text-foreground">
      <article className="mx-auto max-w-4xl space-y-5">
        <h1 className="text-3xl font-bold">Third-party notices</h1>
        <p>This is the read-only third-party inventory shipped with this Desktop build.</p>
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border bg-surface p-5 text-xs">{notices}</pre>
        <Link className="text-primary underline" href="/licence">Open the software licence</Link>
      </article>
    </main>
  );
}
