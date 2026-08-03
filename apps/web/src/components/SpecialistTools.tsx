import Link from "next/link";
import { ExploreBreadcrumb } from "./ExploreBreadcrumb.js";

const TOOLS = [
  {
    href: "/nodes",
    label: "Research objects",
    detail: "Inspect versioned claims, figures, datasets, and code.",
  },
  {
    href: "/graph",
    label: "Evidence graph",
    detail: "Trace confirmed relations between exact object versions.",
  },
  {
    href: "/synthesis",
    label: "Disagreement map",
    detail: "Compare opposing claims and declared scope differences.",
  },
  {
    href: "/coverage",
    label: "Coverage gaps",
    detail: "Find objects not covered by an accepted synthesis.",
  },
  {
    href: "/replications",
    label: "Replication briefs",
    detail: "Browse editor-published opportunities tied to claims.",
  },
  {
    href: "/discuss",
    label: "Grounded Q&A",
    detail: "Ask questions against accepted records and their evidence.",
  },
] as const;

export function SpecialistTools() {
  return (
    <details className="specialist-tools">
      <summary>Specialist tools for deeper analysis</summary>
      <div>
        <p className="muted">
          Use these focused views when the claim or review record raises a more specific question.
        </p>
        <nav aria-label="Specialist analysis tools">
          <ul>
            {TOOLS.map((tool) => (
              <li key={tool.href}>
                <Link href={tool.href}>
                  <strong>{tool.label}</strong>
                  <span>{tool.detail}</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </details>
  );
}

export function SpecialistToolBreadcrumb({
  current,
  parent,
}: {
  current: string;
  parent?: { href: string; label: string };
}) {
  return <ExploreBreadcrumb current={current} parent={parent} />;
}
