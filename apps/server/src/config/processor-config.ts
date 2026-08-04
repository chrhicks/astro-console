export type ProcessorConfig =
  | { readonly mode: 'disabled' }
  | {
      readonly mode: 'manifest'
      readonly databasePath: string
      readonly sourcesRoot: string
      readonly originalsRoot: string
      readonly outputsRoot: string
      readonly manifestPath: string
      readonly ownerPersonId: string
    }
