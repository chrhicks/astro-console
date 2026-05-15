import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createQueueItem,
  createEmptyPlanningState,
  PLANNING_SCHEMA_VERSION,
  type PersistedPlanningState,
  type PlanningSnapshot,
  type PlanningStorageInfo,
  type QueueItem,
  type QueueItemDraft,
  type SiteProfile,
  type SiteProfileDraft,
  validatePersistedPlanningState,
  validateSiteProfile,
  validateSiteProfileDraft,
} from "../shared/planning";
import {
  createManualCatalogTarget,
  mergeStarterCatalogTargets,
  searchCatalogTargets,
  validateStarterCatalogTargets,
  type CatalogSearchResult,
  type ManualCatalogTargetInput,
} from "../shared/starter-catalog";

const PLANNING_DIRNAME = "planning";
const PLANNING_FILENAME = "planning-state.json";

interface PlanningStoreOptions {
  getUserDataDir(): string;
}

export class PlanningStore {
  constructor(private options: PlanningStoreOptions) {}

  async getSnapshot(): Promise<PlanningSnapshot> {
    const storage = this.getStorageInfo();
    await mkdir(storage.rootDir, { recursive: true });
    const state = await this.loadState(storage.filePath);
    return { storage, state };
  }

  async saveState(state: PersistedPlanningState): Promise<PlanningSnapshot> {
    const storage = this.getStorageInfo();
    await mkdir(storage.rootDir, { recursive: true });

    const nextState: PersistedPlanningState = {
      ...state,
      metadata: {
        ...state.metadata,
        schemaVersion: PLANNING_SCHEMA_VERSION,
        updatedAt: new Date().toISOString(),
        createdAt: state.metadata.createdAt || new Date().toISOString(),
      },
    };

    const errors = validatePersistedPlanningState(nextState);
    if (errors.length > 0) {
      throw new Error(`Invalid planning state: ${errors.join("; ")}`);
    }

    await this.writeState(storage.filePath, nextState);
    return { storage, state: nextState };
  }

