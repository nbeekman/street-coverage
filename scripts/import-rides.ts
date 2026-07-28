import { gunzipSync } from 'node:zlib'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import { classifyTrack, isInRegion, padBbox, type RejectReason } from '../src/rides/filter.ts'
import { clipEnds } from '../src/rides/privacy.ts'
import { resampleByDistance } from '../src/rides/resample.ts'
import type { RawTrack } from '../src/rides/types.ts'
import { parseFit } from './fit.ts'
import { parseGpx } from './gpx.ts'

const OUT_DIR = join(process.cwd(), 'data', 'rides')
const NETWORK_DIR = join(process.cwd(), 'public', 'network')

const DEFAULT_CLIP_METERS = 500
const DEFAULT_RESAMPLE_METERS = 10
const REGION_PAD_METERS = 5000

type Args = {
  source: string
  clipMeters: number
  resampleMeters: number
  /** Restore the old behavior: reject rides outside the metro entirely. */
  metroOnly: boolean
}

function parseArgs(argv: string[]): Args {
  let source = ''
  let clipMeters = DEFAULT_CLIP_METERS
  let resampleMeters = DEFAULT_RESAMPLE_METERS
  let metroOnly = false

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--archive' || argv[i] === '--dir') source = argv[i + 1] ?? ''
    if (argv[i] === '--clip-meters') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n < 0) throw new Error('--clip-meters expects a number >= 0')
      clipMeters = n
    }
    if (argv[i] === '--metro-only') metroOnly = true
    if (argv[i] === '--resample-meters') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n < 0) throw new Error('--resample-meters expects a number >= 0')
      resampleMeters = n
    }
  }

  if (!source) throw new Error('Specify --dir <path> pointing at a directory of activity files')
  return { source, clipMeters, resampleMeters, metroOnly }
}

/** Union bbox of the metro-core regions, padded. Rides outside it are not ours. */
async function metroRegion() {
  const dirs = (await readdir(NETWORK_DIR, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)

  let minLon = Infinity
  let minLat = Infinity
  let maxLon = -Infinity
  let maxLat = -Infinity
  let found = 0

  for (const d of dirs) {
    const m = JSON.parse(await readFile(join(NETWORK_DIR, d, 'manifest.json'), 'utf8'))
    if (m.group !== 'metro-core') continue
    found++
    minLon = Math.min(minLon, m.bbox.minLon)
    minLat = Math.min(minLat, m.bbox.minLat)
    maxLon = Math.max(maxLon, m.bbox.maxLon)
    maxLat = Math.max(maxLat, m.bbox.maxLat)
  }

  if (found === 0) {
    throw new Error(
      'No metro-core network snapshots found. Run the M1 pipeline first: npm run fetch:network -- --group metro-core && npm run build:snapshot',
    )
  }
  return padBbox({ minLon, minLat, maxLon, maxLat }, REGION_PAD_METERS)
}

async function parseFile(path: string, id: string): Promise<RawTrack | null> {
  let buf = await readFile(path)
  let ext = extname(path).toLowerCase()

  if (ext === '.gz') {
    // Activity files are a few hundred KB; a sync inflate is simpler than a
    // stream pipeline and the import is already sequential.
    buf = gunzipSync(buf)
    ext = extname(basename(path, '.gz')).toLowerCase()
  }

  if (ext === '.fit') return parseFit(new Uint8Array(buf), id)
  if (ext === '.gpx') return parseGpx(buf.toString('utf8'), id)
  return null
}

async function main(): Promise<void> {
  const { source, clipMeters, resampleMeters, metroOnly } = parseArgs(process.argv.slice(2))
  const region = await metroRegion()
  await mkdir(OUT_DIR, { recursive: true })

  const entries = (await readdir(source, { withFileTypes: true }))
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort()

  const rejected: Record<RejectReason, number> = {
    'no-positions': 0,
    virtual: 0,
    'out-of-region': 0,
    'too-short-after-clip': 0,
  }
  let imported = 0
  let outOfRegion = 0
  let unsupported = 0
  let failed = 0
  let totalMeters = 0

  for (const name of entries) {
    const id = basename(name).replace(/\.(fit|gpx|tcx)(\.gz)?$/i, '')
    let track: RawTrack | null
    try {
      track = await parseFile(join(source, name), id)
    } catch (error) {
      // One corrupt file must not abandon a 225-ride import.
      console.error(`  skip  ${name} — ${String(error)}`)
      failed++
      continue
    }
    if (!track) {
      unsupported++
      continue
    }

    const reason = classifyTrack(track, region, { requireRegion: metroOnly })
    if (reason) {
      rejected[reason]++
      continue
    }

    const inRegion = isInRegion(track, region)

    // Clip BEFORE any write: unclipped coordinates never reach disk.
    const clipped = clipEnds(track.points, clipMeters)
    if (clipped.length < 2) {
      rejected['too-short-after-clip']++
      continue
    }

    const points = resampleByDistance(clipped, resampleMeters)
    const flat = new Float64Array(points.length * 2)
    for (let i = 0; i < points.length; i++) {
      flat[i * 2] = points[i].lon
      flat[i * 2 + 1] = points[i].lat
    }
    totalMeters += pathLengthMeters(flat, 0, points.length)

    await writeFile(
      join(OUT_DIR, `${id}.json`),
      JSON.stringify({ id, startTime: track.startTime, points, inRegion }),
    )
    if (!inRegion) outOfRegion++
    imported++
  }

  await writeFile(
    join(OUT_DIR, '_meta.json'),
    JSON.stringify({ clipMeters, resampleMeters, rejected, outOfRegion, metroOnly, importedAt: new Date().toISOString() }, null, 2),
  )

  console.log(`\nimported ${imported} rides, ${(totalMeters / 1000).toFixed(0)} km (clip ${clipMeters}m, resample ${resampleMeters}m)`)
  if (outOfRegion > 0) console.log(`  of those, ${outOfRegion} are outside the metro -- they render but score no coverage`)
  console.log(
    `rejected: virtual ${rejected.virtual}, out-of-region ${rejected['out-of-region']}, ` +
      `no-positions ${rejected['no-positions']}, too-short-after-clip ${rejected['too-short-after-clip']}`,
  )
  if (unsupported > 0) console.log(`skipped ${unsupported} unsupported files (.tcx etc.)`)
  if (failed > 0) console.log(`failed to parse ${failed} files`)
  if (imported === 0) {
    console.error('\nNothing imported. If every ride was rejected as out-of-region, the rides may belong to a region the network pipeline has not fetched.')
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
