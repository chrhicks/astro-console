export const PLANNING_SCHEMA_VERSION = 1;

export interface SiteAzimuthRange {
  startDeg: number;
  endDeg: number;
  label?: string;
}

export interface SiteProfile {
  id: string;
  name: string;
  lat: number;
  lon: number;
  timezone: string;
  minAltitudeDeg: number;
  blockedAzimuthRanges: SiteAzimuthRange[];
  archivedAt?: string;
}

export type SiteProfileDraft = Omit<SiteProfile, "id" | "archivedAt">;

export interface CatalogTarget {
  id: string;
  primaryName: string;
  aliases: string[];
  objectType: string;
  constellation?: string;
  raHours: number;
  decDeg: number;
  magnitude?: number;
  recommendedFilter?: "clear" | "ir" | "lp";
  tags?: string[];
  source: "starter" | "manual";
}

export interface RankedTarget {
  targetId: string;
  siteId: string;
  score: number;
  evaluatedAt: string;
  visibleMinutes: number;
  bestAltitudeDeg?: number;
  windowStartAt?: string;
  windowEndAt?: string;
  backyardVisible: boolean;
  positiveReasons: string[];
  rejectionReasons: string[];
}

export interface QueueItem {
  id: string;
  targetId: string;
  desiredDurationMin: number;
  stopWhenBelowAltitudeDeg?: number;
  stopWhenBackyardHidden: boolean;
  stopAtDawn: boolean;
}

export interface PlanningStorageMetadata {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedPlanningState {
  metadata: PlanningStorageMetadata;
  activeSiteId?: string;
  sites: SiteProfile[];
  catalog: CatalogTarget[];
  rankedTargets: RankedTarget[];
  queue: QueueItem[];
}

export interface PlanningStorageInfo {
  rootDir: string;
  filePath: string;
  schemaVersion: number;
}

export interface PlanningSnapshot {
  storage: PlanningStorageInfo;
  state: PersistedPlanningState;
}

export function createEmptyPlanningState(now = new Date().toISOString()): PersistedPlanningState {
  return {
    metadata: {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      createdAt: now,
      updatedAt: now,
    },
    activeSiteId: undefined,
    sites: [],
    catalog: [],
    rankedTargets: [],
    queue: [],
  };
}

export function validatePersistedPlanningState(state: PersistedPlanningState): string[] {
  const errors: string[] = [];
  const siteIds = new Set<string>();

  if (state.metadata.schemaVersion !== PLANNING_SCHEMA_VERSION) {
    errors.push(
      `metadata.schemaVersion must be ${PLANNING_SCHEMA_VERSION}, received ${String(state.metadata.schemaVersion)}`
    );
  }
  if (!isNonEmptyString(state.metadata.createdAt)) {
    errors.push("metadata.createdAt is required");
  }
  if (!isNonEmptyString(state.metadata.updatedAt)) {
    errors.push("metadata.updatedAt is required");
  }
  if (state.activeSiteId !== undefined && !isNonEmptyString(state.activeSiteId)) {
    errors.push("activeSiteId must be a non-empty string when provided");
  }
  if (state.activeSiteId && !state.sites.some((site) => site.id === state.activeSiteId && !site.archivedAt)) {
    errors.push(`activeSiteId ${state.activeSiteId} does not match a non-archived site`);
  }

  for (const site of state.sites) {
    if (siteIds.has(site.id)) {
      errors.push(`duplicate site id ${site.id}`);
    }
    siteIds.add(site.id);
    errors.push(...validateSiteProfile(site));
  }
  errors.push(...validateCatalogTargets(state.catalog));
  for (const rankedTarget of state.rankedTargets) {
    errors.push(...validateRankedTarget(rankedTarget));
  }
  for (const queueItem of state.queue) {
    errors.push(...validateQueueItem(queueItem));
  }

  return errors;
}

export function validateSiteProfile(site: SiteProfile): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(site.id)) {
    errors.push("site.id is required");
  }
  if (site.archivedAt !== undefined && !isNonEmptyString(site.archivedAt)) {
    errors.push(`site ${String(site.id)} archivedAt must be non-empty when provided`);
  }
  errors.push(...validateSiteProfileDraft(site, String(site.id) || "site"));

  return errors;
}

