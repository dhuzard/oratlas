interface InspectionStep {
  href: `#${string}`;
  label: string;
  detail: string;
}

export function InspectionPath({ label, steps }: { label: string; steps: InspectionStep[] }) {
  return (
    <nav className="inspection-path" aria-label={label}>
      <ol>
        {steps.map((step, index) => (
          <li key={step.href}>
            <a href={step.href}>
              <span className="inspection-step-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                <strong>{step.label}</strong>
                <small>{step.detail}</small>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
