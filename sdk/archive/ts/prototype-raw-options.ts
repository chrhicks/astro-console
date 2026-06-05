import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

function runStep(label: string, command: string[], cwd: string) {
  console.log(`\n== ${label} ==`)
  const result = spawnSync(command[0], command.slice(1), {
    cwd,
    stdio: 'inherit',
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
}

function main() {
  const rawAvi =
    process.argv[2] || '/tmp/opencode/2026-05-08-103245-Solar-timelapse-RAW.avi'
  const repoRoot = resolve(process.cwd())
  const python = '/home/chicks/workspaces/astronomy/seestar/venv/bin/python3'

  runStep(
    'In-house RAW prototype',
    [
      python,
      'scripts/prototype_solar_raw.py',
      rawAvi,
      '-o',
      'prototype_output/inhouse_raw',
    ],
    repoRoot,
  )

  runStep(
    'PSS percentage sweep',
    [
      python,
      'scripts/prototype_pss.py',
      rawAvi,
      '-o',
      'prototype_output/pss_sweep',
    ],
    repoRoot,
  )

  console.log('\nPrototype outputs:')
  console.log('- prototype_output/inhouse_raw/comparison_sheet.png')
  console.log('- prototype_output/pss_sweep/pss_percentage_comparison.png')
  console.log(
    '- prototype_output/pss_sweep/pss_percentage_detail_comparison.png',
  )
}

main()
