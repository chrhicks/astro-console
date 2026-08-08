import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { bootstrapFixtures } from '@astro-console/v2-contracts'
import {
  DevelopmentSimulationSurface,
  captureSimulationFrame,
  projectSimulationPreflight,
  readSimulationProjection,
  sendSimulationControl,
  type DevelopmentSimulationProjection,
} from './development-simulation'

const projection: DevelopmentSimulationProjection = {
  mode: 'alpaca',
  notice: 'SIMULATION · NOT LIVE HARDWARE',
  scenario: 'exposure-success',
  launchScenario: 'exposure-success',
  scenarios: ['ready-rig', 'exposure-success'],
  provenance: {
    provider: 'Astro Console Alpaca development simulator',
    transport: 'Server-mediated loopback',
  },
  clock: { nowMs: 1_000, generation: 2 },
  camera: { phase: 'idle', imageReady: true },
  evidence: {
    sequenceLength: 1,
    framesServed: 0,
    lastFrame: null,
    nextFrame: {
      id: 'm101-good-light',
      filename: 'm101-good-light.fits',
      purpose: 'exposure-success',
      sha256:
        '3d4abc598e2168bddf9d43d7ce9acad788e5c288a7e6bc211013eea31d9d9e24',
      capture: {
        _tag: 'Available',
        exposureSeconds: 15,
        capturedAt: '2026-06-22T02:38:07.417Z',
        filter: 'None',
        binning: 1,
        frameType: 'light',
      },
    },
  },
  commandCount: 1,
  guide: {
    summary: 'One 15-second M101 exposure can enter Library.',
    driver: {
      _tag: 'Available',
      action: 'capture-test-frame',
      label: 'Capture test frame',
    },
  },
}

test('simulation client uses only the Astro Console origin route', async () => {
  const requests: Array<{ input: string; init?: RequestInit }> = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    requests.push({
      input: String(input),
      ...(init === undefined ? {} : { init }),
    })
    return Promise.resolve(
      new Response(JSON.stringify(projection), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )
  }
  try {
    const state = await readSimulationProjection()
    assert.equal(state._tag, 'available')
    await sendSimulationControl({ action: 'advance', milliseconds: 1_000 })
  } finally {
    globalThis.fetch = previousFetch
  }
  assert.deepEqual(
    requests.map((request) => request.input),
    ['/api/simulation', '/api/simulation'],
  )
  assert.equal(
    requests.some((request) => request.input.includes('__sim')),
    false,
  )
  assert.equal(requests[1]?.init?.method, 'POST')
})

test('normal runtime absence does not create a simulation projection', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new Response('{}', { status: 404 }))
  try {
    assert.deepEqual(await readSimulationProjection(), { _tag: 'absent' })
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('test capture uses normal active-run, Preflight, camera, and Library intake routes', async () => {
  const requests: Array<{ path: string; body?: unknown }> = []
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ path, ...(body === undefined ? {} : { body }) })
    if (path === '/api/snapshot')
      return json({ ok: true, data: bootstrapFixtures.activeRun })
    if (path === '/api/simulation' && init?.method === 'POST')
      return json(projection)
    if (path === '/api/simulation') return json(projection)
    if (path === '/api/acquire/commands') {
      const intent = (body as { intent?: { _tag?: string } }).intent
      if (intent?._tag === 'CompleteCameraExposure')
        return json({
          _tag: 'Completed',
          assetId: 'asset-capture-simulation-proof',
        })
    }
    return json({}, 202)
  }
  try {
    const result = await captureSimulationFrame({
      _tag: 'Available',
      exposureSeconds: 15,
      capturedAt: '2026-06-22T02:38:07.417Z',
      filter: 'None',
      binning: 1,
      frameType: 'light',
    })
    assert.equal(result.assetId, 'asset-capture-simulation-proof')
  } finally {
    globalThis.fetch = previousFetch
  }
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      '/api/snapshot',
      '/api/observe/preflight',
      '/api/snapshot',
      '/api/acquire/commands',
      '/api/simulation',
      '/api/snapshot',
      '/api/acquire/commands',
      '/api/simulation',
    ],
  )
  const start = requests.find(
    (request) =>
      (request.body as { intent?: { _tag?: string } } | undefined)?.intent
        ?._tag === 'StartCameraExposure',
  )
  assert.equal(
    (start?.body as { intent: { durationSeconds: number } }).intent
      .durationSeconds,
    15,
  )
  const advance = requests.find(
    (request) =>
      (request.body as { action?: string } | undefined)?.action === 'advance',
  )
  assert.deepEqual(advance?.body, {
    action: 'advance',
    milliseconds: 16_000,
  })
  const complete = requests.find(
    (request) =>
      (request.body as { intent?: { _tag?: string } } | undefined)?.intent
        ?._tag === 'CompleteCameraExposure',
  )
  assert.equal(
    (complete?.body as { intent: { capturedAt: string } }).intent.capturedAt,
    '2026-06-22T02:38:07.417Z',
  )
  assert.equal(
    requests.some((request) => request.path.includes('__sim')),
    false,
  )
})

