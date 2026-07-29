# Engineering log

Written after M1–M3, then extended through the load-time work and M6. This is the document
I would want if I picked this project up cold in six months: what it does, why it is shaped
this way, what went wrong, and which mistakes are likely to be repeated.

It is deliberately not a tutorial. Nothing here is aspirational — every claim is something
that actually happened, and where a number appears it was measured.

---

## 1. What the thing is

Import a Strava export, match the traces against the OpenStreetMap street network, and
report what share of a metro's street distance has been ridden. Ridden streets are lit,
unridden dim, and the number goes up over time.

| | Deliverable | State |
|---|---|---|
| **M1** | Overpass fetch → binary snapshots → deck.gl render of the whole network | done |
| **M2** | FIT/GPX parsing, privacy clipping, resampling, trace rendering | done |
| **M3** | Node coverage, the headline percentage, ridden/unridden recolouring | done |
| **M4** | Coverage in PostGIS, incremental updates | skipped, see §10 |
| **M5** | Neighbourhood breakdown + nearest-unridden | nearest built then cut; neighbourhoods blocked |
| **M6** | Timeline scrubber | done |
| **M7** | Perf pass | done in pieces, see §6 |
| **M8** | Rural-postman planner | untouched |

Current state: 19 regions, 68,574 ways, 12,346 km, 190 rides, **2.86%**. Live at
`cycling.nathanbeekman.com`, deployed from a local build.

---

## 2. Architecture, and the one idea it rests on

**Nothing expensive happens in the browser.** Every heavy step is an offline script that
writes static binary artifacts; the browser fetches typed arrays and hands them to the GPU.

```
fetch-network.ts   Overpass          → data/raw/*.json        (gitignored, 74 MB)
build-snapshot.ts  raw               → public/network/*.bin   (committed, 10 MB)
import-rides.ts    Strava export     → data/rides/*.json      (gitignored)
build-rides.ts     parsed rides      → public/rides/*.bin     (gitignored)
build-coverage.ts  raw + rides       → public/coverage/*.bin  (gitignored)
```

Splitting *fetch* from *build* is what makes iteration bearable. Re-clipping rides or
retuning the match radius takes under a second because nothing is re-parsed or re-downloaded.
Overpass is slow and flaky enough that any design requiring a re-fetch per experiment would
have stalled the project.

### Why binary, and the coordinate trick

deck.gl `PathLayer` accepts binary attributes: `{length, startIndices, attributes}`. At 68k
paths this is not an optimisation, it is the difference between working and not.

Geometry is stored **Float64** for coverage math but uploaded as **Float32 offsets from a
per-region origin**. Raw Float32 lng/lat carries ~1.4 m of error at Denver's longitude, which
is useless next to a 25 m match radius. Subtracting a nearby origin first drops the magnitude
to ~0.3°, where Float32 resolves to millimetres.

---

## 3. The decisions everything else hangs off

**What counts as ridden.** A node is *hit* when a ride point passed within **25 m**. A
segment is ridden when **both** its endpoints are hit. The "both" is the entire safeguard
against one stray GPS point crediting a 400 m stretch.

**What the headline measures.** Ridden metres over total metres — not percent-of-nodes. Node
density clusters at intersections, so a node percentage over-weights downtown grids and
under-credits long suburban arterials. Street distance is what a rider actually means.

**The denominator is a choice, and it is the whole game.** Regions are incorporated places
and CDPs, not counties: county boundaries include mountain and plains roads nobody will ride,
which puts 100% permanently out of reach. Adding a region changes what the number *means*,
which is why region changes are treated as seriously as code changes.

**Privacy is structural, not incidental.** Ride traces, raw Overpass payloads, and coverage
output are all gitignored. Coverage counts: *which streets someone has ridden* is location
data. Clipping runs inside the importer so unclipped coordinates never reach disk at all —
not even in an intermediate.

---

## 4. Pitfalls

Grouped by the property that makes them dangerous, because that turned out to matter more
than the individual bugs.

### 4a. Failures that look like success

This is the recurring theme of the entire project. Nearly every serious bug produced a
plausible wrong answer rather than an error.

**Overpass reports errors as HTTP 200 with an HTML body.** `res.ok` proves nothing. The client
checks whether the body starts with `<`, rejects bad JSON, and treats a zero-way response as a
failure rather than an empty region.

