import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf } from '../src/geo/bounds.ts'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import type { RejectReason } from '../src/rides/filter.ts'
import {
  RIDES_SNAPSHOT_VERSION,
  packRides,
  validateRides,
  type RidesManifest,
} from '../src/rides/snapshot.ts'
import type { Ride } from '../src/rides/types.ts'

const IN_DIR = join(process.cwd(), 'data', 'rides')
const OUT_DIR = join(process.cwd(), 'public', 'rides')

async function main(): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(IN_DIR))
      .filter((f) => f.endsWith('.json') && f !== '_meta.json')
      .sort()
  } catch {
    throw new Error(`No imported rides at ${IN_DIR}. Run "npm run import:rides -- --dir <path>" first.`)
  }
  if (files.length === 0) {
    throw new Error(`No imported rides at ${IN_DIR}. Run "npm run import:rides -- --dir <path>" first.`)
  }

  const rides: Ride[] = []
  for (const f of files) {
    rides.push(JSON.parse(await readFile(join(IN_DIR, f), 'utf8')) as Ride)
  }
  // Chronological order makes the M6 scrubber a prefix scan.
  rides.sort((a, b) => a.startTime - b.startTime)

  const buffers = packRides(rides)

  let totalMeters = 0
  for (let i = 0; i < rides.length; i++) {
    totalMeters += pathLengthMeters(
      buffers.positions,
      buffers.startIndices[i],
      buffers.startIndices[i + 1],
    )
  }

  const empty: Record<RejectReason, number> = {
    'no-positions': 0, virtual: 0, 'out-of-region': 0, 'too-short-after-clip': 0,
  }
  let meta = { clipMeters: -1, resampleMeters: -1, rejected: empty }
  try {
    meta = { ...meta, ...JSON.parse(await readFile(join(IN_DIR, '_meta.json'), 'utf8')) }
  } catch {
    console.warn('  no _meta.json; clip/resample settings will be reported as unknown')
  }

  const manifest: RidesManifest = {
    version: RIDES_SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    rideCount: rides.length,
    pointCount: buffers.startIndices[rides.length],
    totalMeters,
    clipMeters: meta.clipMeters,
    resampleMeters: meta.resampleMeters,
    bbox: bboxOf(buffers.positions),
    rejected: meta.rejected,
    byteLengths: {
      positions: buffers.positions.byteLength,
      startIndices: buffers.startIndices.byteLength,
      times: buffers.times.byteLength,
    },
  }

  validateRides(manifest, buffers)

  await mkdir(OUT_DIR, { recursive: true })
  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(OUT_DIR, 'positions.bin'), Buffer.from(buffers.positions.buffer))
  await writeFile(join(OUT_DIR, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
  await writeFile(join(OUT_DIR, 'times.bin'), Buffer.from(buffers.times.buffer))

  const bytes =
    manifest.byteLengths.positions + manifest.byteLengths.startIndices + manifest.byteLengths.times
  console.log(
    `${rides.length} rides — ${manifest.pointCount} points, ` +
      `${(totalMeters / 1000).toFixed(0)} km, ${(bytes / 1e6).toFixed(2)} MB`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
