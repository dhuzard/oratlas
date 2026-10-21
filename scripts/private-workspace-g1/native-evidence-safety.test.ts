import { expect, it } from "vitest";
import { nativeEvidenceProblems } from "./native-evidence-safety.js";
it("refuses actual cookie/database fragments through native bodies, JSON strings and keys", () => {
  const secret = 'synthetic"credential\\component';
  const escaped = [...secret]
    .map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
  const bodies = [
    JSON.stringify({ message: secret }),
    '{"message":"' + escaped + '"}',
    JSON.stringify(JSON.stringify({ [secret]: "public" })),
  ];
  for (const body of bodies) {
    const value = { bodyBase64: Buffer.from(body).toString("base64") };
    const before = JSON.stringify(value);
    expect(nativeEvidenceProblems(value, [secret])).toEqual([
      "Native evidence capability disclosure refused",
    ]);
    expect(JSON.stringify(value)).toBe(before);
  }
  expect(
    nativeEvidenceProblems(
      { bodyBase64: Buffer.from('{"message":"oratlas_lease_synthetic-leak"}').toString("base64") },
      [],
    ),
  ).not.toEqual([]);
  expect(
    nativeEvidenceProblems(
      {
        cookieSha256: "publicdigest",
        bodyBase64: Buffer.from('{"public":"value"}').toString("base64"),
      },
      [secret],
    ),
  ).toEqual([]);
});
it("refuses bounded inspection overflow with fixed errors", () => {
  let nested: unknown = {};
  for (let i = 0; i < 65; i++) nested = { nested };
  expect(nativeEvidenceProblems(nested, [])).toEqual(["Native evidence inspection bound refused"]);
  expect(nativeEvidenceProblems("x".repeat(16 * 1024 * 1024 + 1), [])).toEqual([
    "Native evidence inspection bound refused",
  ]);
});
