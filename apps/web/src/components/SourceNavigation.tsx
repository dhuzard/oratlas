import Link from "next/link";

const SOURCE_VIEWS = [
  { href: "/publications", label: "Registered publications" },
  { href: "/archive", label: "Archived reviews" },
  { href: "/nodes", label: "Research objects" },
] as const;

export function SourceNavigation({ current }: { current: (typeof SOURCE_VIEWS)[number]["href"] }) {
  return (
    <nav className="source-navigation" aria-label="Source collections">
      {SOURCE_VIEWS.map(({ href, label }) => (
        <Link key={href} href={href} aria-current={current === href ? "page" : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
