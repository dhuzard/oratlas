import { describe, expect, it } from "vitest";
import { getServerEnv, parseAdminGithubUserIds } from "./index";

describe("ADMIN_GITHUB_USER_IDS", () => {
  it("parses and deduplicates immutable numeric GitHub IDs", () => {
    expect(parseAdminGithubUserIds("48721374: 42:48721374")).toEqual(["48721374", "42"]);
  });

  it.each(["dhuzard", "0", "-1", "1.5", "9007199254740992"])(
    "rejects an unsafe administrator identity value: %s",
    (value) => {
      expect(() => parseAdminGithubUserIds(value)).toThrow(/positive GitHub numeric user IDs/);
    },
  );

  it("exposes the parsed allowlist in server configuration", () => {
    const env = getServerEnv({
      NODE_ENV: "test",
      ADMIN_GITHUB_USER_IDS: "48721374:123",
    });

    expect(env.adminGithubUserIds).toEqual(["48721374", "123"]);
  });
});
