import type { CatalogTarget } from "./planning";
import { validateCatalogTargets } from "./planning";

export interface CatalogSearchResult {
  target: CatalogTarget;
  matchKind: "id" | "primaryName" | "alias" | "text";
}

export interface ManualCatalogTargetInput {
  primaryName: string;
  raHours: number;
  decDeg: number;
  aliases?: string[];
  objectType?: string;
  constellation?: string;
  magnitude?: number;
  recommendedFilter?: CatalogTarget["recommendedFilter"];
  tags?: string[];
}

export const STARTER_CATALOG_TARGETS: CatalogTarget[] = [
  {
    id: "messier:m31",
    primaryName: "M31",
    aliases: ["NGC 224", "Andromeda Galaxy"],
    objectType: "galaxy",
    constellation: "And",
    raHours: 0.712,
    decDeg: 41.269,
    magnitude: 3.4,
    recommendedFilter: "clear",
    tags: ["bright", "autumn", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m33",
    primaryName: "M33",
    aliases: ["NGC 598", "Triangulum Galaxy"],
    objectType: "galaxy",
    constellation: "Tri",
    raHours: 1.564,
    decDeg: 30.66,
    magnitude: 5.7,
    recommendedFilter: "clear",
    tags: ["autumn", "galaxy", "widefield"],
    source: "starter",
  },
  {
    id: "messier:m42",
    primaryName: "M42",
    aliases: ["NGC 1976", "Orion Nebula"],
    objectType: "emission_nebula",
    constellation: "Ori",
    raHours: 5.5881,
    decDeg: -5.3911,
    magnitude: 4,
    recommendedFilter: "lp",
    tags: ["bright", "winter", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m45",
    primaryName: "M45",
    aliases: ["Pleiades", "Seven Sisters"],
    objectType: "open_cluster",
    constellation: "Tau",
    raHours: 3.79,
    decDeg: 24.1167,
    magnitude: 1.6,
    recommendedFilter: "clear",
    tags: ["bright", "winter", "cluster", "widefield"],
    source: "starter",
  },
  {
    id: "messier:m1",
    primaryName: "M1",
    aliases: ["NGC 1952", "Crab Nebula"],
    objectType: "supernova_remnant",
    constellation: "Tau",
    raHours: 5.5756,
    decDeg: 22.0145,
    magnitude: 8.4,
    recommendedFilter: "lp",
    tags: ["winter", "nebula", "compact"],
    source: "starter",
  },
  {
    id: "messier:m44",
    primaryName: "M44",
    aliases: ["Praesepe", "Beehive Cluster"],
    objectType: "open_cluster",
    constellation: "Cnc",
    raHours: 8.6667,
    decDeg: 19.6667,
    magnitude: 3.7,
    recommendedFilter: "clear",
    tags: ["spring", "cluster", "widefield"],
    source: "starter",
  },
  {
    id: "messier:m51",
    primaryName: "M51",
    aliases: ["NGC 5194", "Whirlpool Galaxy"],
    objectType: "galaxy",
    constellation: "CVn",
    raHours: 13.497,
    decDeg: 47.195,
    magnitude: 8.4,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m63",
    primaryName: "M63",
    aliases: ["NGC 5055", "Sunflower Galaxy"],
    objectType: "galaxy",
    constellation: "CVn",
    raHours: 13.2637,
    decDeg: 42.0293,
    magnitude: 8.6,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m64",
    primaryName: "M64",
    aliases: ["NGC 4826", "Black Eye Galaxy"],
    objectType: "galaxy",
    constellation: "Com",
    raHours: 12.9454,
    decDeg: 21.6827,
    magnitude: 8.5,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m81",
    primaryName: "M81",
    aliases: ["NGC 3031", "Bode's Galaxy", "Bodes Galaxy"],
    objectType: "galaxy",
    constellation: "UMa",
    raHours: 9.925,
    decDeg: 69.0653,
    magnitude: 6.9,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m82",
    primaryName: "M82",
    aliases: ["NGC 3034", "Cigar Galaxy"],
    objectType: "galaxy",
    constellation: "UMa",
    raHours: 9.9342,
    decDeg: 69.6797,
    magnitude: 8.4,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy"],
    source: "starter",
  },
  {
    id: "messier:m13",
    primaryName: "M13",
    aliases: ["NGC 6205", "Great Hercules Cluster"],
    objectType: "globular_cluster",
    constellation: "Her",
    raHours: 16.6949,
    decDeg: 36.4613,
    magnitude: 5.8,
    recommendedFilter: "clear",
    tags: ["summer", "cluster"],
    source: "starter",
  },
  {
    id: "messier:m27",
    primaryName: "M27",
    aliases: ["NGC 6853", "Dumbbell Nebula"],
    objectType: "planetary_nebula",
    constellation: "Vul",
    raHours: 19.9935,
    decDeg: 22.7212,
    magnitude: 7.5,
    recommendedFilter: "lp",
    tags: ["summer", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m57",
    primaryName: "M57",
    aliases: ["NGC 6720", "Ring Nebula"],
    objectType: "planetary_nebula",
    constellation: "Lyr",
    raHours: 18.893,
    decDeg: 33.0292,
    magnitude: 8.8,
    recommendedFilter: "lp",
    tags: ["summer", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m8",
    primaryName: "M8",
    aliases: ["NGC 6523", "Lagoon Nebula"],
    objectType: "emission_nebula",
    constellation: "Sgr",
    raHours: 18.05,
    decDeg: -24.3833,
    magnitude: 6,
    recommendedFilter: "lp",
    tags: ["summer", "nebula", "widefield"],
    source: "starter",
  },
  {
    id: "messier:m16",
    primaryName: "M16",
    aliases: ["NGC 6611", "Eagle Nebula"],
    objectType: "emission_nebula",
    constellation: "Ser",
    raHours: 18.3138,
    decDeg: -13.8067,
    magnitude: 6.4,
    recommendedFilter: "lp",
    tags: ["summer", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m17",
    primaryName: "M17",
    aliases: ["NGC 6618", "Omega Nebula", "Swan Nebula"],
    objectType: "emission_nebula",
    constellation: "Sgr",
    raHours: 18.3464,
    decDeg: -16.1715,
    magnitude: 6,
    recommendedFilter: "lp",
    tags: ["summer", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m20",
    primaryName: "M20",
    aliases: ["NGC 6514", "Trifid Nebula"],
    objectType: "emission_nebula",
    constellation: "Sgr",
    raHours: 18.035,
    decDeg: -23.0283,
    magnitude: 6.3,
    recommendedFilter: "lp",
    tags: ["summer", "nebula"],
    source: "starter",
  },
  {
    id: "messier:m11",
    primaryName: "M11",
    aliases: ["NGC 6705", "Wild Duck Cluster"],
    objectType: "open_cluster",
    constellation: "Sct",
    raHours: 18.8517,
    decDeg: -6.2667,
    magnitude: 6.3,
    recommendedFilter: "clear",
    tags: ["summer", "cluster"],
    source: "starter",
  },
  {
    id: "messier:m101",
    primaryName: "M101",
    aliases: ["NGC 5457", "Pinwheel Galaxy"],
    objectType: "galaxy",
    constellation: "UMa",
    raHours: 14.0534,
    decDeg: 54.3489,
    magnitude: 7.9,
    recommendedFilter: "clear",
    tags: ["spring", "galaxy", "widefield"],
    source: "starter",
  },
  {
    id: "messier:m97",
    primaryName: "M97",
    aliases: ["NGC 3587", "Owl Nebula"],
    objectType: "planetary_nebula",
    constellation: "UMa",
    raHours: 11.2449,
    decDeg: 55.019,
    magnitude: 9.9,
    recommendedFilter: "lp",
    tags: ["spring", "nebula"],
    source: "starter",
  },
  {
    id: "ngc:7000",
    primaryName: "NGC 7000",
    aliases: ["North America Nebula"],
    objectType: "emission_nebula",
    constellation: "Cyg",
    raHours: 20.9833,
    decDeg: 44.5,
    magnitude: 4,
    recommendedFilter: "lp",
    tags: ["summer", "nebula", "widefield"],
    source: "starter",
  },
  {
    id: "ngc:1499",
    primaryName: "NGC 1499",
    aliases: ["California Nebula"],
    objectType: "emission_nebula",
    constellation: "Per",
    raHours: 4.0,
    decDeg: 36.6167,
    magnitude: 6,
    recommendedFilter: "lp",
    tags: ["winter", "nebula", "widefield"],
    source: "starter",
  },
  {
    id: "ngc:6992",
    primaryName: "NGC 6992",
    aliases: ["Eastern Veil Nebula", "Veil Nebula"],
    objectType: "supernova_remnant",
    constellation: "Cyg",
    raHours: 20.9367,
    decDeg: 31.75,
    magnitude: 7,
    recommendedFilter: "lp",
    tags: ["summer", "nebula", "widefield"],
    source: "starter",
  },
];

export function validateStarterCatalogTargets(targets: CatalogTarget[] = STARTER_CATALOG_TARGETS): string[] {
  return validateCatalogTargets(targets);
}

export function mergeStarterCatalogTargets(existingTargets: CatalogTarget[]): CatalogTarget[] {
  const merged = new Map<string, CatalogTarget>();

  for (const target of existingTargets) {
    if (!STARTER_CATALOG_IDS.has(target.id)) {
      merged.set(target.id, cloneCatalogTarget(target));
    }
  }

  for (const target of STARTER_CATALOG_TARGETS) {
    merged.set(target.id, cloneCatalogTarget(target));
  }

  return Array.from(merged.values()).sort((left, right) => left.primaryName.localeCompare(right.primaryName));
}

export function searchCatalogTargets(catalog: CatalogTarget[], query: string, limit = 25): CatalogSearchResult[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return catalog.slice(0, limit).map((target) => ({ target, matchKind: "text" }));
  }

  const normalizedQuery = normalizeLookupKey(trimmed);
  return catalog
    .map((target) => scoreCatalogMatch(target, trimmed, normalizedQuery))
    .filter((entry): entry is { target: CatalogTarget; matchKind: CatalogSearchResult["matchKind"]; score: number } =>
      entry !== null
    )
    .sort((left, right) => left.score - right.score || left.target.primaryName.localeCompare(right.target.primaryName))
    .slice(0, limit)
    .map(({ target, matchKind }) => ({ target, matchKind }));
}

export function createManualCatalogTarget(input: ManualCatalogTargetInput): CatalogTarget {
  const primaryName = input.primaryName.trim();
  const normalizedName = normalizeLookupKey(primaryName || "target");
  const idSuffix = normalizedName || `${input.raHours.toFixed(4)}_${input.decDeg.toFixed(4)}`;

  return {
    id: `manual:${idSuffix}`,
    primaryName: primaryName || `RA ${input.raHours.toFixed(4)} Dec ${input.decDeg.toFixed(4)}`,
    aliases: (input.aliases ?? []).map((alias) => alias.trim()).filter(Boolean),
    objectType: input.objectType?.trim() || "manual_coordinate",
    constellation: input.constellation?.trim() || undefined,
    raHours: input.raHours,
    decDeg: input.decDeg,
    magnitude: input.magnitude,
    recommendedFilter: input.recommendedFilter,
    tags: (input.tags ?? ["manual"]).map((tag) => tag.trim()).filter(Boolean),
    source: "manual",
  };
}

const STARTER_CATALOG_IDS = new Set(STARTER_CATALOG_TARGETS.map((target) => target.id));

function scoreCatalogMatch(
  target: CatalogTarget,
  rawQuery: string,
  normalizedQuery: string
): { target: CatalogTarget; matchKind: CatalogSearchResult["matchKind"]; score: number } | null {
  const lowerQuery = rawQuery.toLowerCase();
  const primaryName = target.primaryName.toLowerCase();
  const aliases = target.aliases.map((alias) => alias.toLowerCase());
  const textHaystack = [target.primaryName, ...target.aliases, target.objectType, ...(target.tags ?? [])].join(" ").toLowerCase();

  if (normalizeLookupKey(target.id) === normalizedQuery) {
    return { target, matchKind: "id", score: 0 };
  }
  if (normalizeLookupKey(target.primaryName) === normalizedQuery) {
    return { target, matchKind: "primaryName", score: 1 };
  }
  if (target.aliases.some((alias) => normalizeLookupKey(alias) === normalizedQuery)) {
    return { target, matchKind: "alias", score: 2 };
  }
  if (primaryName.startsWith(lowerQuery)) {
    return { target, matchKind: "primaryName", score: 3 };
  }
  if (aliases.some((alias) => alias.startsWith(lowerQuery))) {
    return { target, matchKind: "alias", score: 4 };
  }
  if (textHaystack.includes(lowerQuery)) {
    return { target, matchKind: "text", score: 5 };
  }

  return null;
}

function cloneCatalogTarget(target: CatalogTarget): CatalogTarget {
  return {
    ...target,
    aliases: [...target.aliases],
    tags: target.tags ? [...target.tags] : undefined,
  };
}

function normalizeLookupKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
