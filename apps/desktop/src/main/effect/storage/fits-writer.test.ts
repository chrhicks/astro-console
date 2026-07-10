import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Effect } from 'effect'
import { writeFits, type FrameDescriptor } from './fits-writer'

// Runs writeFits and returns the serialized FITS bytes.
function serialize(
  data: Uint8Array,
  frame: FrameDescriptor,
): Promise<Uint8Array> {
  return Effect.runPromise(writeFits(data, frame))
}

// Parses a FITS primary HDU header block and returns the keyword/value cards
// up to END, plus the byte offset where pixel data begins (next 2880-byte
// block boundary after END).
function parseFitsHeader(
  bytes: Uint8Array,
): { cards: Map<string, number | boolean>; dataStart: number } {
  const cards = new Map<string, number | boolean>()
  let endLine = -1
  const cardCount = Math.floor(bytes.length / 80)
  for (let i = 0; i < cardCount; i++) {
    const card = Buffer.from(bytes.buffer, bytes.byteOffset + i * 80, 80)
      .toString('ascii')
    const keyword = card.slice(0, 8).trim()
    if (keyword === 'END') {
      endLine = i
      break
    }
    if (card[8] !== '=' || card[9] !== ' ') continue
    const rest = card.slice(10)
    const slash = rest.indexOf('/')
    const raw = (slash >= 0 ? rest.slice(0, slash) : rest).trim()
    if (raw === 'T') cards.set(keyword, true)
    else if (raw === 'F') cards.set(keyword, false)
    else cards.set(keyword, Number(raw))
  }
  assert.notEqual(endLine, -1, 'END card not found')
  const dataStart = Math.ceil((endLine + 1) * 80 / 2880) * 2880
  return { cards, dataStart }
}

// Builds a little-endian Uint16 pixel buffer from physical unsigned values.
function leUint16Frame(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 2)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < values.length; i++) {
    view.setUint16(i * 2, values[i], true)
  }
  return buf
}

// Builds a little-endian Uint32 pixel buffer from physical unsigned values.
function leUint32Frame(values: number[]): Uint8Array {
  const buf = new Uint8Array(values.length * 4)
  const view = new DataView(buf.buffer)
  for (let i = 0; i < values.length; i++) {
    view.setUint32(i * 4, values[i], true)
  }
  return buf
}

// Reads a big-endian Int16 from the FITS data block at the given element index.
function readBeInt16(bytes: Uint8Array, offset: number, index: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getInt16(offset + index * 2, false)
}

// Reads a big-endian Int32 from the FITS data block at the given element index.
function readBeInt32(bytes: Uint8Array, offset: number, index: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return view.getInt32(offset + index * 4, false)
}

describe('writeFits UInt16 BZERO serialization', () => {
  // elementType 8 = UInt16, BZERO = 32768, BITPIX = 16
  const frame = (width: number, height: number): FrameDescriptor => ({
    width,
    height,
    rank: 2,
    elementType: 8,
  })

  it('stores zero as -BZERO (Int16 min)', async () => {
    const data = leUint16Frame([0])
    const fits = await serialize(data, frame(1, 1))
    const { cards, dataStart } = parseFitsHeader(fits)
    assert.equal(cards.get('BITPIX'), 16)
    assert.equal(cards.get('BZERO'), 32768)
    const stored = readBeInt16(fits, dataStart, 0)
    assert.equal(stored, -32768)
    assert.equal(stored + 32768, 0)
  })

  it('stores midpoint (32768) as zero', async () => {
    const data = leUint16Frame([32768])
    const fits = await serialize(data, frame(1, 1))
    const { dataStart } = parseFitsHeader(fits)
    const stored = readBeInt16(fits, dataStart, 0)
    assert.equal(stored, 0)
    assert.equal(stored + 32768, 32768)
  })

  it('stores max (65535) as Int16 max', async () => {
    const data = leUint16Frame([65535])
    const fits = await serialize(data, frame(1, 1))
    const { dataStart } = parseFitsHeader(fits)
    const stored = readBeInt16(fits, dataStart, 0)
    assert.equal(stored, 32767)
    assert.equal(stored + 32768, 65535)
  })

  it('round-trips zero, midpoint, and max in one frame', async () => {
    const physical = [0, 32768, 65535]
    const data = leUint16Frame(physical)
    const fits = await serialize(data, frame(3, 1))
    const { dataStart } = parseFitsHeader(fits)
    for (let i = 0; i < physical.length; i++) {
      const stored = readBeInt16(fits, dataStart, i)
      assert.equal(stored + 32768, physical[i], `element ${i}`)
    }
  })
})