**`overpass.osm.ch` holds only Switzerland.** It answers fast and returns a valid, parseable,
*empty* result for Colorado — worse than a timeout, because it looks like success. Excluded
from the mirror pool on purpose.

**Vite's SPA fallback serves index.html at HTTP 200** for a missing file, producing
`Unexpected token '<'` instead of "your snapshot is missing". Same shape as the Overpass bug;
same guard.

**FIT stores positions as semicircles and the SDK does not convert them**, even with
`applyScaleAndOffset: true`. A record reads `positionLat: -138818392`. Miss the conversion and
every coordinate is silently wrong rather than obviously broken.

**A stale raw file silently corrupts the denominator.** A failed `--force` leaves the previous
fetch in place, so a region can carry data fetched under an older query. Each raw payload
stores a hash of the query that produced it; the build refuses to run on a mismatch. This
caught a real case.

**`tsc --noEmit` is not the build.** `tsc -b` uses project references and covers `scripts/`
and `test/` differently. The production build was broken for several commits while every check
passed. **Run `npm run build`, not a flat type check.**

**A layer that renders nothing still renders.** A deck.gl `CompositeLayer` does not re-run
`renderLayers` on camera change unless `shouldUpdateState` says so. Without it, a zoom gate is
evaluated once at construction and never again — it compiles, it renders, and it silently does
nothing. This shipped and was only caught by measuring instead of eyeballing screenshots.

### 4b. Geometry and units

**Use `map_to_area`, never `area(3600000000 + id)`.** The offset form returns zero ways for
way-based CDP boundaries, because Overpass only materialises areas for ways in its areas file.

**Denver is `admin_level=6`, not 8** — a consolidated city-county. Name lookups are ambiguous
across OSM, so the registry pins numeric IDs.

**Mixing Earth models silently loses matches.** Spatial-grid cells were sized with the
ellipsoidal 111,320 m per degree while `haversineMeters` measures on a sphere of radius
6,371,008.8 m (111,194.9 m/deg). Cells came out **24.97 m** for a 25 m radius. Undersized cells
drop candidates without any error. `METERS_PER_DEGREE` is now exported from one place so
nothing can diverge, plus a 1% margin.

**Ride traces are sparser than they look.** M2 resamples to a 10 m *minimum* spacing, but the
source recordings are coarser: median gap **23.5 m**, p90 **38.6 m**, worst **262 m**. Coverage
asks whether a *point* came within 25 m of a node, but the rider travelled the *line between*
points, so nodes mid-gap were missed despite being ridden over. Densifying to 10 m before
matching recovered 11 km.

### 4c. Toolchain

**`maplibre-gl` must stay on v5.** `react-map-gl@8` calls `map.transform.width`, which v6
removed, and its peer range does not exclude the broken major.

**Vite caches pre-bundled deps.** A dependency change looks like it did nothing until
`node_modules/.vite` is cleared. This caused a misdiagnosis: a version problem was declared
"not version-related" because the dev server was serving a cached bundle.

**Node needs explicit `.ts` extensions.** The scripts run under Node's native type stripping,
which has no extensionless ESM resolution even though tsc and Vite accept it.

**`HIGHWAY_CLASSES` order is a storage contract.** `classes.bin` holds indices into that
array. Append only — reordering silently recolours every snapshot already on disk.

---

## 5. Upgrades, and why

Snapshot versions bump when the **layout or the meaning** changes. Meaning counts: the same
bytes describing a different claim about the world is a new version.

| Version | Change | Why it is a version bump |
|---|---|---|
| Network v1 → v2 | Added bike-legal `path`/`bridleway` | Different denominator; a v1 snapshot under v2 code computes the wrong percentage |
| Network v2 → v3 | Added `footway` where `bicycle=designated` | Same reasoning |
| Rides v1 → v2 | Kept out-of-region rides | `rideCount` and `totalMeters` now describe all riding, not metro riding |
| Coverage v1 | — | The match radius is part of the meaning, so changing its default is a bump |

### Region additions, each one found by looking at the map

Every region after the first ten was added because a hole was visible, then confirmed by
measurement — not guessed.

- **Unincorporated Jefferson County** (Littleton↔Morrison): belongs to no `admin_level=8`
  municipality, so no boundary query could reach it, yet it carries S Kipling Pkwy and the
  C-470 Trail. Solved with a **polygon region** — an explicit ring.
- **Cherry Hills Village, Morrison, Bow Mar**: ordinary municipalities simply missing from the
  registry.
