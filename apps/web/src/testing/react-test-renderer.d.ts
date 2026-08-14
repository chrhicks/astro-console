declare module 'react-test-renderer' {
  import type { ReactElement } from 'react'

  export interface ReactTestInstance {
    readonly children: ReadonlyArray<ReactTestInstance | string>
    readonly props: {
      readonly disabled?: boolean
      readonly onChange: (event: {
        readonly target: { readonly value: string }
      }) => void
      readonly onClick: () => void
      readonly step?: number
      readonly value?: unknown
    }
    findAllByType(type: string): Array<ReactTestInstance>
    findByType(type: string): ReactTestInstance
  }

  export interface ReactTestRenderer {
    readonly root: ReactTestInstance
    update(element: ReactElement): void
  }

  export function create(element: ReactElement): ReactTestRenderer
}
