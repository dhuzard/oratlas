import { describe, expect, it } from "vitest";
import { parseGithubRepoUrl } from "./url.js";

describe("parseGithubRepoUrl — normalization", () => {
  it("normalizes canonical, shorthand and .git URLs to the same ref", () => {
    const forms = [
      "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
      "http://github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
      "https://www.github.com/AllenNeuralDynamics/ComputationalReviewTemplate/",
      "github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
      "AllenNeuralDynamics/ComputationalReviewTemplate",
      "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate.git",
      "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate/tree/main/content",
    ];
    for (const form of forms) {
      const result = parseGithubRepoUrl(form);
      expect(result.ok, form).toBe(true);
      if (result.ok) {
        expect(result.ref.canonicalUrl).toBe(
          "https://github.com/AllenNeuralDynamics/ComputationalReviewTemplate",
        );
        expect(result.ref.owner).toBe("AllenNeuralDynamics");
        expect(result.ref.name).toBe("ComputationalReviewTemplate");
      }
    }
  });
});

describe("parseGithubRepoUrl — SSRF and unsafe URL rejection", () => {
  const unsafe: Array<[string, string]> = [
    ["non-GitHub host", "https://gitlab.com/owner/repo"],
    ["look-alike host", "https://github.com.evil.example/owner/repo"],
    ["credentials in URL", "https://user:pass@github.com/owner/repo"],
    ["@ in URL", "https://github.com/owner/repo@ref"],
    ["API endpoint", "https://api.github.com/repos/owner/repo"],
    ["raw content host", "https://raw.githubusercontent.com/owner/repo/main/x"],
    ["localhost", "http://localhost/owner/repo"],
    ["loopback IP", "http://127.0.0.1/owner/repo"],
    ["link-local metadata IP", "http://169.254.169.254/owner/repo"],
    ["private IP", "http://192.168.0.10/owner/repo"],
    ["non-standard port", "https://github.com:8080/owner/repo"],
    ["file scheme", "file:///etc/passwd"],
    ["javascript scheme", "javascript:alert(1)"],
    ["missing repo", "https://github.com/owner"],
    ["reserved path", "https://github.com/settings/profile"],
    ["empty", ""],
  ];

  for (const [label, url] of unsafe) {
    it(`rejects ${label}`, () => {
      const result = parseGithubRepoUrl(url);
      expect(result.ok, `${label} (${url})`).toBe(false);
    });
  }
});
