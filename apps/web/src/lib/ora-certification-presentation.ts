import {
  ORA_CERTIFIER_SLUG,
  ORA_SCIENTIFIC_MERIT_SERIES,
  ORA_SCIENTIFIC_MERIT_VERSION,
} from "@oratlas/contracts";

export const ORA_PILOT_LABELS = {
  certified: "ORA Certified · Pilot",
  "certified-with-conditions": "ORA Certified with conditions · Pilot",
  "not-certified": "ORA Not certified · Pilot",
  inconclusive: "ORA Assessment inconclusive · Pilot",
} as const;

export function oraPilotPresentation(input: {
  certifier: { slug: string };
  protocol: { seriesKey: string; version: string };
  outcome: string;
  lifecycleState: string;
}) {
  if (
    input.certifier.slug !== ORA_CERTIFIER_SLUG ||
    input.protocol.seriesKey !== ORA_SCIENTIFIC_MERIT_SERIES ||
    input.protocol.version !== ORA_SCIENTIFIC_MERIT_VERSION
  )
    return null;
  const active = input.lifecycleState === "issued";
  const label = ORA_PILOT_LABELS[input.outcome as keyof typeof ORA_PILOT_LABELS];
  return label
    ? {
        label: active ? label : `ORA assessment · Pilot · ${input.lifecycleState}`,
        active,
      }
    : null;
}
