import { Effect, Fiber, Stream } from 'effect'
import { useEffect, useState } from 'react'
import {
  createWorkspaceRuntime,
  initialWorkspaceState,
  WorkspaceRuntime,
  type WorkspaceIntent,
  type WorkspaceState,
  type WorkspaceSubmission,
} from './workspace-runtime'

export type SubmitWorkspace = (
  intent: WorkspaceIntent,
) => Promise<WorkspaceSubmission>

export type WorkspaceRuntimeBinding =
  | {
      readonly _tag: 'Starting'
      readonly state: WorkspaceState
    }
  | {
      readonly _tag: 'Ready'
      readonly state: WorkspaceState
      readonly submit: SubmitWorkspace
    }

export type WorkspaceRuntimeSource = {
  readonly initialState: WorkspaceState
  readonly submit: SubmitWorkspace
  readonly subscribe: (publish: (state: WorkspaceState) => void) => () => void
  readonly dispose: () => Promise<void>
}

const createWorkspaceRuntimeSource = (): WorkspaceRuntimeSource => {
  const runtime = createWorkspaceRuntime()
  let interruption = Promise.resolve<unknown>(undefined)

  return {
    initialState: initialWorkspaceState,
    submit: (intent) =>
      runtime.runPromise(
        Effect.flatMap(WorkspaceRuntime, (workspace) =>
          workspace.submit(intent),
        ),
      ),
    subscribe: (publish) => {
      const fiber = runtime.runFork(
        Effect.flatMap(WorkspaceRuntime, (workspace) =>
          workspace.states.pipe(
            Stream.runForEach((state) => Effect.sync(() => publish(state))),
          ),
        ),
      )
      return () => {
        interruption = runtime.runPromise(Fiber.interrupt(fiber))
      }
    },
    dispose: async () => {
      await interruption
      await runtime.dispose()
    },
  }
}

export const useWorkspaceRuntimeFromSource = (
  createSource: () => WorkspaceRuntimeSource,
): WorkspaceRuntimeBinding => {
  const [binding, setBinding] = useState<WorkspaceRuntimeBinding>({
    _tag: 'Starting',
    state: initialWorkspaceState,
  })

  useEffect(() => {
    const source = createSource()
    let active = true
    const publish = (state: WorkspaceState) => {
      if (!active) return
      setBinding({ _tag: 'Ready', state, submit: source.submit })
    }
    const unsubscribe = source.subscribe(publish)
    setBinding({
      _tag: 'Ready',
      state: source.initialState,
      submit: source.submit,
    })

    return () => {
      active = false
      unsubscribe()
      void source.dispose()
    }
  }, [])

  return binding
}

export const useWorkspaceRuntime = (): WorkspaceRuntimeBinding =>
  useWorkspaceRuntimeFromSource(createWorkspaceRuntimeSource)
