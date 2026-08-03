import Link from "next/link";
import { EXPLORATION_INTERESTS, type ExplorationInterest } from "@/lib/knowledge-landscape";

export function ExplorationIntent({
  query,
  selectedInterests,
  view,
}: {
  query?: string;
  selectedInterests: ExplorationInterest[];
  view: "claims" | "reviews";
}) {
  return (
    <section className="exploration-intent" aria-labelledby="exploration-intent-title">
      <div>
        <p className="home-eyebrow">Personalize this view</p>
        <h2 id="exploration-intent-title">What do you want to understand?</h2>
        <p>
          Choose explicit interests to build a small knowledge landscape from the current search.
          These choices shape the map only; the complete results remain available below.
        </p>
      </div>
      <form action="/explore" method="get">
        <input type="hidden" name="view" value={view} />
        {query ? <input type="hidden" name="q" value={query} /> : null}
        <fieldset>
          <legend className="sr-only">Knowledge landscape interests</legend>
          <div className="interest-options">
            {EXPLORATION_INTERESTS.map((interest) => (
              <label key={interest.id}>
                <input
                  type="checkbox"
                  name="interest"
                  value={interest.id}
                  defaultChecked={selectedInterests.includes(interest.id)}
                />
                <span>
                  <strong>{interest.label}</strong>
                  <small>{interest.detail}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="btn-row">
          <button className="btn" type="submit">
            Build knowledge landscape
          </button>
          {selectedInterests.length > 0 ? (
            <Link href={resetHref(view, query)}>Reset interests</Link>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function resetHref(view: "claims" | "reviews", query?: string): string {
  const parameters = new URLSearchParams({ view });
  if (query) parameters.set("q", query);
  return `/explore?${parameters}`;
}