export function validateSiteProfileDraft(site: SiteProfileDraft, label = "site draft"): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(site.name)) {
    errors.push(`${label} name is required`);
  }
  if (!isFiniteNumber(site.lat) || site.lat < -90 || site.lat > 90) {
    errors.push(`${label} lat must be between -90 and 90`);
  }
  if (!isFiniteNumber(site.lon) || site.lon < -180 || site.lon > 180) {
    errors.push(`${label} lon must be between -180 and 180`);
  }
  if (!isNonEmptyString(site.timezone)) {
    errors.push(`${label} timezone is required`);
  } else if (!isValidTimeZone(site.timezone)) {
    errors.push(`${label} timezone must be a valid IANA timezone`);
  }
  if (!isFiniteNumber(site.minAltitudeDeg) || site.minAltitudeDeg < 0 || site.minAltitudeDeg > 90) {
    errors.push(`${label} minAltitudeDeg must be between 0 and 90`);
  }
  if (!Array.isArray(site.blockedAzimuthRanges)) {
    errors.push(`${label} blockedAzimuthRanges must be an array`);
    return errors;
  }

  for (const range of site.blockedAzimuthRanges) {
    if (!isFiniteNumber(range.startDeg) || range.startDeg < 0 || range.startDeg > 360) {
      errors.push(`${label} blocked azimuth start must be between 0 and 360`);
    }
    if (!isFiniteNumber(range.endDeg) || range.endDeg < 0 || range.endDeg > 360) {
      errors.push(`${label} blocked azimuth end must be between 0 and 360`);
    }
    if (range.label !== undefined && !isNonEmptyString(range.label)) {
      errors.push(`${label} blocked azimuth label must be non-empty when provided`);
    }
  }

  return errors;
}

export function validateCatalogTarget(target: CatalogTarget): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(target.id)) {
    errors.push("catalog target id is required");
  }
  if (!isNonEmptyString(target.primaryName)) {
    errors.push(`catalog target ${String(target.id)} primaryName is required`);
  }
  if (!Array.isArray(target.aliases) || target.aliases.some((alias) => !isNonEmptyString(alias))) {
    errors.push(`catalog target ${String(target.id)} aliases must be an array of non-empty strings`);
  }
  if (!isNonEmptyString(target.objectType)) {
    errors.push(`catalog target ${String(target.id)} objectType is required`);
  }
  if (target.constellation !== undefined && !isNonEmptyString(target.constellation)) {
    errors.push(`catalog target ${String(target.id)} constellation must be non-empty when provided`);
  }
  if (!isFiniteNumber(target.raHours) || target.raHours < 0 || target.raHours >= 24) {
    errors.push(`catalog target ${String(target.id)} raHours must be between 0 and 24`);
  }
  if (!isFiniteNumber(target.decDeg) || target.decDeg < -90 || target.decDeg > 90) {
    errors.push(`catalog target ${String(target.id)} decDeg must be between -90 and 90`);
  }
  if (target.magnitude !== undefined && !isFiniteNumber(target.magnitude)) {
    errors.push(`catalog target ${String(target.id)} magnitude must be finite when provided`);
  }
  if (
    target.recommendedFilter !== undefined &&
    target.recommendedFilter !== "clear" &&
    target.recommendedFilter !== "ir" &&
    target.recommendedFilter !== "lp"
  ) {
    errors.push(`catalog target ${String(target.id)} recommendedFilter must be clear, ir, or lp when provided`);
  }
  if (target.tags !== undefined && (!Array.isArray(target.tags) || target.tags.some((tag) => !isNonEmptyString(tag)))) {
    errors.push(`catalog target ${String(target.id)} tags must be an array of non-empty strings when provided`);
  }
  if (target.source !== "starter" && target.source !== "manual") {
    errors.push(`catalog target ${String(target.id)} source must be starter or manual`);
  }

  return errors;
}

