# Test fixtures

**No binary recording lives here.** `syntheticFit.ts` encodes a FIT file in memory at test
time, using the Garmin SDK's own encoder.

This replaced a real Zwift recording. That file carried no location or identity data — its
coordinates are Watopia, Zwift's virtual world — but it did carry one session's power,
cadence and calorie figures plus a device serial, and a public repo has no need of them.

Generating the fixture turned out to test *more*, not less. A single recording could only
show one combination of fields; the builder takes options, so the suite can now check that
`subSport` and `manufacturer` each survive parsing on their own — which matters because the
virtual-ride filter rejects on either alone — and that a session with no positions yields no
points, the trainer-ride case.

Positions are written as raw **semicircles**, the unit FIT actually stores, so the conversion
the parser must perform is exercised in the direction it really happens. Skipping it produces
values like `-138818392`: silently wrong rather than obviously broken.

**Do not add real rides here.** Ride traces are gitignored everywhere else in this repo
precisely so they are never published; a fixture is not an exception.