- **Glendale, Holly Hills, Cherry Creek State Park, and a corridor polygon**: found when
  coverage showed the Cherry Creek Trail fragmenting while the ride overlay drew it
  continuously. Traces do not depend on the network, so the *difference between the two views*
  localised the cause. Measured: 17,976 of 151,382 ride points sat >60 m from any network node.
- **Aurora**: added on request. It moved the headline from 3.70% to **2.85%** and reads 0.00%
  itself. Covered distance did not change by a metre — only the denominator grew.

**Polygon regions must be listed last.** `build-snapshot` assigns each way to exactly one
region in registry order, so a catch-all ring must lose to the towns it overlaps. A test
enforces the ordering. A pleasant consequence: once Aurora existed as a boundary region, the
corridor ring could be drawn loosely, because Aurora claims its own ways first.

### One change that did nothing, kept anyway

Allowing `footway` where `bicycle=designated` was *my* recommendation for closing a 25–40 m
matching gap. It added 749 ways and moved the headline **2.86% → 2.86%**. Twenty-three ride
points changed status. The reasoning was sound — OSM does use `designated` for real bike
routes — but it generalised from a single example and the data did not support it.

Kept, because it is correct and costs nothing. Recorded, because the lesson is the point:
**measure the fix, not just the bug.**

---

## 6. Performance

### What was actually slow

| Symptom | Cause |
|---|---|
| 6 fps at continental zoom | All 69,791 paths rasterising into a few hundred pixels |
| 60 fps with the network off screen | Confirms geometry volume, not compositing |

### Three attempts at the same fix

**Attempt 1 — viewport in React state.** Culling needs the camera, so `MapView` held zoom and
bounds in state. That re-renders react-map-gl's `<Map>`, whose `setProps` throws in
`_updateSize`. The map froze; 6 fps → 2. Reverting `MapView` alone removed the exception,
which is what pinned the cause.

**Attempt 2 — a `CompositeLayer`, no memoization.** Correct idea, missing prerequisite. It
also shipped without `shouldUpdateState`, so it silently did nothing; adding that dropped the
*default* zoom to 1 fps.

**Attempt 3 — memoize first, then cull.** Worked.

### The thing both failures missed

**deck.gl diffs layer props by reference.** A binary `data` payload is a plain object wrapping
typed arrays, so constructing a fresh one per render reads as *new data* and re-uploads every
vertex — 613,505 of them. Culling rebuilds layers as the camera moves, so every frame paid for
the entire network.

`data` and accessors now live in a `WeakMap` keyed on the loaded region. Nine tests pin
**reference identity**, not value equality — a value test would pass while the bug returned.

| View | Before | After |
|---|---:|---:|
| **Continental zoom** | **6 fps** | **29 fps** |
| Default city zoom | 48–60 | 29–30 |

### Bundle chunks

Split by change frequency rather than size: `index` went 825 kB → **37.6 kB**, with `deck`
(597 kB) and `react` (190 kB) extracted. This is a **caching** win, not a cold-load win — every
chunk is needed to render.

### Load time: 24.3 MB → 4.36 MB

The line above said the real cost was the binary snapshots, not the JavaScript. That turned
out to be right, and it came down in four steps:

| Stage | Default view | Decode |
|---|---:|---:|
| Before | 24.3 MB | 1,680 ms |
| Float32 wire format | 12.2 MB | |
| Load only the active view | 5.8 MB | |
| Compression | **4.36 MB** | **246 ms** |

**Float32 offsets instead of Float64 positions.** The browser was downloading Float64
coordinates, converting them to Float32 offsets on load, and never touching the Float64
again except to derive an origin the manifest already had a bbox for. It fetched twice the
bytes to throw half away. Coverage maths runs offline from `data/raw`, so nothing needed the
precision. `wayIds` stopped being fetched at all — 568 KB nothing in the browser read.

Splitting the types into `PackedBuffers` (build, Float64) and `SnapshotBuffers` (wire,
Float32) is what made this safe: the compiler pointed at all twenty-odd stale assumptions
instead of leaving them to fail at runtime.

**Load only what the view needs.** Coverage mode never needed the network snapshot — the
coverage manifest already carries region name, group, segment count and total metres, which
is every field the stats table shows. It was fetching 5.3 MB to read four numbers out of.

