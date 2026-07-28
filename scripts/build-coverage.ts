import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf, type Bbox } from '../src/geo/bounds.ts'
import { densifyTrace } from '../src/coverage/densify.ts'
import { PointGrid } from '../src/coverage/grid.ts'
import { computeNodeHits, wayHits } from '../src/coverage/nodes.ts'
import { wayCoverage } from '../src/coverage/segments.ts'
import {
  COVERAGE_SNAPSHOT_VERSION,
  packCoverage,
  validateCoverage,
  type CoverageManifest,
  type PackedWay,
  type RegionCoverage,
} from '../src/coverage/snapshot.ts'
import type { RidesManifest } from '../src/rides/snapshot.ts'
import { loadRegionSources } from './networkSource.ts'

const RIDES_DIR = join(process.cwd(), 'public', 'rides')
const NETWORK_DIR = join(process.cwd(), 'public', 'network')
const OUT_DIR = join(process.cwd(), 'public', 'coverage')

const DEFAULT_RADIUS_METERS = 25

function parseRadius(argv: string[]): number {
  const i = argv.indexOf('--radius')
  if (i === -1) return DEFAULT_RADIUS_METERS
  const value = Number(argv[i + 1])
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`--radius needs a positive number, got "${argv[i + 1]}"`)
  }
  return value
}

/**
 * Maximum spacing between ride points before matching.
 *
 * The archive's traces have a median gap of ~23 m and a tail past 250 m, so a
 * node in the middle of a gap is missed even though the rider rode over it.
 * Densifying to 10 m makes the point test approximate a line test to within
 * 5 m, comfortably inside the 25 m radius.
 */
const DENSIFY_METERS = 10

async function loadRides(): Promise<{
  manifest: RidesManifest
  positions: Float64Array
  startIndices: Uint32Array
}> {
  let manifest: RidesManifest
  try {
    manifest = JSON.parse(await readFile(join(RIDES_DIR, 'manifest.json'), 'utf8'))
  } catch {
    throw new Error(
      `No rides snapshot at ${RIDES_DIR}. Run "npm run import:rides" then "npm run build:rides" first.`,
    )
  }

  const buf = await readFile(join(RIDES_DIR, 'positions.bin'))
  if (buf.byteLength !== manifest.byteLengths.positions) {
    throw new Error(
      `rides positions.bin is ${buf.byteLength} bytes, manifest declares ${manifest.byteLengths.positions}. Re-run build:rides.`,
    )
  }
  const positions = new Float64Array(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  )

  const idxBuf = await readFile(join(RIDES_DIR, 'startIndices.bin'))
  const startIndices = new Uint32Array(
    idxBuf.buffer.slice(idxBuf.byteOffset, idxBuf.byteOffset + idxBuf.byteLength),
  )

  return { manifest, positions, startIndices }
}

/**
 * The rendered snapshot's way count per region. Coverage computed over a
 * different way set would produce a percentage that does not describe the
 * visible map, so a mismatch stops the build.
 */
async function renderedWayCounts(): Promise<Map<string, number>> {
  const index = JSON.parse(await readFile(join(NETWORK_DIR, 'index.json'), 'utf8')) as {
    regions: { id: string; wayCount: number }[]
  }
  return new Map(index.regions.map((r) => [r.id, r.wayCount]))
}

