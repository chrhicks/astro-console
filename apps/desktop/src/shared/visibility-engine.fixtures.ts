import type { RankedTarget, SiteProfile } from "./planning";

export interface VisibilityFixture {
  id: string;
  site: SiteProfile;
  now: string;
  targetIds: string[];
  expectedRecommendations: Array<{
    targetId: string;
    recommendation: RankedTarget["recommendation"];
  }>;
  expectedMask?: Array<{
    targetId: string;
    backyardVisible: boolean;
    minSkyVisibleMinutes?: number;
    maxVisibleMinutes?: number;
  }>;
}

export const VISIBILITY_ENGINE_FIXTURES: VisibilityFixture[] = [
  {
    id: "summer-pennsylvania-midnight",
    site: {
      id: "fixture-dark-site",
      name: "Fixture Dark Site",
      lat: 41.6625,
      lon: -77.8231,
      timezone: "America/New_York",
      minAltitudeDeg: 25,
      blockedAzimuthRanges: [],
    },
    now: "2026-07-15T04:00:00.000Z",
    targetIds: ["messier:m13", "ngc:7000", "messier:m42"],
    expectedRecommendations: [
      { targetId: "messier:m13", recommendation: "good_now" },
      { targetId: "ngc:7000", recommendation: "good_now" },
      { targetId: "messier:m42", recommendation: "not_tonight" },
    ],
  },
  {
    id: "winter-california-evening",
    site: {
      id: "fixture-backyard",
      name: "Fixture Backyard",
      lat: 37.7749,
      lon: -122.4944,
      timezone: "America/Los_Angeles",
      minAltitudeDeg: 25,
      blockedAzimuthRanges: [],
    },
    now: "2026-01-16T05:00:00.000Z",
    targetIds: ["messier:m42", "messier:m45", "messier:m13"],
    expectedRecommendations: [
      { targetId: "messier:m42", recommendation: "good_now" },
      { targetId: "messier:m45", recommendation: "good_now" },
      { targetId: "messier:m13", recommendation: "later_tonight" },
    ],
  },
  {
    id: "winter-california-southern-roof-mask",
    site: {
      id: "fixture-masked-backyard",
      name: "Fixture Masked Backyard",
      lat: 37.7749,
      lon: -122.4944,
      timezone: "America/Los_Angeles",
      minAltitudeDeg: 25,
      blockedAzimuthRanges: [{ startDeg: 90, endDeg: 270, label: "House" }],
    },
    now: "2026-01-16T05:00:00.000Z",
    targetIds: ["messier:m42"],
    expectedRecommendations: [{ targetId: "messier:m42", recommendation: "not_tonight" }],
    expectedMask: [
      {
        targetId: "messier:m42",
        backyardVisible: false,
        minSkyVisibleMinutes: 180,
        maxVisibleMinutes: 0,
      },
    ],
  },
];
