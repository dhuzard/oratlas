import { type Metadata } from "next";
import Link from "next/link";
import { SpecialistToolBreadcrumb } from "@/components/SpecialistTools";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Grounded Q&A" };

export default function DiscussPage() {
  return (
    <div>
      <SpecialistToolBreadcrumb current="Grounded Q&A" />
      <h1>Grounded Q&amp;A</h1>
      <p className="prose muted">
        Atlas Discuss is available only after you traverse the canonical graph. The visible exact
        node versions and edges form a signed evidence boundary; the server rejects empty, edited,
        missing, or stale scopes instead of searching the archive again.
      </p>
      <p className="notice notice-info" data-register="open-discussion">
        Grounded Q&amp;A output is open discussion, not a formal challenge. It neither creates nor
        changes a TRUST assessment, formal review report, challenge record, editorial decision, or
        immutable archive.
      </p>
      <p>
        <Link className="btn" href="/explore">
          Choose a graph path in Explore
        </Link>
      </p>
    </div>
  );
}
