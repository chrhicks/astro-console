import path from "node:path";
import { type VisibilityWindow, rankTargetsForTonight } from "../shared/visibility-engine";
import { type CatalogTarget, type PlanningSnapshot, type RankedTarget, type SiteProfile, validateSiteProfile } from "../shared/planning";
import { evaluateSiteDiagnostics, type SiteDiagnostic } from "../shared/site-diagnostics";
import { searchCatalogTargets, type CatalogSearchResult } from "../shared/starter-catalog";
import { PlanningStore } from "./planning-store";

export type ActiveSiteSource = "requested" | "state" | "fallback";

export interface PlanningActiveSiteResolution {
  site: SiteProfile;
  source: ActiveSiteSource;
}

interface ResolveActiveSiteOptions {
  activeSiteId?: string;
  allowFirstSiteFallback?: boolean;
}

interface PlanningContextDeps {
  getPlanningSnapshot(): Promise<PlanningSnapshot>;
}

export interface PlanningContextStorageOptions {
  planningRootDir: string;
}

export type PlanningSiteOverride = Partial<
  Pick<SiteProfile, "name" | "lat" | "lon" | "timezone" | "minAltitudeDeg" | "blockedAzimuthRanges">
>;

export interface PlanningContextInput {
  activeSiteId?: string;
  allowFirstSiteFallback?: boolean;
  now?: Date | string;
  window?: Partial<VisibilityWindow>;
  siteOverride?: PlanningSiteOverride;
}

export interface PlanningContext {
  snapshot: PlanningSnapshot;
  activeSite: SiteProfile;
  activeSiteSource: ActiveSiteSource;
  siteDiagnostics: SiteDiagnostic[];
  rankedTargets: RankedTarget[];
}

export interface PlanningTargetCandidate {
  target: CatalogTarget;
  ranking: RankedTarget;
  matchKind?: CatalogSearchResult["matchKind"];
}

export interface PlanningTargetSelectionInput extends PlanningContextInput {
  recommendation?: RankedTarget["recommendation"] | "any";
  targetId?: string;
  query?: string;
  limit?: number;
}

export interface PlanningTargetSelection {
  context: PlanningContext;
  candidates: PlanningTargetCandidate[];
  selected?: PlanningTargetCandidate;
}

export class PlanningContextService {
  constructor(private deps: PlanningContextDeps) {}

  async getSnapshot(): Promise<PlanningSnapshot> {
    return this.deps.getPlanningSnapshot();
  }

  async getActiveSite(input: { activeSiteId?: string } = {}): Promise<SiteProfile | undefined> {
    const snapshot = await this.deps.getPlanningSnapshot();
    const resolved = resolvePlanningActiveSite(snapshot, {
      activeSiteId: input.activeSiteId,
      allowFirstSiteFallback: false,
    });
    return resolved ? cloneSiteProfile(resolved.site) : undefined;
  }

  async resolveContext(input: PlanningContextInput = {}): Promise<PlanningContext> {
    const snapshot = await this.deps.getPlanningSnapshot();
    const resolved = resolvePlanningActiveSite(snapshot, {
      activeSiteId: input.activeSiteId,
      allowFirstSiteFallback: input.allowFirstSiteFallback ?? false,
    });

    if (!resolved) {
      throw new Error(createMissingActiveSiteMessage(snapshot, input.activeSiteId));
    }

    const activeSite = applySiteOverride(resolved.site, input.siteOverride);
    const now = parseNow(input.now);
    const rankedTargets = rankTargetsForTonight({
      site: activeSite,
      targets: snapshot.state.catalog,
      now,
      window: input.window,
    });

    return {
      snapshot,
      activeSite,
      activeSiteSource: resolved.source,
      siteDiagnostics: evaluateSiteDiagnostics(activeSite),
      rankedTargets,
    };
  }

  async selectTarget(input: PlanningTargetSelectionInput = {}): Promise<PlanningTargetSelection> {
    const context = await this.resolveContext(input);
    const recommendation = input.recommendation ?? "good_now";
    const candidatesByScore = toRankedCandidates(context.snapshot.state.catalog, context.rankedTargets);
    let candidates =
      recommendation === "any"
        ? candidatesByScore
        : candidatesByScore.filter((candidate) => candidate.ranking.recommendation === recommendation);

    if (input.targetId) {
      candidates = candidates.filter((candidate) => candidate.target.id === input.targetId);
    }

    const query = input.query?.trim();
    if (query) {
      const searchResults = searchCatalogTargets(context.snapshot.state.catalog, query, context.snapshot.state.catalog.length);
      const byTargetId = new Map(candidates.map((candidate) => [candidate.target.id, candidate]));
      const orderedMatches: PlanningTargetCandidate[] = [];

      for (const result of searchResults) {
        const candidate = byTargetId.get(result.target.id);
        if (!candidate) continue;
        orderedMatches.push({
          ...candidate,
          matchKind: result.matchKind,
        });
      }

      candidates = orderedMatches;
    }

    const limit = clampSelectionLimit(input.limit);
    const sliced = candidates.slice(0, limit);
    return {
      context,
      candidates: sliced,
      selected: sliced[0],
    };
  }
}

