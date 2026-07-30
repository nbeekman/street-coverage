# Learnings

What this project cost to learn, written down so it only costs it once.

Nothing here is aspirational. Every claim is something that actually happened, and where a
number appears it was measured — the raw figures and how they were taken are in
[measurements.md](measurements.md).

For what the thing is and how to run it, see the [README](../README.md).

---

## 1. Nearly every serious bug returned a plausible wrong answer

This is the single recurring theme, and it is worth stating before anything else: almost
nothing in this project failed loudly. Bad data arrived as *valid* data. The map rendered.
The percentage looked reasonable. The tests passed.

**Overpass reports errors as HTTP 200 with an HTML body.** `res.ok` proves nothing. The
client checks whether the body starts with `<`, rejects bad JSON, and treats a zero-way
response as a failure rather than an empty region.

**`overpass.osm.ch` holds only Switzerland.** It answers fast and returns a valid,
parseable, *empty* result for Colorado — worse than a timeout, because it looks like
success. Excluded from the mirror pool on purpose.

**Vite's SPA fallback serves `index.html` at HTTP 200** for a missing file, so a missing
snapshot surfaces as `Unexpected token '<'` rather than "your snapshot is missing." Same
shape as the Overpass bug, same guard.

**FIT stores positions as semicircles and the Garmin SDK does not convert them**, even with
`applyScaleAndOffset: true`. A record reads `positionLat: -138818392`. Miss the conversion
and every coordinate is quietly wrong rather than obviously broken.

**A stale raw file silently corrupts the denominator.** A failed `--force` leaves the
previous fetch in place, so a region can carry data fetched under an older query. Each raw
payload now stores a hash of the query that produced it, and the build refuses to run on a
mismatch. This caught a real case.

**`tsc --noEmit` is not the build.** `tsc -b` uses project references and covers `scripts/`
and `test/` differently. The production build was broken for several commits while every
check passed. Run `npm run build`, not a flat type check.

**A layer that renders nothing still renders.** A deck.gl `CompositeLayer` does not re-run
`renderLayers` on camera change unless `shouldUpdateState` says so. Without it a zoom gate
is evaluated once at construction and never again — it compiles, it renders, and it does
nothing. This shipped, and was caught only by measuring rather than eyeballing screenshots.

**The response.** Guard the silent failures explicitly, and make loading a stale artifact an
error rather than a wrong number: query hashes, body-shape checks, version mismatches, and a
deploy preflight that refuses to ship a site that would render as an empty map. Each of
those exists because the failure it prevents produced no error.

---

## 2. Mixing units and Earth models loses data without complaining

Two instances, both of which cost real time, both of which would have been caught by writing
the constant down once.

**Undersized grid cells.** Spatial-grid cells were sized with the ellipsoidal 111,320 m per
degree of longitude while `haversineMeters` measures on a sphere of radius 6,371,008.8 m
(111,194.9 m/deg). Cells came out **24.97 m** for a 25 m radius. Undersized cells drop
candidate matches with no error at all. `METERS_PER_DEGREE` is now exported from one place
so nothing can diverge, plus a 1% margin.

**Ride traces are sparser than they look.** Import resamples to a 10 m *minimum* spacing,
but the source recordings are coarser than that: median gap **23.5 m**, p90 **38.6 m**,
worst **262 m**. Coverage asks whether a ride *point* came within 25 m of a node, but the
rider travelled the *line between* points, so nodes mid-gap were missed despite being ridden
straight over. Densifying to 10 m before matching recovered 11 km.

Two OSM-specific traps in the same family:

- **Use `map_to_area`, never `area(3600000000 + id)`.** The offset form returns zero ways
  for way-based CDP boundaries, because Overpass only materialises areas for ways in its
  areas file.
- **Denver is `admin_level=6`, not 8** — it is a consolidated city-county. Name lookups are
  ambiguous across OSM, so the registry pins numeric IDs.

---

## 3. Measure the fix, not just the bug

