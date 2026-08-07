import { type Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { SubmitWizard } from "./SubmitWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Deposit a review" };

export default async function SubmitPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <p className="home-eyebrow">ORAtlas deposit</p>
      <h1>Deposit a review or knowledge nodes</h1>
      <p className="prose muted">
        Submit a public GitHub repository containing a completed computational review, declared
        knowledge nodes, or both. ORAtlas captures an exact repository state; it does not generate
        the review and no manuscript upload is required.
      </p>
      <p className="notice notice-info prose">
        Need to create the review first? Follow the{" "}
        <Link href="/create-review">Allen AIreview → ORAtlas guide</Link>.
      </p>
      <SubmitWizard signedIn={Boolean(user)} />
    </div>
  );
}