test('test capture reports a normal command rejection summary', async () => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = async (input) =>
    String(input) === '/api/snapshot'
      ? json({ ok: true, data: bootstrapFixtures.activeRun })
      : json({ _tag: 'Rejected', summary: 'Camera is disconnected.' }, 409)
  try {
    await assert.rejects(
      captureSimulationFrame({
        _tag: 'Available',
        exposureSeconds: 15,
        capturedAt: '2026-06-22T02:38:07.417Z',
        filter: 'None',
        binning: 1,
        frameType: 'light',
      }),
      /Camera is disconnected\./,
    )
  } finally {
    globalThis.fetch = previousFetch
  }
})

test('simulated preflight starts the accepted run when needed and uses the normal Observe route', async () => {
  const requests: Array<{ path: string; body?: unknown }> = []
  const previousFetch = globalThis.fetch
  let snapshots = 0
  globalThis.fetch = async (input, init) => {
    const path = String(input)
    const body =
      typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ path, ...(body === undefined ? {} : { body }) })
    if (path === '/api/snapshot') {
      snapshots += 1
      return json({
        ok: true,
        data:
          snapshots === 1
            ? {
                ...bootstrapFixtures.fresh,
                plan: {
                  planId: 'plan-m27',
                  revision: 1,
                  readiness: 'ready',
                  readinessSummary: 'Ready.',
                  limitations: [],
                  sequences: [
                    {
                      sequenceId: 'seq-1',
                      target: 'M27',
                      capture: '1 × 15s',
                      acquisition: 'Simulated preflight',
                      stopCondition: 'One frame',
                      window: {
                        startsAt: '2026-08-02T20:00:00Z',
                        endsAt: '2026-08-02T21:00:00Z',
                        usableMinutes: 60,
                        peakAltitudeDeg: 60,
                        horizonClearanceDeg: 20,
                      },
                      estimatedMinutes: 1,
                      storageForecastMb: 50,
                      horizon: 'clear',
                      storage: 'available',
                      viability: 'viable',
                    },
                  ],
                  acceptedRunDefinition: {
                    id: 'definition-m27-r1',
                    sourcePlanRevision: 1,
                    acceptedAt: '2026-08-02T19:00:00Z',
                    executor: 'fake',
                  },
                },
              }
            : bootstrapFixtures.activeRun,
      })
    }
    if (path === '/api/simulation')
      return json({
        ...projection,
        scenario: 'ready-rig',
        guide: {
          summary: 'All configured simulator devices report ready.',
          driver: {
            _tag: 'Available',
            action: 'refresh-preflight',
            label: 'Run preflight test',
          },
        },
      })
    return json({}, path === '/api/plan/commands' ? 202 : 200)
  }
  try {
    const result = await projectSimulationPreflight()
    assert.equal(result.scenario, 'ready-rig')
  } finally {
    globalThis.fetch = previousFetch
  }
  assert.deepEqual(
    requests.map((request) => request.path),
    [
      '/api/snapshot',
      '/api/plan/commands',
      '/api/snapshot',
      '/api/observe/preflight',
      '/api/simulation',
    ],
  )
  assert.equal(
    (
      requests.find((request) => request.path === '/api/plan/commands')
        ?.body as { intent: { _tag: string } }
    ).intent._tag,
    'StartAcceptedRun',
  )
})

