import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { LibraryQuery } from '../library-client'
import { isLibraryShortcutBlocked, LibraryView } from './LibraryView'

const shortcutEvent = (
  overrides: Partial<
    Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>
  > = {},
) => ({
  altKey: false,
  ctrlKey: false,
  metaKey: false,
  target: null,
  ...overrides,
})

const eventTarget = (value: object) => value as unknown as EventTarget

test('Library review shortcuts ignore browser and operating-system chords', () => {
  assert.equal(isLibraryShortcutBlocked(shortcutEvent()), false)
  assert.equal(isLibraryShortcutBlocked(shortcutEvent({ altKey: true })), true)
  assert.equal(isLibraryShortcutBlocked(shortcutEvent({ ctrlKey: true })), true)
  assert.equal(isLibraryShortcutBlocked(shortcutEvent({ metaKey: true })), true)
})

test('Library review shortcuts ignore editable targets', () => {
  assert.equal(
    isLibraryShortcutBlocked(
      shortcutEvent({
        target: eventTarget({ tagName: 'DIV', isContentEditable: true }),
      }),
    ),
    true,
  )
  for (const tagName of ['INPUT', 'SELECT', 'TEXTAREA']) {
    assert.equal(
      isLibraryShortcutBlocked(
        shortcutEvent({ target: eventTarget({ tagName }) }),
      ),
      true,
    )
  }
  assert.equal(
    isLibraryShortcutBlocked(
      shortcutEvent({ target: eventTarget({ tagName: 'BUTTON' }) }),
    ),
    false,
  )
})

test('Library detail failures do not also claim that no asset is selected', () => {
  const query = {
    queryId: 'nightbook',
    pageSize: 40,
    sort: 'capturedAtDescending',
  } as LibraryQuery
  const cases = [
    ['loading', 'Loading asset detail.'],
    ['not-found', 'Asset not found.'],
    ['unavailable', 'Asset detail is unavailable.'],
  ] as const

  for (const [detailState, expected] of cases) {
    const markup = renderToStaticMarkup(
      createElement(LibraryView, {
        view: { assets: [] },
        assetId: 'asset-process-output',
        link: () => ({ href: '#', onClick: () => undefined }),
        page: { query },
        detailState,
      }),
    )
    assert.match(markup, new RegExp(expected.replace('.', '\\.')))
    assert.doesNotMatch(markup, /No asset selected\./)
  }
})
