import { redirect } from "next/navigation";
import { Notice } from "@oratlas/ui";
import { getCurrentUser } from "@/lib/auth";
import { isTrustAdjudicator, listTrustDisagreementQueue } from "@/lib/trust-adjudication";
import { TrustAdjudicationPanel } from "../TrustAdjudicationPanel";

export const dynamic = "force-dynamic";

export default async function TrustAdjudicationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (!(await isTrustAdjudicator(user.id, user.role))) {
    return (
      <Notice tone="error" title="Adjudicator access required">
        Your account is not an editor or designated TRUST adjudicator.
      </Notice>
    );
  }
  return (
    <main className="container page-stack">
      <h1>TRUST adjudication queue</h1>
      <TrustAdjudicationPanel items={await listTrustDisagreementQueue()} />
    </main>
  );
}
