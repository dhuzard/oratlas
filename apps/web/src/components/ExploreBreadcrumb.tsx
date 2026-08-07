import Link from "next/link";

interface BreadcrumbParent {
  href: string;
  label: string;
}

export function ExploreBreadcrumb({
  current,
  href = "/explore",
  rootLabel = "Explore",
  parent,
}: {
  current: string;
  href?: string;
  rootLabel?: string;
  parent?: BreadcrumbParent;
}) {
  return (
    <nav className="explore-breadcrumb" aria-label="Breadcrumb">
      <Link href={href}>{rootLabel}</Link>
      <span aria-hidden="true">/</span>
      {parent ? (
        <>
          <Link href={parent.href}>{parent.label}</Link>
          <span aria-hidden="true">/</span>
        </>
      ) : null}
      <span aria-current="page">{current}</span>
    </nav>
  );
}
