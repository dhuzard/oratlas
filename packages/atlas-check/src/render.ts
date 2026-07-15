import { type AtlasCheckFinding, type AtlasCheckReport } from "@oratlas/contracts";

export type AtlasCheckOutputFormat = "json" | "github" | "text";

export function renderAtlasCheckReport(
  report: AtlasCheckReport,
  format: AtlasCheckOutputFormat,
): string {
  if (format === "json") return `${JSON.stringify(report, null, 2)}\n`;
  if (format === "github") return renderGithub(report);
  return renderText(report);
}

function renderGithub(report: AtlasCheckReport): string {
  const lines = report.findings.map((finding) => githubAnnotation(finding));
  lines.push(
    `Atlas Check: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.notices} notice(s); ${report.summary.recordsChecked} record(s) checked.`,
  );
  return `${lines.join("\n")}\n`;
}

export function githubAnnotation(finding: AtlasCheckFinding): string {
  const properties = [
    finding.path ? `file=${escapeProperty(finding.path)}` : undefined,
    finding.line ? `line=${finding.line}` : undefined,
    finding.column ? `col=${finding.column}` : undefined,
    `title=${escapeProperty(finding.ruleId)}`,
  ].filter((value): value is string => Boolean(value));
  const message = finding.suggestion
    ? `${finding.message} Suggested fix: ${finding.suggestion}`
    : finding.message;
  return `::${finding.severity} ${properties.join(",")}::${escapeData(message)}`;
}

function renderText(report: AtlasCheckReport): string {
  const lines = report.findings.map((finding) => {
    const location = finding.path
      ? `${finding.path}${finding.line ? `:${finding.line}` : ""}: `
      : "";
    const suggestion = finding.suggestion ? `\n  Fix: ${finding.suggestion}` : "";
    return `${finding.severity.toUpperCase()} ${finding.ruleId} ${location}${finding.message}${suggestion}`;
  });
  lines.push(
    `Atlas Check ${report.summary.passed ? "passed" : "failed"}: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.notices} notice(s); ${report.summary.filesChecked} file(s) and ${report.summary.recordsChecked} record(s) checked.`,
  );
  return `${lines.join("\n")}\n`;
}

function escapeData(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
