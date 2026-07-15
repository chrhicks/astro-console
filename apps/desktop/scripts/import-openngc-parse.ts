import { Schema, SchemaTransformation } from 'effect'
import { readFile } from 'node:fs/promises'
import { parse } from 'csv-parse/sync'

/** OpenNGC CSV cells use "" for missing values. */
const CsvOptionalString = Schema.String.pipe(
  Schema.decodeTo(
    Schema.UndefinedOr(Schema.String),
    SchemaTransformation.transform({
      decode: (value) => (value === '' ? undefined : value),
      encode: (value) => value ?? '',
    }),
  ),
)

const CsvOptionalNumber = Schema.String.pipe(
  Schema.decodeTo(
    Schema.UndefinedOr(Schema.Number.check(Schema.isFinite())),
    SchemaTransformation.transform({
      decode: (value) => (value === '' ? undefined : Number(value)),
      encode: (value) => (value === undefined ? '' : String(value)),
    }),
  ),
)

/** Raw row shape after csv-parse with `columns: true` and `delimiter: ";"`. */
export const OpenNgcRowSchema = Schema.Struct({
  Name: Schema.String,
  Type: Schema.String,
  RA: Schema.String,
  Dec: Schema.String,
  Const: Schema.String,
  MajAx: CsvOptionalNumber,
  MinAx: CsvOptionalNumber,
  PosAng: CsvOptionalNumber,
  'B-Mag': CsvOptionalNumber,
  'V-Mag': CsvOptionalNumber,
  'J-Mag': CsvOptionalNumber,
  'H-Mag': CsvOptionalNumber,
  'K-Mag': CsvOptionalNumber,
  SurfBr: CsvOptionalNumber,
  Hubble: CsvOptionalString,
  Pax: CsvOptionalNumber,
  'Pm-RA': CsvOptionalNumber,
  'Pm-Dec': CsvOptionalNumber,
  RadVel: CsvOptionalNumber,
  Redshift: CsvOptionalNumber,
  'Cstar U-Mag': CsvOptionalNumber,
  'Cstar B-Mag': CsvOptionalNumber,
  'Cstar V-Mag': CsvOptionalNumber,
  M: CsvOptionalString,
  NGC: CsvOptionalString,
  IC: CsvOptionalString,
  'Cstar Names': CsvOptionalString,
  Identifiers: CsvOptionalString,
  'Common names': CsvOptionalString,
  'NED notes': CsvOptionalString,
  'OpenNGC notes': CsvOptionalString,
  Sources: CsvOptionalString,
})

export type OpenNgcRow = Schema.Schema.Type<typeof OpenNgcRowSchema>

export async function parseCsv(path: string): Promise<OpenNgcRow[]> {
  const data = await readFile(path, 'utf8')
  const rows = parse(data, {
    columns: true,
    delimiter: ';',
    skip_empty_lines: true,
    relax_column_count: true,
  })

  return rows.map((row) => Schema.decodeUnknownSync(OpenNgcRowSchema)(row))
}