Repeatedly, the plausible story was wrong.

**A change that did nothing, kept anyway.** Allowing `footway` where `bicycle=designated`
was recommended for closing a 25–40 m matching gap. It added 749 ways and moved the headline
**2.86% → 2.86%**; twenty-three ride points changed status. The reasoning was sound — OSM
does use `designated` for real bike routes — but it generalised from a single example and
the data did not support it. Kept, because it is correct and costs nothing. Recorded,
because the lesson is the point.

**The wrong thing got credit for the fix.** Aurora failed all nine fetch attempts at the 90 s
per-attempt cap, then succeeded in **16.7 s** on retry. The cap was never the binding
constraint — Overpass was simply overloaded. The cap was raised anyway, on its own merits,
but the honest cause was server load and the honest fix was retrying.

**The radius, not the ruleset, is the lever.** Same network, same rides: 25 m → 2.86%,
35 m → 3.09%. Widening to 35 m recovers 29 km, an order of magnitude more than the footway
change. It is left at 25 m regardless, because the numbers say what a wider radius *gains*
and say nothing about what it wrongly claims, and there is no ground truth here to separate
the two.

**Prefer the diagnostic that distinguishes hypotheses.** The most useful single debugging
move in the project: ride traces render independently of the network, so a *continuous*
trace drawn beside *fragmented* coverage proved the map was incomplete rather than the
matching being broken. Measured after the fact — 17,976 of 151,382 ride points sat more than
60 m from any network node — but the difference between the two views is what localised it.

**Verify the thing you changed, not the thing in front of you.** After converting the
network snapshot to a Float32 wire format the default view looked perfect — because the
default view is coverage mode, which never touches the network snapshot. It proved nothing.

---

## 4. Nothing expensive happens in the browser

Every heavy step is an offline script that writes static binary artifacts. The browser
fetches typed arrays and hands them to the GPU.

```
fetch-network.ts   Overpass          → data/raw/*.json        (gitignored, 74 MB)
build-snapshot.ts  raw               → public/network/*.bin   (committed, 10 MB)
import-rides.ts    Strava export     → data/rides/*.json      (gitignored)
build-rides.ts     parsed rides      → public/rides/*.bin     (gitignored)
build-coverage.ts  raw + rides       → public/coverage/*.bin  (gitignored)
```

**Splitting *fetch* from *build* is what made iteration bearable.** Re-clipping rides or
retuning the match radius takes under a second, because nothing is re-parsed or
re-downloaded. Overpass is slow and flaky enough that any design requiring a re-fetch per
experiment would have stalled the project outright — the measured numbers back this up: 14
regions took 1,007 s of successful fetching and burned another **1,073 s on 19 failed
attempts**.

**Binary is not an optimisation here.** deck.gl `PathLayer` accepts binary attributes
(`{length, startIndices, attributes}`). At 68k paths this is the difference between working
and not.

**The coordinate trick.** Geometry is stored **Float64** for coverage maths but uploaded as
**Float32 offsets from a per-region origin**. Raw Float32 lng/lat carries ~1.4 m of error at
Denver's longitude, useless next to a 25 m match radius. Subtracting a nearby origin first
drops the magnitude to ~0.3°, where Float32 resolves to millimetres.

---

## 5. The denominator is the whole game

**What counts as ridden.** A node is *hit* when a ride point passed within 25 m. A segment
is ridden when **both** its endpoints are hit. That "both" is the entire safeguard against
one stray GPS point crediting a 400 m stretch never ridden.

**What the headline measures.** Ridden metres over total metres — not percent-of-nodes. Node
density clusters at intersections, so a node percentage over-weights downtown grids and
under-credits long suburban arterials. Street distance is what a rider actually means.

**Regions are incorporated places, not counties.** County boundaries include mountain and
plains roads nobody will ever ride, which puts 100% permanently out of reach. The cost of
that choice is that some land belongs to no municipality at all, so it needs explicit
**polygon regions** — the strip between Littleton and Morrison is unincorporated Jefferson
County, unreachable by any boundary query, yet it carries S Kipling Pkwy and the C-470 Trail.

