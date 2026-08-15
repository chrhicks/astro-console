import assert from 'node:assert/strict'
import test from 'node:test'
import { act, createElement, StrictMode } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import {
  initialWorkspaceState,
  WorkspaceSubmission,
  type WorkspaceIntent,
  type WorkspaceState,
} from './workspace-runtime'
import {
  useWorkspaceRuntimeFromSource,
  type WorkspaceRuntimeBinding,
  type WorkspaceRuntimeSource,
} from './use-workspace-runtime'

Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { value: true })

type ControlledSource = WorkspaceRuntimeSource & {
  readonly publish: (state: WorkspaceState) => void
  readonly submissions: Array<WorkspaceIntent>
  readonly unsubscribeCount: () => number
  readonly disposeCount: () => number
  readonly finishDisposal: () => void
}

const makeState = (projectionReceived: boolean): WorkspaceState => ({
  ...initialWorkspaceState,
  projectionReceived,
})

const makeControlledSource = (): ControlledSource => {
  let subscriber: ((state: WorkspaceState) => void) | undefined
  let unsubscribed = 0
  let disposed = 0
  let finishDisposal: () => void = () => undefined
  const disposal = new Promise<void>((resolve) => {
    finishDisposal = resolve
  })
  const submissions: Array<WorkspaceIntent> = []

  return {
    initialState: initialWorkspaceState,
    submissions,
    submit: async (intent) => {
      submissions.push(intent)
      return WorkspaceSubmission.Loaded({})
    },
    subscribe: (publish) => {
      subscriber = publish
      return () => {
        unsubscribed += 1
      }
    },
    dispose: () => {
      disposed += 1
      return disposal
    },
    publish: (state) => subscriber?.(state),
    unsubscribeCount: () => unsubscribed,
    disposeCount: () => disposed,
    finishDisposal: () => finishDisposal(),
  }
}

test('binds one ordered source lifetime and submits each semantic intent once', async () => {
  const source = makeControlledSource()
  const bindings: Array<WorkspaceRuntimeBinding> = []
  const createSource = () => source
  const Probe = () => {
    bindings.push(useWorkspaceRuntimeFromSource(createSource))
    return null
  }

  let renderer: ReactTestRenderer | undefined
  await act(() => {
    renderer = create(createElement(Probe))
  })

  assert.equal(bindings[0]?._tag, 'Starting')
  const ready = bindings.at(-1)
  assert.equal(ready?._tag, 'Ready')
  assert.equal(ready?.state, initialWorkspaceState)
  if (ready?._tag !== 'Ready') throw new Error('Workspace did not become ready')

  const intent: WorkspaceIntent = {
    _tag: 'SelectComparisonAsset',
    assetId: undefined,
  }
  const submission = await ready.submit(intent)
  assert.equal(submission._tag, 'Loaded')
  assert.deepEqual(source.submissions, [intent])

  const first = makeState(true)
  const second = makeState(false)
  await act(() => source.publish(first))
  assert.equal(bindings.at(-1)?.state, first)
  await act(() => source.publish(second))
  assert.equal(bindings.at(-1)?.state, second)

  await act(() => renderer?.unmount())
  assert.equal(source.unsubscribeCount(), 1)
  assert.equal(source.disposeCount(), 1)
  source.finishDisposal()
})

test('invalidates late publication and creates an independent Strict Mode lifetime', async () => {
  const sources: Array<ControlledSource> = []
  const bindings: Array<WorkspaceRuntimeBinding> = []
  const createSource = () => {
    const source = makeControlledSource()
    sources.push(source)
    return source
  }
  const Probe = () => {
    bindings.push(useWorkspaceRuntimeFromSource(createSource))
    return null
  }

  let renderer: ReactTestRenderer | undefined
  await act(() => {
    renderer = create(createElement(StrictMode, null, createElement(Probe)))
  })

  assert.equal(sources.length, 2)
  const first = sources[0]
  const second = sources[1]
  assert.ok(first)
  assert.ok(second)
  assert.equal(first.unsubscribeCount(), 1)
  assert.equal(first.disposeCount(), 1)
  assert.equal(second.unsubscribeCount(), 0)

  const renderCount = bindings.length
  await act(() => first.publish(makeState(true)))
  assert.equal(bindings.length, renderCount)

  const current = makeState(true)
  await act(() => second.publish(current))
  assert.equal(bindings.at(-1)?.state, current)

  await act(() => renderer?.unmount())
  assert.equal(second.unsubscribeCount(), 1)
  assert.equal(second.disposeCount(), 1)
  first.finishDisposal()
  second.finishDisposal()
})