export function createPlanningContextServiceFromStorage(input: PlanningContextStorageOptions): PlanningContextService {
  const store = new PlanningStore({
    getPlanningRootDir: () => input.planningRootDir,
  });
  return new PlanningContextService({
    getPlanningSnapshot: () => store.getSnapshot(),
  });
}

export function createPlanningContextServiceFromStateFile(filePath: string): PlanningContextService {
  return createPlanningContextServiceFromStorage({
    planningRootDir: path.dirname(filePath),
  });
}

export function resolvePlanningActiveSite(
  snapshot: PlanningSnapshot,
  options: ResolveActiveSiteOptions
): PlanningActiveSiteResolution | undefined {
  const availableSites = snapshot.state.sites.filter((site) => !site.archivedAt);
  const requestedSiteId = options.activeSiteId?.trim();
  if (requestedSiteId) {
    const requestedSite = availableSites.find((site) => site.id === requestedSiteId);
    return requestedSite ? { site: requestedSite, source: "requested" } : undefined;
  }

  const stateActiveSiteId = snapshot.state.activeSiteId;
  if (stateActiveSiteId) {
    const stateSite = availableSites.find((site) => site.id === stateActiveSiteId);
    if (stateSite) {
      return { site: stateSite, source: "state" };
    }
  }

  if (options.allowFirstSiteFallback && availableSites.length > 0) {
    return {
      site: availableSites[0],
      source: "fallback",
    };
  }

  return undefined;
}

function createMissingActiveSiteMessage(snapshot: PlanningSnapshot, requestedSiteId: string | undefined): string {
  const availableSites = snapshot.state.sites.filter((site) => !site.archivedAt);
  if (requestedSiteId?.trim()) {
    return `Requested active site ${requestedSiteId.trim()} is not available`;
  }
  if (snapshot.state.activeSiteId) {
    return `Planning state active site ${snapshot.state.activeSiteId} is not available`;
  }
  if (availableSites.length === 0) {
    return "No non-archived site profiles available in planning state";
  }

  const siteNames = availableSites.slice(0, 5).map((site) => site.name).join(", ");
  return `No active site selected. Available sites: ${siteNames}`;
}

function applySiteOverride(site: SiteProfile, override: PlanningSiteOverride | undefined): SiteProfile {
  if (!override) {
    return cloneSiteProfile(site);
  }

  const nextSite = cloneSiteProfile(site);
  if (override.name !== undefined) {
    nextSite.name = override.name;
  }
  if (override.lat !== undefined) {
    nextSite.lat = override.lat;
  }
  if (override.lon !== undefined) {
    nextSite.lon = override.lon;
  }
  if (override.timezone !== undefined) {
    nextSite.timezone = override.timezone;
  }
  if (override.minAltitudeDeg !== undefined) {
    nextSite.minAltitudeDeg = override.minAltitudeDeg;
  }
  if (override.blockedAzimuthRanges !== undefined) {
    nextSite.blockedAzimuthRanges = override.blockedAzimuthRanges.map((range) => ({ ...range }));
  }

  const errors = validateSiteProfile(nextSite);
  if (errors.length > 0) {
    throw new Error(`Invalid site override: ${errors.join("; ")}`);
  }

  return nextSite;
}

function parseNow(now: Date | string | undefined): Date | undefined {
  if (now === undefined) {
    return undefined;
  }
  const parsed = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid planning timestamp ${String(now)}`);
  }
  return parsed;
}

function toRankedCandidates(catalog: CatalogTarget[], rankings: RankedTarget[]): PlanningTargetCandidate[] {
  const catalogById = new Map(catalog.map((target) => [target.id, target]));
  const candidates: PlanningTargetCandidate[] = [];

  for (const ranking of rankings) {
    const target = catalogById.get(ranking.targetId);
    if (!target) {
      continue;
    }
    candidates.push({
      target: cloneCatalogTarget(target),
      ranking: cloneRankedTarget(ranking),
    });
  }

  return candidates;
}

function cloneSiteProfile(site: SiteProfile): SiteProfile {
  return {
    ...site,
    blockedAzimuthRanges: site.blockedAzimuthRanges.map((range) => ({ ...range })),
  };
}

function cloneCatalogTarget(target: CatalogTarget): CatalogTarget {
  return {
    ...target,
    aliases: [...target.aliases],
    tags: target.tags ? [...target.tags] : undefined,
  };
}

function cloneRankedTarget(target: RankedTarget): RankedTarget {
  return {
    ...target,
    positiveReasons: [...target.positiveReasons],
    rejectionReasons: [...target.rejectionReasons],
  };
}

function clampSelectionLimit(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 10;
  }
  return Math.max(1, Math.min(50, Math.trunc(value)));
}
