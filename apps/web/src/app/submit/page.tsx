import { type Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { SubmitWizard } from "./SubmitWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submit a repository" };

export default async function SubmitPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Submit a review or knowledge nodes</h1>
      <p className="prose muted">
        Authors submit a public GitHub repository containing a computational review, declared
        knowledge nodes, or both. You do not need to own the repository, but you are recorded as the
        submitter. No manuscript upload is required.
      </p>
      <SubmitWizard signedIn={Boolean(user)} />
    </div>
  );
}