export function validateCatalogTargets(targets: CatalogTarget[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const lookupOwners = new Map<string, string>();

  for (const target of targets) {
    errors.push(...validateCatalogTarget(target));

    if (ids.has(target.id)) {
      errors.push(`duplicate catalog target id ${target.id}`);
    }
    ids.add(target.id);

    for (const key of createCatalogLookupKeys(target)) {
      const currentOwner = lookupOwners.get(key);
      if (currentOwner && currentOwner !== target.id) {
        errors.push(`catalog lookup key ${key} is shared by ${currentOwner} and ${target.id}`);
        continue;
      }
      lookupOwners.set(key, target.id);
    }
  }

  return errors;
}

export function validateRankedTarget(target: RankedTarget): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(target.targetId)) {
    errors.push("ranked target targetId is required");
  }
  if (!isNonEmptyString(target.siteId)) {
    errors.push(`ranked target ${String(target.targetId)} siteId is required`);
  }
  if (!isFiniteNumber(target.score)) {
    errors.push(`ranked target ${String(target.targetId)} score must be finite`);
  }
  if (!isNonEmptyString(target.evaluatedAt)) {
    errors.push(`ranked target ${String(target.targetId)} evaluatedAt is required`);
  }
  if (!isFiniteNumber(target.visibleMinutes) || target.visibleMinutes < 0) {
    errors.push(`ranked target ${String(target.targetId)} visibleMinutes must be 0 or greater`);
  }
  if (target.bestAltitudeDeg !== undefined && (!isFiniteNumber(target.bestAltitudeDeg) || target.bestAltitudeDeg < 0 || target.bestAltitudeDeg > 90)) {
    errors.push(`ranked target ${String(target.targetId)} bestAltitudeDeg must be between 0 and 90 when provided`);
  }
  if (target.windowStartAt !== undefined && !isNonEmptyString(target.windowStartAt)) {
    errors.push(`ranked target ${String(target.targetId)} windowStartAt must be non-empty when provided`);
  }
  if (target.windowEndAt !== undefined && !isNonEmptyString(target.windowEndAt)) {
    errors.push(`ranked target ${String(target.targetId)} windowEndAt must be non-empty when provided`);
  }
  if (!Array.isArray(target.positiveReasons) || target.positiveReasons.some((reason) => !isNonEmptyString(reason))) {
    errors.push(`ranked target ${String(target.targetId)} positiveReasons must be an array of non-empty strings`);
  }
  if (!Array.isArray(target.rejectionReasons) || target.rejectionReasons.some((reason) => !isNonEmptyString(reason))) {
    errors.push(`ranked target ${String(target.targetId)} rejectionReasons must be an array of non-empty strings`);
  }

  return errors;
}

export function validateQueueItem(item: QueueItem): string[] {
  const errors: string[] = [];

  if (!isNonEmptyString(item.id)) {
    errors.push("queue item id is required");
  }
  if (!isNonEmptyString(item.targetId)) {
    errors.push(`queue item ${String(item.id)} targetId is required`);
  }
  if (!isFiniteNumber(item.desiredDurationMin) || item.desiredDurationMin <= 0) {
    errors.push(`queue item ${String(item.id)} desiredDurationMin must be greater than 0`);
  }
  if (
    item.stopWhenBelowAltitudeDeg !== undefined &&
    (!isFiniteNumber(item.stopWhenBelowAltitudeDeg) || item.stopWhenBelowAltitudeDeg < 0 || item.stopWhenBelowAltitudeDeg > 90)
  ) {
    errors.push(`queue item ${String(item.id)} stopWhenBelowAltitudeDeg must be between 0 and 90 when provided`);
  }

  return errors;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function createCatalogLookupKeys(target: CatalogTarget): string[] {
  return [target.id, target.primaryName, ...target.aliases]
    .map(normalizeCatalogLookupKey)
    .filter((value): value is string => Boolean(value));
}

function normalizeCatalogLookupKey(value: string): string | undefined {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return normalized.length > 0 ? normalized : undefined;
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
