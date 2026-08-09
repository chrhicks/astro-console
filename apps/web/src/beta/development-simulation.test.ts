import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DevelopmentSimulationSurface,
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
    summary:
      'One 15-second M101 exposure can reach Verify. Library remains unchanged.',
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
  assert.match(markup, />Advance 16s</)
  assert.match(markup, /href="\/plan\?ui=beta"/)
  assert.match(markup, /href="\/observe\?ui=beta"/)
  assert.doesNotMatch(markup, /Capture test frame/)
  assert.doesNotMatch(markup, /CompleteCameraExposure/)
  assert.doesNotMatch(markup, /Library evidence/)
  assert.match(
    markup,
    /One 15-second M101 exposure can reach Verify. Library remains unchanged./,
  )
  assert.match(markup, /Load selects simulator state only/)
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
  assert.doesNotMatch(markup, />Advance 16s</)
  assert.match(markup, />Details</)
})

test('ready-rig names the normal Observe path without a direct command button', () => {
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
  assert.doesNotMatch(markup, />Run preflight test</)
  assert.doesNotMatch(markup, />Capture test frame</)
  assert.match(markup, /Continue through Plan and Observe/)
  assert.match(markup, /href="\/observe\?ui=beta"/)
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
  assert.doesNotMatch(markup, /Capture test frame/)
  assert.match(
    markup,
    /Two NGC 7000 frames preserve severe-focus quality facts/,
  )
})

test('an exhausted sequence keeps the last frame visible without capture claims', () => {
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
  assert.doesNotMatch(markup, /Capture test frame/)
})

test('a simulator-only scenario names the missing UI driver', () => {
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
  assert.doesNotMatch(markup, /Capture test frame/)
})
