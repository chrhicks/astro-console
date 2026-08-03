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

const forbidden = [
  'Development fixture',
  'Fixture Stretch',
  'Build complete',
  'Gradient removal',
  'Host policy healthy',
  'checkpoint preserved',
  'Last valid image',
  'process-m31-v3',
  'process-steps',
  'process-rail',
  'process-canvas',
  'process-image',
  'fixture-adapter',
  '?fixture=',
  'theme-study',
]

for (const text of forbidden)
  if (contents.some((content) => content.includes(text)))
    throw new Error(`Production build must exclude ${text}.`)