**Compression.** Netlify compresses by content type and offers no override, so `.bin` files
served as `application/octet-stream` came down raw while the JavaScript was brotli'd.
Declaring them `text/plain` in `netlify.toml` fixes it; nothing reads the type, since the
browser uses `arrayBuffer()`. Chosen over forcing `Content-Encoding: br`, which is
unconditional and would hand an undecodable body to a client that did not accept brotli.

**A correction worth keeping.** An earlier estimate put ~4 MB on the table for compression.
That was measured on the Float64 positions, which compressed ~4× because every coordinate sat
near −105, 39.7 and shared long identical byte prefixes. Those are no longer shipped. Float32
offsets are ~90% of the bytes and compress only 18%. **The wire-format change had already
taken most of that win; compression could not claim it twice.** Real saving: 1.5 MB.

The remaining lever there is quantisation — Int16 deltas at ~1 m precision would roughly halve
`offsets.bin` again — which is a precision trade-off rather than a free header change.

### Measuring in dev will mislead you

Two traps, both of which produced wrong numbers before being caught:

- **React StrictMode double-invokes effects in development**, so the dev server fetches every
  region twice. Any byte or decode figure measured against `npm run dev` needs halving.
  Production fetches each file exactly once — verified.
- **HMR makes probes lie.** A `window.__probe` added to an event handler after the event has
  already fired reports `false` forever, because the handler does not re-run. This cost real
  time and led to a change that broke label ordering. Restart the dev server when
  instrumenting.

---

## 7. Process

What actually worked, in rough order of value.

**Design before building.** Each milestone got a spec (`docs/superpowers/specs/`) with the
decisions and their reasons written down *before* code. Re-reading those specs mid-build
settled several arguments that would otherwise have been re-litigated.

**Measure before claiming, and after fixing.** Repeatedly, the plausible story was wrong: the
footway change did nothing; the Overpass timeout raise was not what fixed Aurora (the retry
was); the zoom gate that "worked" was never running. A screenshot is not a measurement.

**Prefer the diagnostic that distinguishes hypotheses.** The single most useful debugging move
in the project was noticing that ride traces render independently of the network — so a
continuous trace beside fragmented coverage proved the *map* was incomplete, not the matching.

**Guard the silent failures explicitly.** Query hashes, body-shape checks, version mismatches,
a deploy preflight that refuses to ship an empty map. Each exists because the failure it
prevents produced no error.

**Tests that pin the property, not the value.** The reference-identity tests are the clearest
example. So is the grid test that asserts agreement with brute force over 3,000 random
queries: it verifies the optimisation rather than trusting it.

**Version anything whose meaning can drift**, and make loading a stale artifact an error
rather than a wrong number.

### Things worth doing differently

- Run the **real build** in the verification loop from day one.
- When a fix is proposed on the strength of one example, **size it before building it**.
- Restart the dev server before instrumenting. HMR-stale probes cost more time than any
  actual bug in this project.
- **Verify the thing you changed, not the thing in front of you.** After converting the
  network snapshot the default view looked perfect — because the default view is coverage
  mode, which never touches the network snapshot. It proved nothing.

---

## 8. Filtering by time

Two questions that look alike and are not:

- **During year Y** — ground covered in that one year. The year buttons.
- **Through year Y** — everything ridden up to and including it. The timeline scrubber.

Both are a mask over the same buffers. Each run carries a bitmask of the years it was ridden
and its own length, so either question is one pass over ~70,000 runs — no recomputation, no
second fetch. `through` is simply every bit up to Y.

That made M6 almost free: a generalised filter and a slider, with no new data and no format
change. **Ride traces accumulate under the timeline too** — showing one year at a time made
Play an automated year-button click rather than a picture of the map filling in.

Two design decisions inside it, both of which could have gone the other way:

**A segment's years are the intersection of its endpoints', not the union.** Riding one end in
2018 and the other in 2022 does not mean the stretch between was ridden in either — the same
"both endpoints" rule that stops a stray GPS point crediting a segment, applied per year.

**Runs split on year change, not just ridden state.** Grouping by ridden state alone would
force a whole run to share one year, so a street ridden in two years would answer a filter
wrongly. The exactness cost 0.8% more runs.

### The timeline's last frame is 0.012 points short

It reads 2.85% against an all-time 2.86%. Measured: **16 ridden runs, 1.5 km** carry no year
at all, because their two endpoints were first ridden in different years and the intersection
is empty. Right for "during 2022"; wrong cumulatively, since by 2026 both ends have been
ridden.

