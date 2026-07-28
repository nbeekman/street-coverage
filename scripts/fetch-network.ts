import { createHash } from 'node:crypto'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OverpassError, fetchRegion } from './overpass.ts'
import {
  REGIONS,
  buildOverpassQuery,
  regionById,
  regionsInGroup,
  type Region,
  type RegionGroup,
} from '../src/network/regions.ts'

const RAW_DIR = join(process.cwd(), 'data', 'raw')

/**
 * Pause between regions.
 *
 * A --force run fires every region back to back at the same handful of
 * mirrors, and overpass-api.de allows only 2 slots per IP. Measured
 * 2026-07-28: a 14-region re-fetch collected 3 HTTP 429s that were purely
 * self-inflicted. Costs under a minute across a full run.
 */
const INTER_REGION_DELAY_MS = 4000

/** Longer pause after a region that was actually throttled. */
const RATE_LIMIT_COOLDOWN_MS = 30_000

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type Args = {
  regions: Region[]
  force: boolean
  delayMs: number
  /** Per-attempt cap override, ms. Large regions need more than the default. */
  requestTimeoutMs?: number
}

function parseArgs(argv: string[]): Args {
  const force = argv.includes('--force')
  let requestTimeoutMs: number | undefined
  const regions: Region[] = []
  let delayMs = INTER_REGION_DELAY_MS

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--timeout') {
      const n = Number(argv[i + 1])
      if (!Number.isFinite(n) || n <= 0) throw new Error('--timeout expects seconds > 0')
      requestTimeoutMs = n * 1000
    }
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
    if (argv[i] === '--delay') {
      const parsed = Number(argv[i + 1])
      if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`--delay expects milliseconds, got "${argv[i + 1]}"`)
      }
      delayMs = parsed
    }
  }

  if (regions.length === 0) {
    throw new Error(
      'Specify --region <id>, --group <metro-core|metro-outer|mountain|route>, or --all',
    )
  }
  return { regions, force, delayMs, requestTimeoutMs }
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
  const { regions, force, delayMs, requestTimeoutMs } = parseArgs(process.argv.slice(2))
  await mkdir(RAW_DIR, { recursive: true })
  const done = await alreadyFetched()

  let fetched = 0
  let skipped = 0
  const failures: string[] = []
  let pending = false

  for (const region of regions) {
    if (!force && done.has(region.id)) {
      console.log(`skip     ${region.id} (already fetched; use --force to refetch)`)
      skipped++
      continue
    }

    // Only pace between requests we actually make; skipped regions are free.
    if (pending && delayMs > 0) await sleep(delayMs)
    pending = true

    let throttled = false
    const started = Date.now()
    try {
      const response = await fetchRegion(region, {
        requestTimeoutMs,
        onAttempt: ({ attempt, url }) =>
          console.log(`  ...     ${region.id} attempt ${attempt + 1} → ${new URL(url).host}`),
        onAttemptFailed: ({ ms, error }) => {
          if (error instanceof OverpassError && error.code === 'RATE_LIMITED') {
            throttled = true
          }
          console.log(`  fail    ${region.id} after ${(ms / 1000).toFixed(1)}s — ${String(error)}`)
        },
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
      if (error instanceof OverpassError && error.code === 'RATE_LIMITED') throttled = true
      console.error(`FAILED   ${region.id} — ${String(error)}`)
      failures.push(region.id)
    }

    if (throttled && delayMs > 0) {
      console.log(`  cool    rate-limited; waiting ${RATE_LIMIT_COOLDOWN_MS / 1000}s before the next region`)
      await sleep(RATE_LIMIT_COOLDOWN_MS)
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
