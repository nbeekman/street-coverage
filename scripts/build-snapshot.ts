import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bboxOf, centerOf, toLngLatOffsets } from '../src/geo/bounds.ts'
import { pathLengthMeters } from '../src/geo/haversine.ts'
import { HIGHWAY_CLASSES } from '../src/network/regions.ts'
import {
  SNAPSHOT_VERSION,
  packSnapshot,
  validateSnapshot,
  type SnapshotManifest,
} from '../src/network/snapshot.ts'
import { loadRegionSources, type RegionSource } from './networkSource.ts'

const OUT_DIR = join(process.cwd(), 'public', 'network')

type IndexEntry = {
  id: string
  name: string
  group: string
  wayCount: number
  positionCount: number
  totalMeters: number
  bytes: number
}

async function buildRegion(source: RegionSource): Promise<IndexEntry> {
  const { region, ways, uniqueNodeCount } = source
  const buffers = packSnapshot(ways)

  let totalMeters = 0
  for (let i = 0; i < ways.length; i++) {
    totalMeters += pathLengthMeters(
      buffers.positions,
      buffers.startIndices[i],
      buffers.startIndices[i + 1],
    )
  }

  // Derive the render origin here rather than in the browser: it comes from
  // the bbox, and shipping Float32 offsets means the browser never sees the
  // Float64 positions it would otherwise need to compute one.
  const bbox = bboxOf(buffers.positions)
  const origin = centerOf(bbox)
  const offsets = toLngLatOffsets(buffers.positions, origin)

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_VERSION,
    regionId: region.id,
    regionName: region.name,
    group: region.group,
    osmId: region.osmId,
    osmKind: region.osmKind,
    generatedAt: new Date().toISOString(),
    osmTimestamp: source.osmTimestamp,
    queryHash: source.queryHash,
    bbox,
    origin,
    wayCount: ways.length,
    positionCount: buffers.startIndices[ways.length],
    uniqueNodeCount,
    totalMeters,
    classes: [...HIGHWAY_CLASSES],
    byteLengths: {
      offsets: offsets.byteLength,
      startIndices: buffers.startIndices.byteLength,
      classes: buffers.classes.byteLength,
    },
  }

  // Catch a bad build here rather than in the browser.
  validateSnapshot(manifest, { offsets, startIndices: buffers.startIndices, classes: buffers.classes })

  const dir = join(OUT_DIR, region.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2))
  await writeFile(join(dir, 'offsets.bin'), Buffer.from(offsets.buffer))
  await writeFile(join(dir, 'startIndices.bin'), Buffer.from(buffers.startIndices.buffer))
  await writeFile(join(dir, 'wayIds.bin'), Buffer.from(buffers.wayIds.buffer))
  await writeFile(join(dir, 'classes.bin'), Buffer.from(buffers.classes.buffer))

  // What a visitor downloads, not what the build wrote: wayIds stays on disk
  // for offline use but is never fetched.
  const bytes =
    manifest.byteLengths.offsets +
    manifest.byteLengths.startIndices +
    manifest.byteLengths.classes

  const km = (totalMeters / 1000).toFixed(0)
  const mb = (bytes / 1e6).toFixed(2)
  console.log(
    `ok  ${region.id.padEnd(18)} ways=${String(ways.length).padEnd(6)} ` +
      `verts=${String(manifest.positionCount).padEnd(7)} uniq=${String(uniqueNodeCount).padEnd(7)} ` +
      `dropped=${String(source.droppedWays).padEnd(5)} dedup=${String(source.dedupedWays).padEnd(5)} ${km}km ${mb}MB`,
  )

  return {
    id: region.id,
    name: region.name,
    group: region.group,
    wayCount: ways.length,
    positionCount: manifest.positionCount,
    totalMeters,
    bytes,
  }
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true })

  const sources = await loadRegionSources()
  const entries: IndexEntry[] = []
  for (const source of sources) entries.push(await buildRegion(source))

  entries.sort((a, b) => b.wayCount - a.wayCount)
  await writeFile(
    join(OUT_DIR, 'index.json'),
    JSON.stringify(
      { version: SNAPSHOT_VERSION, generatedAt: new Date().toISOString(), regions: entries },
      null,
      2,
    ),
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