**Adding a region changes what the number *means*.** Aurora moved the headline from 3.70% to
**2.85%** while covered distance did not change by a single metre. Only the denominator
grew. Region changes are therefore treated as seriously as code changes.

**Overlap has to be resolved somewhere.** Overpass `way(area.r)` returns any way with a node
inside the area, so a way straddling a municipal border is claimed by both neighbours — 395
ways across 19 region pairs, inflating the denominator by 127 km before anyone noticed.
`build-snapshot` now assigns each way to exactly one region in registry order. Two
consequences: **polygon regions must be listed last** (a catch-all ring must lose to the
towns it overlaps, and a test enforces it), and **polygon rings can then be drawn loosely** —
the SW Metro ring is a plain rectangle that fetches 14,276 ways and keeps only the 3,200 no
boundary region claimed. No border-tracing needed.

**The same rule, applied per year.** A run's year mask is the *intersection* of its
endpoints' years, not the union: riding one end in 2018 and the other in 2022 does not mean
the stretch between was ridden in either. Runs also split on year change, not just on ridden
state — grouping by ridden state alone would force a whole run to share one year, so a street
ridden across two years would answer a filter wrongly. The exactness cost 0.8% more runs.

---

## 6. Performance: the prerequisite two attempts skipped

Symptom: **6 fps at continental zoom**, 60 fps with the network off screen — which already
told us it was geometry volume, not compositing. All 69,791 paths were rasterising into a
few hundred pixels.

**Attempt 1 — viewport in React state.** Culling needs the camera, so `MapView` held zoom and
bounds in state. That re-renders react-map-gl's `<Map>`, whose `setProps` throws in
`_updateSize`. The map froze; 6 fps → 2. Reverting `MapView` alone removed the exception,
which is what pinned the cause.

**Attempt 2 — a `CompositeLayer`, no memoization.** Correct idea, missing prerequisite. It
also shipped without `shouldUpdateState`, so it silently did nothing; adding that dropped the
*default* zoom to 1 fps — worse than the problem it was fixing.

**What both missed: deck.gl diffs layer props by reference.** A binary `data` payload is a
plain object wrapping typed arrays, so constructing a fresh one per render reads as *new
data* and re-uploads every vertex — 613,505 of them. Culling rebuilds layers as the camera
moves, so every frame paid for the entire network.

**Attempt 3 — memoize first, then cull.** `data` and the accessors live in a `WeakMap` keyed
on the loaded region, so a rebuilt layer hands deck.gl references it has already uploaded and
the diff is a no-op. Nine tests pin **reference identity**, not value equality — a value test
would pass while the bug returned.

| View | Before | After |
|---|---:|---:|
| **Continental zoom** | **6 fps** | **29 fps** |
| Default city zoom | 48–60 | 29–30 |

### The first-load cost was the data, not the JavaScript

Splitting the bundle by change frequency took `index` from 825 kB to **37.6 kB**, with
`deck` (597 kB) and `react` (190 kB) extracted. Worth doing — but it is a *caching* win, not
a cold-load win, because every chunk is needed to render. The real weight was elsewhere:
**24.3 MB → 4.36 MB**, in three steps.

| Stage | Default view | Decode |
|---|---:|---:|
| Before | 24.3 MB | 1,680 ms |
| Float32 wire format | 12.2 MB | |
| Load only the active view | 5.8 MB | |
| Compression | **4.36 MB** | **246 ms** |

**Float32 offsets instead of Float64 positions.** The browser was downloading Float64
coordinates, converting them to Float32 offsets on load, and never touching the Float64
again — fetching twice the bytes to throw half away. `wayIds` stopped being fetched at all:
568 KB nothing in the browser read. Splitting the types into `PackedBuffers` (build, Float64)
and `SnapshotBuffers` (wire, Float32) is what made this safe — the compiler pointed at all
twenty-odd stale assumptions instead of leaving them to fail at runtime.