The fix is a per-run `max(firstYear(a), firstYear(b))` stored rather than derived. Left undone:
a format change and a rebuild for a hundredth of a point. Recorded so it is not rediscovered
as a mystery.

---

## 9. Privacy, and a public repo

The repo is public. Ride traces, raw Overpass payloads and coverage output are all gitignored
— coverage counts, because which streets someone has ridden is location data. Clipping runs
inside the importer so unclipped coordinates never reach disk.

A full-history audit found **zero** ride, coverage or secret files ever committed, and zero
`Co-Authored-By` trailers. One real file was committed and later removed: a Zwift `.fit`
fixture. It held no location or identity data — Watopia coordinates, no name, no heart rate —
but it did carry one session's power and cadence figures and a device serial, which a public
repo has no reason to publish.

Removing it needed care, because **six tests depended on it**, including the semicircle
conversion check. It was replaced rather than deleted: `test/fixtures/syntheticFit.ts` encodes
a FIT in memory with the Garmin SDK's own encoder. That tested *more* than the recording did —
a single file could only ever show one combination of fields, while a builder can check
`subSport` and `manufacturer` surviving independently, which is what the virtual-ride filter
actually relies on. Six tests became ten.

History was then rewritten to drop the blob. **Force-pushing makes it unreachable, not gone:**
GitHub still served the blob by SHA afterwards, and only GitHub Support can garbage-collect it.
Worth knowing before treating a scrub as complete.

**Deploys publish ride traces.** The site is deployed from a *local* build, because the
artifacts are gitignored and cannot reach a git-triggered build. A `predeploy` guard refuses to
ship a site that would render as an empty map — that failure is silent otherwise, since the
deploy succeeds and the map is merely blank.

---

## 10. Roads not taken

**M4, PostGIS.** Skipped. The intended shape was an offline build tool rather than a hosted
database — coverage computed in SQL locally, emitting the same static artifacts — because
putting traces in a hosted DB is a real change in posture after the effort spent keeping them
out of git, and because two independent implementations of coverage would have been a genuine
correctness check. Blocked in practice on PostGIS building against postgresql@17/@18 while the
local server is @14. Not hard to unblock; just not done.

**Nearest-unridden.** Built, working, and cut. The pure module and its eight tests were
reverted with it. Worth knowing it is tractable client-side: scanning every vertex of every
unridden run is a few tens of milliseconds, no spatial index required.

**Neighbourhood breakdown.** Blocked on data. OSM has 59 neighbourhood elements for Denver
against 78 official ones, in mixed geometry types, and nothing for the other 18 regions. The
Denver Open Data endpoints tried did not resolve. It needs a confirmed GeoJSON source before
it is worth starting.

---

## 11. Known limits

None of these are bugs. All are consequences of decisions above.

- **Streets near home can never reach 100%.** The 500 m privacy clip removes those nodes by
  construction. This is the accepted cost of not storing where the rider lives.
- **A 25 m radius credits some streets merely ridden past.** Denver block spacing reaches
  ~30 m. Measured: a third of unmatched points have a rideable way 25–40 m away, so the radius
  is the binding constraint, not the map. Widening to 35 m would recover 29 km — and would also
  claim streets never ridden. There is no ground truth here to separate the two, so it stays at
  25 m.
- **Dual carriageways read as half-ridden forever.** A divided road is two OSM ways; riding one
  direction leaves the other unhit.
- **Out-of-region rides score nothing.** They draw wherever they happened, but no network was
  fetched there to credit.

---

## 12. Where to look

| Question | File |
|---|---|
| What is rideable, which regions exist | `src/network/regions.ts` |
| Why a number changed | `docs/measurements.md` |
| What each milestone decided | `docs/superpowers/specs/` |
| Matching algorithm | `src/coverage/{grid,nodes,segments,densify}.ts` |
| Year and timeline filtering | `src/coverage/yearFilter.ts` |
| Privacy handling | `src/rides/privacy.ts`, `.gitignore` |
| Render performance | `src/layers/{regionStackLayer,visibility}.ts`, memoization in the layer factories |
| Wire format vs build format | `src/network/snapshot.ts` — `PackedBuffers` vs `SnapshotBuffers` |
| Deploy and its guard | `netlify.toml`, `scripts/preflight-deploy.ts` |
| Z-order contract | `src/layers/mapLayers.test.ts` |
