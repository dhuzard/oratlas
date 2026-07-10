import Link from "next/link";

export default function NotFound() {
  return (
    <div className="prose">
      <h1>Not found</h1>
      <p className="muted">The page or review you requested does not exist in this archive.</p>
      <Link className="btn btn-secondary" href="/archive">
        Browse the archive
      </Link>
    </div>
  );
}
