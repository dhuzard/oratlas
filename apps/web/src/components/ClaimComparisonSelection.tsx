import {
  withClaimComparisonSelection,
  type ClaimComparisonSelection as Selection,
} from "@/lib/claim-comparison-selection";

export function ClaimComparisonSelection({
  selection,
  selectedText,
  unavailable,
  currentHref,
}: {
  selection: Selection;
  selectedText?: string;
  unavailable?: boolean;
  currentHref: string;
}) {
  return (
    <section className="claim-comparison-selection card" aria-label="Claim comparison selection">
      <h2>
        {unavailable
          ? "Selected claim is unavailable"
          : selection.compareLeft
            ? selection.replaceSide === "first"
              ? "Choose a replacement first claim"
              : "Choose a second exact claim"
            : "Select two exact claims"}
      </h2>
      {unavailable ? (
        <p>
          The selected reference is invalid or no longer publicly readable. Choose a claim again; no
          replacement was selected automatically.
        </p>
      ) : selection.compareLeft ? (
        <>
          <p>{selectedText}</p>
          <p>
            Selected exact reference:{" "}
            <code style={{ overflowWrap: "anywhere" }}>{selection.compareLeft}</code>
          </p>
          <p>
            Choose a distinct claim below to open the comparison. You can change the topic or
            filters while keeping this selection.
          </p>
        </>
      ) : (
        <p>
          Select a first claim below, then a distinct second claim to inspect their exact versions
          together.
        </p>
      )}
      {selection.compareLeft || unavailable ? (
        <a href={withClaimComparisonSelection(currentHref, {})}>Remove selected claim</a>
      ) : null}
      <p className="muted">
        Selection is held in this URL. It saves no personal judgment and confirms no relationship.
      </p>
    </section>
  );
}

export function ClaimComparisonAction({
  reference,
  selection,
  currentHref,
}: {
  reference: string;
  selection: Selection;
  currentHref: string;
}) {
  if (selection.compareLeft === reference) return <span>Selected exact claim</span>;
  const selectHref = withClaimComparisonSelection(currentHref, {
    compareLeft: reference,
    replaceSide: selection.replaceSide,
  });
  if (!selection.compareLeft) return <a href={selectHref}>Select as first claim</a>;
  const pair =
    selection.replaceSide === "first"
      ? { left: reference, right: selection.compareLeft }
      : { left: selection.compareLeft, right: reference };
  return (
    <div className="btn-row">
      <a href={`/compare/claims?${new URLSearchParams(pair)}`}>Compare with selected claim</a>
      <a href={selectHref}>Replace selected claim</a>
    </div>
  );
}
