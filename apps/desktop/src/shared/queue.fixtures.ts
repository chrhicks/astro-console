import type { QueueItemDraft } from "./planning";

export interface QueueFixture {
  id: string;
  items: QueueItemDraft[];
}

export const QUEUE_FIXTURES: QueueFixture[] = [
  {
    id: "dark-site-fixed-duration",
    items: [
      {
        siteId: "fixture-dark-site",
        targetId: "messier:m51",
        targetName: "M51",
        targetRaHours: 13.497,
        targetDecDeg: 47.195,
        requestedFilter: "clear",
        desiredDurationMin: 45,
        stopWhenBelowAltitudeDeg: 28,
        stopWhenBackyardHidden: false,
        stopAtDawn: true,
        autofocusBeforeStart: true,
        restartStack: true,
      },
    ],
  },
  {
    id: "dark-site-dawn-stop",
    items: [
      {
        siteId: "fixture-dark-site",
        targetId: "messier:m13",
        targetName: "M13",
        targetRaHours: 16.6949,
        targetDecDeg: 36.4613,
        requestedFilter: "clear",
        desiredDurationMin: 120,
        notBeforeLocal: "22:30",
        stopWhenBelowAltitudeDeg: 30,
        stopWhenBackyardHidden: false,
        stopAtDawn: true,
        autofocusBeforeStart: false,
        restartStack: true,
      },
    ],
  },
  {
    id: "backyard-visibility-guard",
    items: [
      {
        siteId: "fixture-backyard",
        targetId: "messier:m42",
        targetName: "M42",
        targetRaHours: 5.5881,
        targetDecDeg: -5.3911,
        requestedFilter: "lp",
        desiredDurationMin: 60,
        stopWhenBelowAltitudeDeg: 28,
        stopWhenBackyardHidden: true,
        stopAtDawn: true,
        autofocusBeforeStart: true,
        restartStack: true,
      },
    ],
  },
];
