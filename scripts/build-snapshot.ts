import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf } from '../src/geo/bounds.ts'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import { normalize, type OsmElement } from '../src/network/normalize.ts'
import { HIGHWAY_CLASSES, REGIONS, regionById } from '../src/network/regions.ts'
import {
  SNAPSHOT_VERSION,
  packSnapshot,
  validateSnapshot,
  type SnapshotManifest,
} from '../src/network/snapshot.ts'

const RAW_DIR = join(process.cwd(), 'data', 'raw')
const OUT_DIR = join(process.cwd(), 'public', 'network')

type RawPayload = {
  regionId: string
  fetchedAt: string
  osmTimestamp: string
  queryHash: string
  elements: OsmElement[]
}

type IndexEntry = {
  id: string
  name: string
  group: string
  wayCount: number
  positionCount: number
  totalMeters: number
  bytes: number
}

async function buildRegion(
  rawFile: string,
  claimed: Set<number>,
): Promise<IndexEntry> {
  const raw = JSON.parse(await readFile(join(RAW_DIR, rawFile), 'utf8')) as RawPayload
  const region = regionById(raw.regionId)
  if (!region) throw new Error(`Raw file references unknown region "${raw.regionId}"`)

  const network = normalize(raw.elements)

  // Polygon regions overlap the boundary regions they surround, and a way on a
  // shared border can fall in two boundaries. Assign each way to exactly one
  // region by REGIONS order so the headline denominator cannot double-count.
  const before = network.ways.length
  network.ways = network.ways.filter((w) => !claimed.has(w.id))
  const deduped = before - network.ways.length
  for (const w of network.ways) claimed.add(w.id)

  if (network.ways.length === 0) {
    throw new Error(
      `Region "${region.id}" has no ways left after dedup (${before} were all claimed by earlier regions)`,
    )
  }

  const buffers = packSnapshot(network.ways)

  let totalMeters = 0
  for (let i = 0; i < network.ways.length; i++) {
    totalMeters += pathLengthMeters(
      buffers.positions,
      buffers.startIndices[i],
      buffers.startIndices[i + 1],
    )
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    regionId: region.id,
    regionName: region.name,
    group: region.group,
    osmId: region.osmId,
    osmKind: region.osmKind,
    generatedAt: new Date().toISOString(),
    osmTimestamp: raw.osmTimestamp,
    queryHash: raw.queryHash,
    bbox: bboxOf(buffers.positions),
    wayCount: network.ways.length,
    positionCount: buffers.startIndices[network.ways.length],
    uniqueNodeCount: network.uniqueNodeCount,
    totalMeters,
    classes: [...HIGHWAY_CLASSES],
    byteLengths: {
      positions: buffers.positions.byteLength,
      startIndices: buffers.startIndices.byteLength,
      wayIds: buffers.wayIds.byteLength,
      classes: buffers.classes.byteLength,
    },
  }

  // Catch a bad build here rather than in the browser.
  validateSnapshot(manifest, buffers)

  const dir = join(OUT_DIR, region.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(dir, 'positions.bin'), Buffer.from(buffers.positions.buffer))
  await writeFile(join(dir, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
  await writeFile(join(dir, 'wayIds.bin'), Buffer.from(buffers.wayIds.buffer))
  await writeFile(join(dir, 'classes.bin'), Buffer.from(buffers.classes.buffer))

  const bytes =
    manifest.byteLengths.positions +
    manifest.byteLengths.startIndices +
    manifest.byteLengths.wayIds +
    manifest.byteLengths.classes

  const km = (totalMeters / 1000).toFixed(0)
  const mb = (bytes / 1e6).toFixed(2)
  console.log(
    `ok  ${region.id.padEnd(18)} ways=${String(network.ways.length).padEnd(6)} ` +
      `verts=${String(manifest.positionCount).padEnd(7)} uniq=${String(network.uniqueNodeCount).padEnd(7)} ` +
      `dropped=${String(network.droppedWays).padEnd(5)} dedup=${String(deduped).padEnd(5)} ${km}km ${mb}MB`,
  )

  return {
    id: region.id,
    name: region.name,
    group: region.group,
    wayCount: network.ways.length,
    positionCount: manifest.positionCount,
    totalMeters,
    bytes,
  }
}

async function main(): Promise<void> {
  let files: string[]
  try {
    files = (await readdir(RAW_DIR)).filter((f) => f.endsWith('.json')).sort()
  } catch {
    throw new Error(`No raw data at ${RAW_DIR}. Run "npm run fetch:network -- --group metro-core" first.`)
  }
  if (files.length === 0) {
    throw new Error(`No raw data at ${RAW_DIR}. Run "npm run fetch:network -- --group metro-core" first.`)
  }

  await mkdir(OUT_DIR, { recursive: true })

  // REGIONS order is the dedup precedence: boundary regions claim their ways
  // before any polygon catch-all sees them.
  const present = new Set(files.map((f) => f.slice(0, -5)))
  const ordered = REGIONS.filter((r) => present.has(r.id)).map((r) => `${r.id}.json`)
  const unknown = files.filter((f) => !ordered.includes(f))
  if (unknown.length > 0) {
    throw new Error(`Raw files for regions not in the registry: ${unknown.join(', ')}`)
  }

  const claimed = new Set<number>()
  const entries: IndexEntry[] = []
  for (const file of ordered) entries.push(await buildRegion(file, claimed))

  entries.sort((a, b) => b.wayCount - a.wayCount)
  await writeFile(
    join(OUT_DIR, 'index.json'),
    JSON.stringify({ version: SNAPSHOT_VERSION, generatedAt: new Date().toISOString(), regions: entries }, null, 2),
  )

  const totalWays = entries.reduce((s, e) => s + e.wayCount, 0)
  const totalVerts = entries.reduce((s, e) => s + e.positionCount, 0)
  const totalBytes = entries.reduce((s, e) => s + e.bytes, 0)
  const totalKm = entries.reduce((s, e) => s + e.totalMeters, 0) / 1000

  console.log(
    `\n${entries.length} regions — ${totalWays} ways, ${totalVerts} vertices, ` +
      `${totalKm.toFixed(0)} km, ${(totalBytes / 1e6).toFixed(2)} MB`,
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