test('simulation surface carries explicit real-frame context and desktop controls', () => {
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection },
      readOnly: false,
    }),
  )
  assert.match(markup, /Simulation · not live hardware/i)
  assert.match(markup, /exposure-success/)
  assert.match(markup, /m101-good-light\.fits/)
  assert.match(markup, /sha256 3d4abc598e/)
  assert.match(markup, /T\+00:01/)
  assert.match(markup, />Load</)
  assert.match(markup, />Reset</)
  assert.match(markup, />Advance 1s</)
  assert.match(markup, />Capture test frame</)
  assert.match(markup, /One 15-second M101 exposure can enter Library/)
  assert.match(markup, /Load selects simulator state/)
})

test('read-only simulation surface omits mutation controls', () => {
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection },
      readOnly: true,
    }),
  )
  assert.match(markup, /Controls require desktop\./)
  assert.doesNotMatch(markup, />Load</)
  assert.doesNotMatch(markup, />Reset</)
  assert.doesNotMatch(markup, />Advance 1s</)
  assert.doesNotMatch(markup, />Capture test frame</)
  assert.match(markup, />Details</)
})

test('ready-rig exposes a direct preflight driver instead of unsupported guidance', () => {
  const ready: DevelopmentSimulationProjection = {
    ...projection,
    scenario: 'ready-rig',
    guide: {
      summary: 'All configured simulator devices report ready.',
      driver: {
        _tag: 'Available',
        action: 'refresh-preflight',
        label: 'Run preflight test',
      },
    },
  }
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection: ready },
      readOnly: false,
    }),
  )
  assert.match(markup, />Run preflight test</)
  assert.doesNotMatch(markup, />Capture test frame</)
  assert.match(markup, /Next: Run preflight test/)
})

test('NGC 7000 frames show the camera-bound denial instead of the 15-second shortcut', () => {
  const ngcProjection: DevelopmentSimulationProjection = {
    ...projection,
    scenario: 'focus-quality-degradation',
    guide: {
      summary: 'Two NGC 7000 frames preserve severe-focus quality facts.',
      driver: {
        _tag: 'Unavailable',
        reason:
          'The beta UI driver is not implemented yet; Load changes simulator state only.',
      },
    },
    evidence: {
      ...projection.evidence,
      nextFrame: {
        id: 'ngc7000-first-light',
        filename: 'ngc7000-first-light.fits',
        purpose: 'focus-quality',
        capture: {
          _tag: 'Unavailable',
          reason:
            'This frame is not eligible for the 15-second test capture. NGC 7000 frames require 120 seconds, beyond the current 60-second camera command bound.',
        },
      },
    },
  }
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection: ngcProjection },
      readOnly: false,
    }),
  )
  assert.match(markup, /Capture test frame/)
  assert.match(markup, /disabled=""[^>]*>Capture test frame/)
  assert.match(markup, /NGC 7000 frames require 120 seconds/)
})

test('an exhausted sequence keeps the last frame visible but disables capture', () => {
  const exhausted: DevelopmentSimulationProjection = {
    ...projection,
    evidence: {
      ...projection.evidence,
      framesServed: 1,
      lastFrame: projection.evidence.nextFrame,
      nextFrame: null,
    },
  }
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection: exhausted },
      readOnly: false,
    }),
  )
  assert.match(markup, /m101-good-light\.fits/)
  assert.match(markup, /disabled=""[^>]*>Capture test frame/)
})

test('a simulator-only scenario names the missing UI driver and disables capture', () => {
  const simulatorOnly: DevelopmentSimulationProjection = {
    ...projection,
    scenario: 'abort-exposure',
    guide: {
      summary: 'Camera abort clears the active exposure without an image.',
      driver: {
        _tag: 'Unavailable',
        reason:
          'The beta UI driver is not implemented yet; Load changes simulator state only.',
      },
    },
  }
  const markup = renderToStaticMarkup(
    createElement(DevelopmentSimulationSurface, {
      state: { _tag: 'available' as const, projection: simulatorOnly },
      readOnly: false,
    }),
  )
  assert.match(markup, /Camera abort clears the active exposure/)
  assert.match(markup, /Load changes simulator state only/)
  assert.match(markup, /disabled=""[^>]*>Capture test frame/)
})

function json(value: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(value), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
}
