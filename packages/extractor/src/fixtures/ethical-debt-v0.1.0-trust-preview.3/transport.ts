import fixtureJson from "./fixture.json" with { type: "json" };
import { createCapturedFixtureTransport, type CapturedRepositoryFixture } from "@oratlas/github";

export const transport = createCapturedFixtureTransport(
  fixtureJson as CapturedRepositoryFixture,
);
