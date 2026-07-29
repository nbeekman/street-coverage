import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { COVERAGE_SNAPSHOT_VERSION } from '../src/coverage/snapshot.ts'
import { SNAPSHOT_VERSION } from '../src/network/snapshot.ts'
import { RIDES_SNAPSHOT_VERSION } from '../src/rides/snapshot.ts'

const PUBLIC = join(process.cwd(), 'public')

/**
 * Refuse to deploy a site that would silently render an empty map.
 *
 * Ride and coverage artifacts are gitignored, so they exist only where they
 * were built. A deploy from a checkout without them succeeds, uploads happily,
 * and produces a 0.00% map with no traces -- a failure with no error, which is
 * the shape of bug this project keeps guarding against.
 */
async function readManifest<T>(path: string, hint: string): Promise<T> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    throw new Error(`Missing ${path}\n  Run: ${hint}`)
  }
}

async function main(): Promise<void> {
  const problems: string[] = []

  const index = await readManifest<{ version: number; regions: unknown[] }>(
    join(PUBLIC, 'network', 'index.json'),
    'npm run build:snapshot',
  )
  if (index.version !== SNAPSHOT_VERSION) {
    problems.push(
      `network snapshot is v${index.version}, code expects v${SNAPSHOT_VERSION} — re-run build:snapshot`,
    )
  }

  const rides = await readManifest<{ version: number; rideCount: number }>(
    join(PUBLIC, 'rides', 'manifest.json'),
    'npm run import:rides -- --dir <export>/activities && npm run build:rides',
  )
  if (rides.version !== RIDES_SNAPSHOT_VERSION) {
    problems.push(
      `rides snapshot is v${rides.version}, code expects v${RIDES_SNAPSHOT_VERSION} — re-run build:rides`,
    )
  }
  if (rides.rideCount === 0) problems.push('rides snapshot contains zero rides')

  const coverage = await readManifest<{
    version: number
    totals: { coveredMeters: number; totalMeters: number }
    rideCount: number
  }>(join(PUBLIC, 'coverage', 'manifest.json'), 'npm run build:coverage')
  if (coverage.version !== COVERAGE_SNAPSHOT_VERSION) {
    problems.push(
      `coverage snapshot is v${coverage.version}, code expects v${COVERAGE_SNAPSHOT_VERSION} — re-run build:coverage`,
    )
  }
  if (coverage.totals.coveredMeters === 0) {
    problems.push('coverage reports 0 covered metres — the map would render as 0.00%')
  }
  // Coverage built against a different import than the one being shipped.
  if (coverage.rideCount !== rides.rideCount) {
    problems.push(
      `coverage was built from ${coverage.rideCount} rides but the rides snapshot has ${rides.rideCount} — re-run build:coverage`,
    )
  }

  if (problems.length > 0) {
    console.error('Deploy preflight failed:\n' + problems.map((p) => `  - ${p}`).join('\n'))
    process.exitCode = 1
    return
  }

  const pct = (coverage.totals.coveredMeters / coverage.totals.totalMeters) * 100
  console.log(
    `preflight ok — ${rides.rideCount} rides, ${pct.toFixed(2)}% of ` +
      `${(coverage.totals.totalMeters / 1000).toFixed(0)} km\n` +
      `NOTE: this deploy publishes ride traces. They are clipped ` +
      `at both ends, but the routes themselves become public.`,
  )
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