async function main(): Promise<void> {
  const radiusMeters = parseRadius(process.argv.slice(2))

  const { manifest: rides, positions: rawPositions, startIndices } = await loadRides()
  const sources = await loadRegionSources()
  const rendered = await renderedWayCounts()

  const ridePositions = densifyTrace(rawPositions, startIndices, DENSIFY_METERS)
  const densifiedCount = ridePositions.length / 2

  const rideBbox: Bbox =
    ridePositions.length > 0
      ? bboxOf(ridePositions)
      : { minLon: 0, minLat: 0, maxLon: 0, maxLat: 0 }
  const grid = new PointGrid(ridePositions, radiusMeters, rideBbox)

  console.log(
    `${rides.pointCount.toLocaleString()} ride points from ${rides.rideCount} rides, ` +
      `densified to ${densifiedCount.toLocaleString()} at <=${DENSIFY_METERS} m spacing\n` +
      `indexed into ${grid.cellCount.toLocaleString()} cells at r=${radiusMeters} m\n`,
  )

  await mkdir(OUT_DIR, { recursive: true })

  const regions: RegionCoverage[] = []
  const startedAt = Date.now()

  for (const source of sources) {
    const { region, ways, uniqueNodeCount } = source

    const expectedWays = rendered.get(region.id)
    if (expectedWays !== undefined && expectedWays !== ways.length) {
      throw new Error(
        `Region "${region.id}" has ${ways.length} ways here but the rendered ` +
          `snapshot declares ${expectedWays}. Re-run build:snapshot so the ` +
          `denominator matches the map.`,
      )
    }

    const { hitNodeIds } = computeNodeHits(ways, grid, radiusMeters)

    const packedWays: PackedWay[] = []
    let totalMeters = 0
    let coveredMeters = 0
    let waysComplete = 0

    for (const way of ways) {
      const hits = wayHits(way, hitNodeIds)
      const cov = wayCoverage(way.coords, hits)
      totalMeters += cov.totalMeters
      coveredMeters += cov.coveredMeters
      if (cov.complete) waysComplete++
      packedWays.push({ coords: way.coords, runs: cov.runs })
    }

    if (coveredMeters > totalMeters + 1e-6) {
      throw new Error(
        `Region "${region.id}" reports ${coveredMeters} covered metres of ${totalMeters} total.`,
      )
    }

    const buffers = packCoverage(packedWays)
    const runCount = buffers.flags.length

    const entry: RegionCoverage = {
      regionId: region.id,
      regionName: region.name,
      group: region.group,
      wayCount: ways.length,
      uniqueNodeCount,
      nodesHit: hitNodeIds.size,
      waysComplete,
      totalMeters,
      coveredMeters,
      runCount,
      riddenRunCount: buffers.flags.reduce((s: number, f: number) => s + f, 0),
      positionCount: buffers.startIndices[runCount],
      byteLengths: {
        positions: buffers.positions.byteLength,
        startIndices: buffers.startIndices.byteLength,
        flags: buffers.flags.byteLength,
      },
    }

    const dir = join(OUT_DIR, region.id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'positions.bin'), Buffer.from(buffers.positions.buffer))
    await writeFile(join(dir, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
    await writeFile(join(dir, 'flags.bin'), Buffer.from(buffers.flags.buffer))

    regions.push(entry)

    const pct = totalMeters === 0 ? 0 : (coveredMeters / totalMeters) * 100
    console.log(
      `ok  ${region.id.padEnd(24)} ${pct.toFixed(2).padStart(6)}%  ` +
        `${(coveredMeters / 1000).toFixed(0).padStart(5)}/${(totalMeters / 1000).toFixed(0).padEnd(5)} km  ` +
        `nodes ${entry.nodesHit.toLocaleString().padStart(7)}/${uniqueNodeCount.toLocaleString().padEnd(7)}  ` +
        `complete ${String(waysComplete).padStart(5)}/${String(ways.length).padEnd(5)}  ` +
        `runs ${runCount.toLocaleString()}`,
    )
  }

  const core = regions.filter((r) => r.group === 'metro-core')
  const totals = {
    wayCount: core.reduce((s, r) => s + r.wayCount, 0),
    uniqueNodeCount: core.reduce((s, r) => s + r.uniqueNodeCount, 0),
    nodesHit: core.reduce((s, r) => s + r.nodesHit, 0),
    waysComplete: core.reduce((s, r) => s + r.waysComplete, 0),
    totalMeters: core.reduce((s, r) => s + r.totalMeters, 0),
    coveredMeters: core.reduce((s, r) => s + r.coveredMeters, 0),
  }

  const manifest: CoverageManifest = {
    version: COVERAGE_SNAPSHOT_VERSION,
    generatedAt: new Date().toISOString(),
    radiusMeters,
    ridesSnapshotVersion: rides.version,
    rideCount: rides.rideCount,
    ridePointCount: rides.pointCount,
    densifiedPointCount: densifiedCount,
    densifyMeters: DENSIFY_METERS,
    regions,
    totals,
  }

  // Catch a bad build here rather than in the browser.
  for (const region of regions) {
    const dir = join(OUT_DIR, region.regionId)
    const positions = await readFile(join(dir, 'positions.bin'))
    const startIndices = await readFile(join(dir, 'startIndices.bin'))
    const flags = await readFile(join(dir, 'flags.bin'))
    validateCoverage(manifest, region, {
      positions: new Float64Array(
        positions.buffer.slice(positions.byteOffset, positions.byteOffset + positions.byteLength),
      ),
      startIndices: new Uint32Array(
        startIndices.buffer.slice(
          startIndices.byteOffset,
          startIndices.byteOffset + startIndices.byteLength,
        ),
      ),
      flags: new Uint8Array(
        flags.buffer.slice(flags.byteOffset, flags.byteOffset + flags.byteLength),
      ),
    })
  }

  await writeFile(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2))

  const pct = (totals.coveredMeters / totals.totalMeters) * 100
  const nodePct = (totals.nodesHit / totals.uniqueNodeCount) * 100
  const bytes = regions.reduce(
    (s, r) => s + r.byteLengths.positions + r.byteLengths.startIndices + r.byteLengths.flags,
    0,
  )

  console.log(
    `\n${pct.toFixed(2)}% of ${(totals.totalMeters / 1000).toFixed(0)} km ` +
      `(${(totals.coveredMeters / 1000).toFixed(0)} km ridden) across ${core.length} metro-core regions\n` +
      `nodes hit  ${totals.nodesHit.toLocaleString()}/${totals.uniqueNodeCount.toLocaleString()} (${nodePct.toFixed(2)}%)\n` +
      `ways complete  ${totals.waysComplete.toLocaleString()}/${totals.wayCount.toLocaleString()}\n` +
      `${(bytes / 1e6).toFixed(2)} MB in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