**Load only what the view needs.** Coverage mode never needed the network snapshot; the
coverage manifest already carries every field the stats table shows. It was fetching 5.3 MB
to read four numbers out of.

**Compression, and a correction worth keeping.** Netlify compresses by content type and
offers no override, so `.bin` files served as `application/octet-stream` came down raw while
the JavaScript was brotli'd. Declaring them `text/plain` in `netlify.toml` fixes it, and
nothing reads the type since the browser uses `arrayBuffer()`. Chosen over forcing
`Content-Encoding: br`, which is unconditional and would hand an undecodable body to a client
that did not accept brotli.

An earlier estimate put ~4 MB on the table for compression. That was measured on the Float64
positions, which compressed ~4× because every coordinate sat near −105, 39.7 and shared long
identical byte prefixes. Those are no longer shipped; Float32 offsets are ~90% of the bytes
and compress only 18%. **The wire-format change had already taken most of that win, and
compression could not claim it twice.** Real saving: 1.5 MB.

---

## 7. The dev loop will lie to you

**React StrictMode double-invokes effects in development**, so the dev server fetches every
region twice. Any byte or decode figure measured against `npm run dev` needs halving.

**HMR makes probes lie.** A `window.__probe` added to an event handler *after* the event has
already fired reports `false` forever, because the handler does not re-run. This cost real
time and led to a change that broke label ordering. Restart the dev server before
instrumenting.

**Vite caches pre-bundled deps.** A dependency change looks like it did nothing until
`node_modules/.vite` is cleared or you run with `--force`. This caused a misdiagnosis: a
version problem was declared "not version-related" because the dev server was serving a
cached bundle.

**FPS counters only work in a foregrounded tab.** The in-app counter is
`requestAnimationFrame`-based, and Chrome throttles rAF to ~0–1 fps in hidden tabs — which is
exactly what an automated screenshot session leaves you with. Early 0–1 fps readings were
measurement artifacts, not render performance.

Three fixed toolchain facts, for completeness:

- **`maplibre-gl` must stay on v5.** `react-map-gl@8` calls `map.transform.width`, which v6
  removed, and its peer range does not exclude the broken major.
- **Node needs explicit `.ts` extensions.** The scripts run under Node's native type
  stripping, which has no extensionless ESM resolution even though tsc and Vite accept it.
- **`HIGHWAY_CLASSES` order is a storage contract.** `classes.bin` holds indices into that
  array. Append only — reordering silently recolours every snapshot already on disk.

---

## 8. Version anything whose meaning can drift

Snapshot versions bump when the **layout or the meaning** changes. Meaning counts: the same
bytes describing a different claim about the world is a new version.

| Version | Change | Why it is a bump |
|---|---|---|
| Network v1 → v2 | Added bike-legal `path`/`bridleway` | Different denominator; a v1 snapshot under v2 code computes the wrong percentage |
| Network v2 → v3 | Added `footway` where `bicycle=designated` | Same reasoning |
| Rides v1 → v2 | Kept out-of-region rides | `rideCount` and `totalMeters` now describe all riding, not metro riding |
| Coverage v1 | — | The match radius is part of the meaning, so changing its default is a bump |

The corollary is the guard: loading a stale artifact must be an *error*, not a wrong number.

---

## 9. Privacy is structural, not incidental

The repo is public. Ride traces, raw Overpass payloads and coverage output are all gitignored
— coverage counts, because *which streets someone has ridden* is location data, and
publishing it would undo the clipping. Clipping runs inside the importer, so unclipped
coordinates never reach disk at all, not even in an intermediate.

**Force-pushing makes a blob unreachable, not gone.** A full-history audit found zero ride,
coverage or secret files ever committed. One real file was: a Zwift `.fit` fixture. It held
no location or identity data — Watopia coordinates, no name, no heart rate — but it carried
one session's power and cadence figures and a device serial, which a public repo has no
reason to publish. After the history rewrite, **GitHub still served the blob by SHA**, and
only GitHub Support can garbage-collect it. Worth knowing before treating a scrub as
complete.

