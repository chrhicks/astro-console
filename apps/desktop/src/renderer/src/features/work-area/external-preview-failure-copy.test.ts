import { it } from 'node:test'
import assert from 'node:assert/strict'
import { EXTERNAL_PREVIEW_FAILURE_COPY } from './external-preview-failure-copy'

it('states that a preview failure retains the saved FITS frame', () => {
  assert.match(EXTERNAL_PREVIEW_FAILURE_COPY, /FITS saved/)
  assert.doesNotMatch(EXTERNAL_PREVIEW_FAILURE_COPY, /was not saved/)
})
