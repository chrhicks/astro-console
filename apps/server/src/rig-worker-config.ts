export type RigWorkerConfig =
  | { readonly mode: 'disabled'; readonly databasePath: string }
  | {
      readonly mode: 'seestar'
      readonly databasePath: string
      readonly rigId: 'seestar-s30'
      readonly host: string
      readonly pemPath: string
    }
