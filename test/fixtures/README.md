# Test fixtures

`zwift-virtual.fit` is a real Zwift activity. It exercises the two things most likely to
break: semicircle conversion, and virtual-ride detection.

Its coordinates are Watopia (-11.64, 166.95), roughly 13,000 km from Denver — which is
exactly why the out-of-region filter needs a test.

This file contains no personal location data. **Do not add real outdoor rides here** —
ride traces are gitignored everywhere else in this repo for that reason.