describe('writeFits UInt32 BZERO serialization', () => {
  // elementType 9 = UInt32, BZERO = 2147483648, BITPIX = 32
  const frame = (width: number, height: number): FrameDescriptor => ({
    width,
    height,
    rank: 2,
    elementType: 9,
  })

  it('stores zero as -BZERO (Int32 min)', async () => {
    const data = leUint32Frame([0])
    const fits = await serialize(data, frame(1, 1))
    const { cards, dataStart } = parseFitsHeader(fits)
    assert.equal(cards.get('BITPIX'), 32)
    assert.equal(cards.get('BZERO'), 2147483648)
    const stored = readBeInt32(fits, dataStart, 0)
    assert.equal(stored, -2147483648)
    assert.equal(stored + 2147483648, 0)
  })

  it('stores midpoint (2147483648) as zero', async () => {
    const data = leUint32Frame([2147483648])
    const fits = await serialize(data, frame(1, 1))
    const { dataStart } = parseFitsHeader(fits)
    const stored = readBeInt32(fits, dataStart, 0)
    assert.equal(stored, 0)
    assert.equal(stored + 2147483648, 2147483648)
  })

  it('stores max (4294967295) as Int32 max', async () => {
    const data = leUint32Frame([4294967295])
    const fits = await serialize(data, frame(1, 1))
    const { dataStart } = parseFitsHeader(fits)
    const stored = readBeInt32(fits, dataStart, 0)
    assert.equal(stored, 2147483647)
    assert.equal(stored + 2147483648, 4294967295)
  })

  it('round-trips zero, midpoint, and max in one frame', async () => {
    const physical = [0, 2147483648, 4294967295]
    const data = leUint32Frame(physical)
    const fits = await serialize(data, frame(3, 1))
    const { dataStart } = parseFitsHeader(fits)
    for (let i = 0; i < physical.length; i++) {
      const stored = readBeInt32(fits, dataStart, i)
      assert.equal(stored + 2147483648, physical[i], `element ${i}`)
    }
  })
})

describe('writeFits signed Int16 byte swap', () => {
  // elementType 1 = Int16, no BZERO. Verifies pure little-endian → big-endian
  // conversion without value offset.
  const frame = (width: number, height: number): FrameDescriptor => ({
    width,
    height,
    rank: 2,
    elementType: 1,
  })

  it('byte-swaps little-endian Int16 to big-endian without offset', async () => {
    // LE bytes 0x01 0xFF → physical -255 as Int16 LE → BE 0xFF 0x01
    const data = new Uint8Array([0x01, 0xff])
    const fits = await serialize(data, frame(1, 1))
    const { cards, dataStart } = parseFitsHeader(fits)
    assert.equal(cards.get('BITPIX'), 16)
    assert.equal(cards.get('BZERO'), undefined)
    const stored = readBeInt16(fits, dataStart, 0)
    assert.equal(stored, -255)
  })
})

describe('writeFits rejects unsafe geometry', () => {
  it('fails on mismatched data length', async () => {
    const data = leUint16Frame([0])
    await assert.rejects(
      serialize(data, { width: 2, height: 1, rank: 2, elementType: 8 }),
      /does not match expected/,
    )
  })

  it('fails on unsupported element type', async () => {
    const data = new Uint8Array(2)
    await assert.rejects(
      serialize(data, { width: 1, height: 1, rank: 2, elementType: 99 }),
      /Unsupported Alpaca transmission element type/,
    )
  })
})
