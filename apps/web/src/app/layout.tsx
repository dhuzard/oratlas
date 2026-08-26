import "./globals.css";
import { type ReactNode } from "react";
import { type Metadata } from "next";
import Link from "next/link";
import { getServerEnv } from "@oratlas/config";
import { getCurrentUser, isEditor } from "@/lib/auth";
import { PUBLIC_PATHS } from "@/lib/public-discovery";

export const metadata: Metadata = {
  title: {
    default: "ORAtlas",
    template: "%s · ORAtlas",
  },
  description:
    "A scientific evidence ledger connecting exact publication versions to independent verification, claims, discussion and attributed certification.",
  openGraph: {
    title: "ORAtlas",
    description:
      "Scientific publications that can be independently checked through exact, versioned evidence records.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  const env = getServerEnv();
  return (
    <html lang="en">
      <head>
        <link rel="service-desc" href={PUBLIC_PATHS.openapiYaml} type="application/yaml" />
        <link rel="service-doc" href={PUBLIC_PATHS.apiDocs} type="text/html" />
      </head>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <header className="site-header">
          <div className="container">
            <Link href="/" className="brand" aria-label="ORAtlas home">
              OR<span>Atlas</span>
            </Link>
            <nav className="main-nav" aria-label="Primary">
              <Link href="/explore">Explore</Link>
              <Link href="/publications">Publications</Link>
              <Link href="/verification">Verification</Link>
              <Link href="/certifications">Certifications</Link>
              <Link href="/discuss">Discuss</Link>
              <Link href="/connect">Developers</Link>
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
              <strong>ORAtlas</strong> is a scientific evidence ledger. It connects immutable
              publication versions to verification, claims, discussion and attributed certification
              without changing the source publication. Verification and certification are{" "}
              <strong>not peer review</strong> or universal truth scores.
            </p>
            <p className="muted">
              <Link href="/archive">Legacy review archive</Link>
              {" · "}
              <Link href={PUBLIC_PATHS.apiDocs}>API &amp; agents</Link>
              {" · "}
              {env.mockAuthEnabled ? "Development mode: mock sign-in enabled. " : ""}
              <Link href="/connect">Connect a publication</Link>.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
