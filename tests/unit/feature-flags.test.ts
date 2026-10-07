import { it, expect } from "vitest";
import {
  FEATURES,
  DEFAULT_FEATURE_FLAGS,
  CLOSED_FEATURE_FLAGS,
  parseFeatureFlags,
  canOpenFeatureScreen,
} from "@/lib/feature-flags";
it("defaults keep optional features off, authoring on only for authorized staff", () => {
  expect(FEATURES).toHaveLength(11);
  expect(Object.values(DEFAULT_FEATURE_FLAGS).filter(Boolean)).toHaveLength(1);
  expect(canOpenFeatureScreen("editor", DEFAULT_FEATURE_FLAGS, false)).toBe(
    false,
  );
  expect(canOpenFeatureScreen("editor", DEFAULT_FEATURE_FLAGS, true)).toBe(
    true,
  );
});
it("missing, string booleans and unknown keys never enable a feature", () => {
  expect(parseFeatureFlags(null)).toEqual(CLOSED_FEATURE_FLAGS);
  expect(
    parseFeatureFlags({ multilingual: "true", gamification: 1, apiKey: true }),
  ).toEqual(CLOSED_FEATURE_FLAGS);
  expect(parseFeatureFlags({ multilingual: true })).toEqual({
    ...CLOSED_FEATURE_FLAGS,
    multilingual: true,
  });
});
it("optional screens are closed without flags; core flows remain available", () => {
  for (const s of [
    "achievements",
    "daily-challenges",
    "draw-story",
    "scan-book",
    "adventure",
    "vocab-quiz",
    "upload",
    "editor",
  ] as const)
    expect(canOpenFeatureScreen(s, CLOSED_FEATURE_FLAGS, true)).toBe(false);
  for (const s of [
    "home",
    "library",
    "create",
    "profiles",
    "player",
    "lullaby",
  ] as const)
    expect(canOpenFeatureScreen(s, CLOSED_FEATURE_FLAGS, false)).toBe(true);
});
