export interface CatalogSearchIndex {
  byId: Map<string, number>                // target id → array index
  byMessierNumber: Map<string, number>     // "42" → array index (for M42)
  byConstellation: Map<string, number[]>  // "Ori" → [indices]
  byObjectType: Map<string, number[]>      // "G" → [indices]
  normalizedKeys: Array<{                   // pre-computed for fuzzy search
    index: number
    keys: string[]                          // ["m42", "ngc1976", "orionnebula", "orion"]
  }>
}