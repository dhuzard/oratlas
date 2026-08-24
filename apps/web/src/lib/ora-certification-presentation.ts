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
    input.certifier.slug !== "ora" ||
    input.protocol.seriesKey !== "scientific-merit-pilot" ||
    input.protocol.version !== "0.1.0"
  )
    return null;
  const active = input.lifecycleState === "issued";
  const label = ORA_PILOT_LABELS[input.outcome as keyof typeof ORA_PILOT_LABELS];
  return label ? { label: active ? label : `${label} · ${input.lifecycleState}`, active } : null;
}
