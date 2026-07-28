import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fetchRegion } from './overpass.ts'
import {
  REGIONS,
  buildOverpassQuery,
  regionById,
  regionsInGroup,
  type Region,
  type RegionGroup,
} from '../src/network/regions.ts'

const RAW_DIR = join(process.cwd(), 'data', 'raw')

type Args = { regions: Region[]; force: boolean }

function parseArgs(argv: string[]): Args {
  const force = argv.includes('--force')
  const regions: Region[] = []

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--region') {
      const region = regionById(argv[i + 1])
      if (!region) throw new Error(`Unknown region "${argv[i + 1]}"`)
      regions.push(region)
    }
    if (argv[i] === '--group') {
      const group = argv[i + 1] as RegionGroup
      const found = regionsInGroup(group)
      if (found.length === 0) throw new Error(`No regions in group "${group}"`)
      regions.push(...found)
    }
    if (argv[i] === '--all') regions.push(...REGIONS)
  }

  if (regions.length === 0) {
    throw new Error(
      'Specify --region <id>, --group <metro-core|metro-outer|mountain|route>, or --all',
    )
  }
  return { regions, force }
}

async function alreadyFetched(): Promise<Set<string>> {
  try {
    const files = await readdir(RAW_DIR)
    return new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
  } catch {
    return new Set()
  }
}

async function main(): Promise<void> {
  const { regions, force } = parseArgs(process.argv.slice(2))
  await mkdir(RAW_DIR, { recursive: true })
  const done = await alreadyFetched()

  let fetched = 0
  let skipped = 0
  const failures: string[] = []

  for (const region of regions) {
    if (!force && done.has(region.id)) {
      console.log(`skip     ${region.id} (already fetched; use --force to refetch)`)
      skipped++
      continue
    }

    const started = Date.now()
    try {
      const response = await fetchRegion(region, {
        onAttempt: ({ attempt, url }) =>
          console.log(`  ...     ${region.id} attempt ${attempt + 1} → ${new URL(url).host}`),
        onAttemptFailed: ({ ms, error }) =>
          console.log(`  fail    ${region.id} after ${(ms / 1000).toFixed(1)}s — ${String(error)}`),
      })
      const query = buildOverpassQuery(region)
      const payload = {
        regionId: region.id,
        fetchedAt: new Date().toISOString(),
        osmTimestamp: response.osm3s?.timestamp_osm_base ?? 'unknown',
        queryHash: createHash('sha256').update(query).digest('hex').slice(0, 16),
        query,
        elements: response.elements,
      }
      // Write per region as it lands so a run that dies at region 6 does not
      // restart from region 1.
      await writeFile(join(RAW_DIR, `${region.id}.json`), JSON.stringify(payload))

      const ways = response.elements.filter((e) => e.type === 'way').length
      const secs = ((Date.now() - started) / 1000).toFixed(1)
      console.log(`ok       ${region.id} — ${ways} ways in ${secs}s`)
      fetched++
    } catch (error) {
      console.error(`FAILED   ${region.id} — ${String(error)}`)
      failures.push(region.id)
    }
  }

  console.log(`\nfetched ${fetched}, skipped ${skipped}, failed ${failures.length}`)
  if (failures.length > 0) {
    console.error(`Re-run for: ${failures.map((id) => `--region ${id}`).join(' ')}`)
    process.exitCode = 1
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
