import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AssetId,
  IntentId,
  ProcessingProjectId,
  ProcessingProjectHttpFailure,
  ProcessingProjectRevision,
} from '@astro-console/protocol'
import { Effect, Fiber } from 'effect'
import { ProcessingProjectRequestError, processClient } from './process-client'

test('uses explicit Processing Project routes and does not replay changes', async () => {
  const originalFetch = globalThis.fetch
  const requests: Array<{ url: string; method: string; body?: unknown }> = []
  globalThis.fetch = async (input, init) => {
    const url = String(input)
    requests.push({
      url,
      method: init?.method ?? 'GET',
      ...(init?.body === undefined
        ? {}
        : { body: JSON.parse(String(init.body)) }),
    })
    if (url === '/api/process/projects')
      return Response.json(
        init?.method === 'POST'
          ? {
              outcome: 'Accepted',
              replayed: false,
              project: openedProject,
            }
          : [
              {
                projectId: 'project-1',
                revision: 1,
                name: 'M27',
                sourceCount: 1,
                state: 'Ready',
                updatedAt: now,
              },
            ],
        { status: init?.method === 'POST' ? 201 : 200 },
      )
    if (url === '/api/process/projects/project-1/evidence')
      return Response.json({ projectId: 'project-1', attempts: [] })
    if (url === '/api/process/projects/project-1')
      return Response.json(
        init?.method === 'PATCH'
          ? { outcome: 'Accepted', replayed: false, project: openedProject }
          : openedProject,
      )
    return Response.json({}, { status: 404 })
  }
  try {
    await Effect.runPromise(processClient.list())
    await Effect.runPromise(
      processClient.open(ProcessingProjectId.make('project-1')),
    )
    await Effect.runPromise(
      processClient.evidence(ProcessingProjectId.make('project-1')),
    )
    await Effect.runPromise(
      processClient.create({
        name: 'M27',
        selection: { assetIds: [AssetId.make('asset-1')], captureSetIds: [] },
        intentId: IntentId.make('intent-create'),
      }),
    )
    await Effect.runPromise(
      processClient.change({
        projectId: ProcessingProjectId.make('project-1'),
        expectedProjectRevision: ProcessingProjectRevision.make(1),
        intentId: IntentId.make('intent-change'),
        intent: { _tag: 'UndoDraft', stage: 'Calibration' },
      }),
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(
    requests.map(({ url, method }) => ({ url, method })),
    [
      { url: '/api/process/projects', method: 'GET' },
      { url: '/api/process/projects/project-1', method: 'GET' },
      { url: '/api/process/projects/project-1/evidence', method: 'GET' },
      { url: '/api/process/projects', method: 'POST' },
      { url: '/api/process/projects/project-1', method: 'PATCH' },
    ],
  )
  assert.equal(
    requests.filter((request) => request.method === 'PATCH').length,
    1,
  )
})

test('decodes Processing Project failures and rejects malformed JSON responses', async () => {
  const originalFetch = globalThis.fetch
  try {
    globalThis.fetch = async () =>
      Response.json(
        ProcessingProjectHttpFailure.cases.DomainRejected.make({
          error: {
            _tag: 'ProjectNotFound',
            projectId: ProcessingProjectId.make('missing-project'),
          },
        }),
        { status: 404 },
      )
    await assert.rejects(
      () =>
        Effect.runPromise(
          processClient.open(ProcessingProjectId.make('missing-project')),
        ),
      (error: unknown) =>
        error instanceof ProcessingProjectRequestError &&
        error.detail._tag === 'DomainRejected' &&
        error.detail.error._tag === 'ProjectNotFound',
    )

    globalThis.fetch = async () => Response.json({ projectId: 'incomplete' })
    await assert.rejects(
      () =>
        Effect.runPromise(
          processClient.evidence(ProcessingProjectId.make('project-1')),
        ),
      (error: unknown) =>
        error instanceof ProcessingProjectRequestError &&
        error.detail._tag === 'MalformedResponse',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('aborts a Process response body when its Effect is interrupted', async () => {
  const originalFetch = globalThis.fetch
  let signal: AbortSignal | undefined
  let markBodyStarted: (() => void) | undefined
  let markAborted: (() => void) | undefined
  const bodyStarted = new Promise<void>((resolve) => {
    markBodyStarted = resolve
  })
  const aborted = new Promise<void>((resolve) => {
    markAborted = resolve
  })
  globalThis.fetch = async (_input, init) => {
    signal = init?.signal ?? undefined
    return {
      status: 200,
      json: () => {
        markBodyStarted?.()
        return new Promise<unknown>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => {
              markAborted?.()
              reject(new DOMException('Aborted', 'AbortError'))
            },
            { once: true },
          )
        })
      },
    } as Response
  }
  try {
    const fiber = Effect.runFork(processClient.list())
    await bodyStarted
    await Effect.runPromise(Fiber.interrupt(fiber))
    await aborted
    assert.equal(signal?.aborted, true)
  } finally {
    globalThis.fetch = originalFetch
  }
})

const now = '2026-08-10T00:00:00.000Z'
const initialDrafts = [
  {
    stage: 'Calibration',
    draft: {
      revision: 0,
      value: { _tag: 'Calibration', settings: [], overrides: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Registration',
    draft: {
      revision: 0,
      value: { _tag: 'Registration', settings: [], inclusions: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Stacking',
    draft: {
      revision: 0,
      value: { _tag: 'Stacking', settings: [], frameChoices: [] },
      canUndo: false,
      canRedo: false,
    },
  },
  {
    stage: 'Develop',
    draft: {
      revision: 0,
      value: {
        _tag: 'Develop',
        operation: { _tag: 'Stretch', method: 'asinh', amount: 0.35 },
      },
      canUndo: false,
      canRedo: false,
    },
  },
].map((stage) => ({
  ...stage,
  resultHistory: { canUndo: false, canRedo: false },
  run: { _tag: 'Unavailable', reason: 'CurrentUpstreamResultRequired' },
}))

const openedProject = {
  projectId: 'project-1',
  revision: 1,
  name: 'M27',
  authority: { _tag: 'Allowed' },
  sources: [],
  warnings: [],
  stages: initialDrafts,
  savedAssetIds: [],
  createdAt: now,
  updatedAt: now,
}