  async createSiteProfile(input: { site: SiteProfileDraft; makeActive?: boolean }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const nextSite: SiteProfile = {
        id: randomUUID(),
        ...cloneSiteDraft(input.site),
      };

      const errors = validateSiteProfile(nextSite);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      return {
        ...state,
        sites: [...state.sites, nextSite],
        activeSiteId: input.makeActive || !hasSelectableSite(state) ? nextSite.id : state.activeSiteId,
      };
    });
  }

  async updateSiteProfile(input: { siteId: string; site: SiteProfileDraft }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const currentSite = state.sites.find((site) => site.id === input.siteId);
      if (!currentSite) {
        throw new Error(`Unknown site ${input.siteId}`);
      }
      if (currentSite.archivedAt) {
        throw new Error("Archived sites cannot be edited until they are restored");
      }

      const nextSite: SiteProfile = {
        ...currentSite,
        ...cloneSiteDraft(input.site),
      };

      const errors = validateSiteProfile(nextSite);
      if (errors.length > 0) {
        throw new Error(errors.join("; "));
      }

      return {
        ...state,
        sites: state.sites.map((site) => (site.id === input.siteId ? nextSite : site)),
      };
    });
  }

  async duplicateSiteProfile(input: { siteId: string; makeActive?: boolean }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const sourceSite = state.sites.find((site) => site.id === input.siteId);
      if (!sourceSite) {
        throw new Error(`Unknown site ${input.siteId}`);
      }

      const nextSite: SiteProfile = {
        ...sourceSite,
        id: randomUUID(),
        name: createDuplicateSiteName(sourceSite.name, state.sites),
        archivedAt: undefined,
      };

      return {
        ...state,
        sites: [...state.sites, nextSite],
        activeSiteId: input.makeActive ? nextSite.id : state.activeSiteId,
      };
    });
  }

  async archiveSiteProfile(input: { siteId: string }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const currentSite = state.sites.find((site) => site.id === input.siteId);
      if (!currentSite) {
        throw new Error(`Unknown site ${input.siteId}`);
      }
      if (currentSite.archivedAt) {
        return state;
      }

      const archivedAt = new Date().toISOString();
      const sites = state.sites.map((site) =>
        site.id === input.siteId
          ? {
              ...site,
              archivedAt,
            }
          : site
      );

      return {
        ...state,
        sites,
        activeSiteId:
          state.activeSiteId === input.siteId ? pickFallbackActiveSiteId(sites, input.siteId) : state.activeSiteId,
      };
    });
  }

  async setActiveSite(input: { siteId: string }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const site = state.sites.find((candidate) => candidate.id === input.siteId && !candidate.archivedAt);
      if (!site) {
        throw new Error(`Unknown active site ${input.siteId}`);
      }

      return {
        ...state,
        activeSiteId: site.id,
      };
    });
  }

  async searchCatalog(input: { query: string; limit?: number }): Promise<CatalogSearchResult[]> {
    const snapshot = await this.getSnapshot();
    return searchCatalogTargets(snapshot.state.catalog, input.query, input.limit);
  }

  async addManualCatalogTarget(input: { target: ManualCatalogTargetInput }): Promise<PlanningSnapshot> {
    return this.updateState((state) => {
      const nextTarget = createManualCatalogTarget(input.target);
      const catalog = state.catalog.some((target) => target.id === nextTarget.id)
        ? state.catalog.map((target) => (target.id === nextTarget.id ? nextTarget : target))
        : [...state.catalog, nextTarget];

      return {
        ...state,
        catalog,
      };
    });
  }

  async replaceQueue(input: { items: QueueItem[] }): Promise<PlanningSnapshot> {
    return this.updateState((state) => ({
      ...state,
      queue: input.items.map((item) => cloneQueueItem(item)),
    }));
  }

  async createQueueFromDrafts(input: { items: QueueItemDraft[] }): Promise<PlanningSnapshot> {
    return this.replaceQueue({
      items: input.items.map((item) => createQueueItem(randomUUID(), item)),
    });
  }

  getStorageInfo(): PlanningStorageInfo {
    const rootDir = path.join(this.options.getUserDataDir(), PLANNING_DIRNAME);
    return {
      rootDir,
      filePath: path.join(rootDir, PLANNING_FILENAME),
      schemaVersion: PLANNING_SCHEMA_VERSION,
    };
  }

  private async loadState(filePath: string): Promise<PersistedPlanningState> {
    try {
      const raw = await readFile(filePath, "utf8");
      const state = this.parseState(filePath, JSON.parse(raw) as unknown);
      return this.ensureBundledCatalog(filePath, state);
    } catch (error) {
      if (isMissingFileError(error)) {
        const emptyState = await this.ensureBundledCatalog(filePath, createEmptyPlanningState());
        await this.writeState(filePath, emptyState);
        return emptyState;
      }
      throw error;
    }
  }

  private parseState(filePath: string, input: unknown): PersistedPlanningState {
    const parsed = asRecord(input);
    const metadata = asRecord(parsed?.metadata);
    const schemaVersion = metadata?.schemaVersion;

    // Future migrations stay in main so renderer code only sees stable shapes.
    if (schemaVersion !== PLANNING_SCHEMA_VERSION) {
      throw new Error(
        `Unsupported planning schema version ${String(schemaVersion)} in ${filePath}. Expected ${PLANNING_SCHEMA_VERSION}.`
      );
    }

    const state = input as PersistedPlanningState;
    const errors = validatePersistedPlanningState(state);
    if (errors.length > 0) {
      throw new Error(`Invalid planning state in ${filePath}: ${errors.join("; ")}`);
    }

    return state;
  }

  private async writeState(filePath: string, state: PersistedPlanningState): Promise<void> {
    await writeFile(filePath, JSON.stringify(state, null, 2) + "\n", "utf8");
  }

  private async updateState(
    transform: (state: PersistedPlanningState) => PersistedPlanningState
  ): Promise<PlanningSnapshot> {
    const storage = this.getStorageInfo();
    await mkdir(storage.rootDir, { recursive: true });
    const currentState = await this.loadState(storage.filePath);
    const nextState = transform(clonePlanningState(currentState));
    return this.saveState(nextState);
  }

  private async ensureBundledCatalog(filePath: string, state: PersistedPlanningState): Promise<PersistedPlanningState> {
    const starterErrors = validateStarterCatalogTargets();
    if (starterErrors.length > 0) {
      throw new Error(`Invalid bundled starter catalog: ${starterErrors.join("; ")}`);
    }

    const mergedCatalog = mergeStarterCatalogTargets(state.catalog);
    if (JSON.stringify(mergedCatalog) === JSON.stringify(state.catalog)) {
      return state;
    }

    const nextState: PersistedPlanningState = {
      ...state,
      catalog: mergedCatalog,
      metadata: {
        ...state.metadata,
        updatedAt: new Date().toISOString(),
      },
    };

    const errors = validatePersistedPlanningState(nextState);
    if (errors.length > 0) {
      throw new Error(`Invalid planning state in ${filePath}: ${errors.join("; ")}`);
    }

    await this.writeState(filePath, nextState);
    return nextState;
  }
}

function isMissingFileError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isRecord(value: unknown): value is NodeJS.ErrnoException {
  return value !== null && typeof value === "object";
}

function clonePlanningState(state: PersistedPlanningState): PersistedPlanningState {
  return JSON.parse(JSON.stringify(state)) as PersistedPlanningState;
}

function cloneSiteDraft(site: SiteProfileDraft): SiteProfileDraft {
  return {
    ...site,
    blockedAzimuthRanges: site.blockedAzimuthRanges.map((range) => ({ ...range })),
  };
}

function cloneQueueItem(item: QueueItem): QueueItem {
  return { ...item };
}

function hasSelectableSite(state: PersistedPlanningState): boolean {
  return state.sites.some((site) => !site.archivedAt);
}

function pickFallbackActiveSiteId(sites: SiteProfile[], archivedSiteId: string): string | undefined {
  return sites.find((site) => site.id !== archivedSiteId && !site.archivedAt)?.id;
}

function createDuplicateSiteName(name: string, sites: SiteProfile[]): string {
  const trimmedName = name.trim() || "Site";
  let index = 2;
  let candidate = `${trimmedName} copy`;
  const existingNames = new Set(sites.map((site) => site.name.toLowerCase()));

  while (existingNames.has(candidate.toLowerCase())) {
    candidate = `${trimmedName} copy ${index}`;
    index += 1;
  }

  return candidate;
}
