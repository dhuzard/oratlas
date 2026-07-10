import { type Metadata } from "next";
import { getCurrentUser } from "@/lib/auth";
import { SubmitWizard } from "./SubmitWizard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Submit a repository" };

export default async function SubmitPage() {
  const user = await getCurrentUser();
  return (
    <div>
      <h1>Submit a computational review</h1>
      <p className="prose muted">
        Authors submit the URL of a public GitHub repository containing a review built with, forked
        from, or structurally compatible with the ComputationalReviewTemplate. You do not need to
        own the repository, but you are recorded as the submitter (distinct from the review’s
        authors). No manuscript upload is required.
      </p>
      <SubmitWizard signedIn={Boolean(user)} />
    </div>
  );
}
