import Link from "next/link";
import { EXPLORATION_INTERESTS, type ExplorationInterest } from "@/lib/knowledge-landscape";

export function ExplorationIntent({
  query,
  selectedInterests,
  knownNodeIds,
  preservedParameters = [],
}: {
  query?: string;
  selectedInterests: ExplorationInterest[];
  knownNodeIds: string[];
  preservedParameters?: readonly (readonly [string, string])[];
}) {
  return (
    <section className="exploration-intent" aria-labelledby="exploration-intent-title">
      <div>
        <p className="home-eyebrow">Personalize this view</p>
        <h2 id="exploration-intent-title">What do you want to understand?</h2>
        <p>
          Describe a topic, then choose the lenses that matter to you. ORAtlas will show a small,
          explainable path through matching graph nodes. Separate collection indexes show which
          source types they cover.
        </p>
      </div>
      <form action="/explore" method="get" role="search" aria-label="Explore a topic">
        {preservedParameters.map(([name, value]) => (
          <input type="hidden" name={name} value={value} key={name} />
        ))}
        {knownNodeIds.map((nodeId) => (
          <input type="hidden" name="known" value={nodeId} key={nodeId} />
        ))}
        <div className="field exploration-topic">
          <label htmlFor="exploration-topic">Topic or question</label>
          <input
            id="exploration-topic"
            type="search"
            name="q"
            defaultValue={query ?? ""}
            placeholder="e.g. reproducibility of language-model evaluation"
          />
        </div>
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
            Show my knowledge path
          </button>
          {selectedInterests.length > 0 ? (
            <Link href={resetHref(query, knownNodeIds, preservedParameters)}>Reset interests</Link>
          ) : null}
        </div>
      </form>
    </section>
  );
}

function resetHref(
  query?: string,
  knownNodeIds: string[] = [],
  preservedParameters: readonly (readonly [string, string])[] = [],
): string {
  const parameters = new URLSearchParams();
  if (query) parameters.set("q", query);
  for (const nodeId of knownNodeIds) parameters.append("known", nodeId);
  for (const [name, value] of preservedParameters) parameters.set(name, value);
  const serialized = parameters.toString();
  return serialized ? `/explore?${serialized}` : "/explore";
}
