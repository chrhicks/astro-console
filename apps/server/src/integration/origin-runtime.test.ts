import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ManagedRuntime, Schema } from 'effect'
import {
  OpenedProcessingProject,
  ProcessingProjectChanged,
} from '@astro-console/protocol'
import type { OriginServerConfig } from '../config/environment-config.ts'
import {
  OriginRuntime,
  originRuntimeLayer,
  productionOriginAdapters,
} from '../app/origin-runtime.ts'

const runtimeConfig = (root: string): OriginServerConfig => ({
  runtime: {
    databasePath: join(root, 'state.sqlite'),
    release: 'origin-runtime-test',
    port: 0,
    host: '127.0.0.1',
    webDistPath: '../web/dist',
    previewRoot: join(root, 'previews'),
    originalsRoot: join(root, 'originals'),
  },
  admission: { mode: 'development', client: 'owner' },
  fixture: 'm27',
  downloadGrant: undefined,
  preflightProvider: undefined,
  simulation: undefined,
  plateSolve: {
    executable: '/usr/bin/false',
    indexesRoot: join(root, 'indexes'),
    timeoutMs: 1_000,
    solverVersion: 'test',
    scaleLowDeg: 20,
    scaleHighDeg: 30,
    searchRadiusDeg: 15,
  },
})

const openRuntime = async (config: OriginServerConfig) => {
  const runtime = ManagedRuntime.make(
    originRuntimeLayer(config, productionOriginAdapters),
  )
  const origin = await runtime.runPromise(OriginRuntime)
  const bound = await runtime.runPromise(origin.listen())
  return { runtime, origin, bound }
}

test('origin runtime owns HTTP, work publication, restart, and scoped shutdown', async () => {
  const root = mkdtempSync(join(tmpdir(), 'astro-origin-runtime-'))
  const config = runtimeConfig(root)
  const first = await openRuntime(config)
  const base = `http://127.0.0.1:${first.bound.primary.port}`

  assert.equal(
    (await first.runtime.runPromise(first.origin.listen())).primary.port,
    first.bound.primary.port,
  )
  assert.deepEqual(
    await fetch(`${base}/health/live`).then((response) => response.json()),
    {
      status: 'alive',
    },
  )
  assert.equal((await fetch(`${base}/api/snapshot`)).status, 200)

  const stream = await fetch(`${base}/api/events`)
  const reader = stream.body?.getReader()
  if (reader === undefined) throw new Error('SSE response has no body')
  await reader.read()

  const createdResponse = await fetch(`${base}/api/process/projects`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Runtime interface proof',
      selection: { assetIds: [], captureSetIds: ['m27-stack-1'] },
      intentId: 'runtime-project-create',
    }),
  })
  assert.equal(createdResponse.status, 201)
  const created = Schema.decodeUnknownSync(ProcessingProjectChanged)(
    await createdResponse.json(),
  )
  const runResponse = await fetch(
    `${base}/api/process/projects/${created.project.projectId}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId: created.project.projectId,
        expectedProjectRevision: created.project.revision,
        intentId: 'runtime-calibration-run',
        intent: {
          _tag: 'RunStage',
          stage: 'Calibration',
          from: { _tag: 'CurrentDraft' },
        },
      }),
    },
  )
  assert.equal(runResponse.status, 200)

  let opened: typeof OpenedProcessingProject.Type | undefined
  let publication = ''
  for (let index = 0; index < 8; index += 1) {
    const event = await reader.read()
    publication += new TextDecoder().decode(event.value)
    opened = Schema.decodeUnknownSync(OpenedProcessingProject)(
      await fetch(
        `${base}/api/process/projects/${created.project.projectId}`,
      ).then((response) => response.json()),
    )
    if (
      opened.stages.find((stage) => stage.stage === 'Calibration')
        ?.currentResult?.outcome === 'Succeeded'
    )
      break
  }
  assert.match(publication, /event: ProjectionChanged/)
  assert.equal(
    opened?.stages.find((stage) => stage.stage === 'Calibration')?.currentResult
      ?.outcome,
    'Succeeded',
  )

  await reader.cancel()
  await first.runtime.dispose()
  await assert.rejects(fetch(`${base}/health/live`))

  const recovered = await openRuntime(config)
  const recoveredBase = `http://127.0.0.1:${recovered.bound.primary.port}`
  const recoveredProject = Schema.decodeUnknownSync(OpenedProcessingProject)(
    await fetch(
      `${recoveredBase}/api/process/projects/${created.project.projectId}`,
    ).then((response) => response.json()),
  )
  assert.equal(
    recoveredProject.stages.find((stage) => stage.stage === 'Calibration')
      ?.currentResult?.outcome,
    'Succeeded',
  )
  await recovered.runtime.dispose()
  await assert.rejects(fetch(`${recoveredBase}/health/live`))
})