**Removing a fixture is a test problem.** Six tests depended on that file, including the
semicircle conversion check. It was *replaced* rather than deleted:
`test/fixtures/syntheticFit.ts` encodes a FIT in memory with the Garmin SDK's own encoder.
That tested more than the recording did — a single file can only show one combination of
fields, while a builder can check `subSport` and `manufacturer` surviving independently,
which is what the virtual-ride filter actually relies on. Six tests became ten.

**Deploys publish ride traces.** The site is deployed from a *local* build, because the
artifacts are gitignored and cannot reach a git-triggered build. A `predeploy` guard refuses
to ship a site that would render as an empty map — otherwise that failure is silent, since
the deploy succeeds and the map is merely blank.

---

## 10. Built and dropped

**Coverage in PostGIS.** The intended shape was an offline build tool rather than a hosted
database — coverage computed in SQL locally, emitting the same static artifacts — because
putting traces in a hosted DB is a real change in posture after the effort spent keeping them
out of git, and because two independent implementations of coverage would have been a genuine
correctness check. Blocked in practice on PostGIS building against postgresql@17/@18 while
the local server is @14. Not hard to unblock; just not done.

**Nearest-unridden.** Built, working, and cut, along with its pure module and eight tests.
Worth knowing it is tractable client-side: scanning every vertex of every unridden run is a
few tens of milliseconds, no spatial index required.

**Neighbourhood breakdown.** Blocked on data, not code. OSM has 59 neighbourhood elements for
Denver against 78 official ones, in mixed geometry types, and nothing at all for the other 18
regions. The Denver Open Data endpoints tried did not resolve. It needs a confirmed GeoJSON
source before it is worth starting again.

---

## 11. Limits that are not bugs

Each of these follows from a decision above, and is the accepted cost of it.

- **Streets near home can never reach 100%.** The 500 m privacy clip removes those nodes by
  construction — the cost of not storing where the rider lives.
- **A 25 m radius credits some streets merely ridden past.** Denver block spacing reaches
  ~30 m. A third of unmatched points have a rideable way 25–40 m away, so the radius is the
  binding constraint rather than the map — but widening it would also claim streets never
  ridden, and there is no ground truth to separate the two.
- **Dual carriageways read as half-ridden forever.** A divided road is two OSM ways; riding
  one direction leaves the other unhit.
- **Out-of-region rides score nothing.** They draw wherever they happened, but no street
  network was fetched there to credit.
- **The timeline's last frame is 0.012 points short** — 2.85% against an all-time 2.86%.
  Measured: 16 ridden runs, 1.5 km, carry no year at all, because their two endpoints were
  first ridden in different years and the intersection is empty. Right for "during 2022";
  wrong cumulatively. The fix is a per-run `max(firstYear(a), firstYear(b))` stored rather
  than derived — left undone, because it is a format change and a rebuild for a hundredth of
  a point. Recorded so it is not rediscovered as a mystery.

---

## 12. Where to look

| Question | File |
|---|---|
| What is rideable, which regions exist | `src/network/regions.ts` |
| Why a number changed | [`docs/measurements.md`](measurements.md) |
| Matching algorithm | `src/coverage/{grid,nodes,segments,densify}.ts` |
| Year and timeline filtering | `src/coverage/yearFilter.ts` |
| Privacy handling | `src/rides/privacy.ts`, `.gitignore` |
| Render performance | `src/layers/{regionStackLayer,visibility}.ts`, and the memoization in the layer factories |
| Wire format vs build format | `src/network/snapshot.ts` — `PackedBuffers` vs `SnapshotBuffers` |
| Deploy and its guard | `netlify.toml`, `scripts/preflight-deploy.ts` |
| Z-order contract | `src/layers/mapLayers.test.ts` |
