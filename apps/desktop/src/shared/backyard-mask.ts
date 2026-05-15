import type { SiteAzimuthRange, SiteProfile } from "./planning";

export interface TargetPathSample {
  at: string;
  altitudeDeg: number;
  azimuthDeg: number;
}

export interface BackyardMaskResult {
  skyVisibleSampleCount: number;
  usableSampleCount: number;
  blockedSampleCount: number;
  blockedLabels: string[];
  backyardVisible: boolean;
  usableWindowStartAt?: string;
  usableWindowEndAt?: string;
}

export function evaluateBackyardMask(site: SiteProfile, samples: TargetPathSample[]): BackyardMaskResult {
  const skyVisibleSamples = samples.filter((sample) => sample.altitudeDeg >= site.minAltitudeDeg);
  const usableSamples = skyVisibleSamples.filter((sample) => !isAzimuthBlocked(site.blockedAzimuthRanges, sample.azimuthDeg));
  const blockedSamples = skyVisibleSamples.filter((sample) => isAzimuthBlocked(site.blockedAzimuthRanges, sample.azimuthDeg));
  const blockedLabels = new Set<string>();

  for (const sample of blockedSamples) {
    for (const range of site.blockedAzimuthRanges) {
      if (matchesAzimuthRange(sample.azimuthDeg, range) && range.label) {
        blockedLabels.add(range.label);
      }
    }
  }

  return {
    skyVisibleSampleCount: skyVisibleSamples.length,
    usableSampleCount: usableSamples.length,
    blockedSampleCount: blockedSamples.length,
    blockedLabels: [...blockedLabels],
    backyardVisible: usableSamples.length > 0,
    usableWindowStartAt: usableSamples[0]?.at,
    usableWindowEndAt: usableSamples.at(-1)?.at,
  };
}

export function isAzimuthBlocked(ranges: SiteAzimuthRange[], azimuthDeg: number): boolean {
  return ranges.some((range) => matchesAzimuthRange(azimuthDeg, range));
}

export function matchesAzimuthRange(azimuthDeg: number, range: SiteAzimuthRange): boolean {
  const normalizedAzimuth = normalizeAzimuth(azimuthDeg);
  const start = normalizeAzimuth(range.startDeg);
  const end = normalizeAzimuth(range.endDeg);

  if (start <= end) {
    return normalizedAzimuth >= start && normalizedAzimuth <= end;
  }

  return normalizedAzimuth >= start || normalizedAzimuth <= end;
}

function normalizeAzimuth(value: number): number {
  const normalized = value % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}
