import "./globals.css";
import { type ReactNode } from "react";
import { type Metadata } from "next";
import Link from "next/link";
import { getServerEnv } from "@oratlas/config";
import { getCurrentUser, isEditor } from "@/lib/auth";

export const metadata: Metadata = {
  title: {
    default: "Open Review Atlas",
    template: "%s · Open Review Atlas",
  },
  description:
    "The arXiv for AI-generated scientific reviews: inspect claims, linked evidence, and independent assessments or disagreements without rewriting the original record.",
  openGraph: {
    title: "Open Review Atlas",
    description:
      "Inspect claims, linked evidence, and independent assessments across versioned AI-generated scientific reviews.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const env = getServerEnv();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" aria-label="Open Review Atlas home">
              Open Review <span>Atlas</span>
            </Link>
            <nav className="main-nav" aria-label="Primary">
              <Link href="/explore">Explore</Link>
              <Link href="/submit">Submit a review</Link>
              <Link href="/#how-it-works">How it works</Link>
              {isEditor(user) ? <Link href="/editorial">Editorial</Link> : null}
              {user ? (
                <span className="signed-in-user">
                  {user.githubLogin}
                  {isEditor(user) ? " (editor)" : ""}
                </span>
              ) : (
                <Link href="/signin">Sign in</Link>
              )}
            </nav>
          </div>
        </header>
        <main id="main">
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container prose">
            <p>
              <strong>Open Review Atlas</strong> is a proof-of-concept public archive for
              AI-generated scientific reviews. Acceptance into the archive is{" "}
              <strong>not peer review</strong>. Assessments apply to specific evidence relations,
              and a DOI does not establish scientific quality.
            </p>
            <p className="muted">
              {env.mockAuthEnabled ? "Development mode: mock sign-in enabled. " : ""}
              Reference template:{" "}
              <a href="https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate">
                ComputationalReviewTemplate
              </a>
              .
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
