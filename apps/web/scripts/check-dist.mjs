import { readdir, readFile } from 'node:fs/promises'

const index = await readFile('dist/index.html', 'utf8')
const assetPaths = index.match(/(?:src|href)="\/assets\/[^"\s]+"/g) ?? []

if (assetPaths.length === 0)
  throw new Error(
    'Expected dist/index.html to reference root-relative /assets paths.',
  )

const assets = await readdir('dist/assets')
const contents = await Promise.all(
  assets.map((asset) => readFile(`dist/assets/${asset}`, 'utf8')),
)

if (contents.some((content) => content.includes('Development fixture')))
  throw new Error('Production build must exclude the development fixture.')
