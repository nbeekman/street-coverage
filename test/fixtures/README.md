# Test fixtures

`zwift-virtual.fit` is a real Zwift activity, included because it exercises the two things
most likely to break: semicircle conversion, and virtual-ride detection.

Its coordinates are Watopia — Zwift's virtual world, in the Solomon Sea and nowhere near any
real riding — which is exactly why the out-of-region filter needs a test.

**What it does and does not contain.** No name, no email, no user id, and no heart-rate data
(the field is present but zero throughout). It does carry one session's power, cadence and
calorie figures, a timestamp, and a Zwift-generated device serial. That is performance data,
not location data.

**Do not add real outdoor rides here.** Ride traces are gitignored everywhere else in this
repo precisely so they are never published; a fixture is not an exception to that.
