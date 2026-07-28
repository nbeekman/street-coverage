/**
 * FIT stores positions as semicircles: a signed 32-bit integer spanning the
 * full circle, so 2^31 semicircles == 180 degrees.
 *
 * The Garmin SDK returns these raw. Decoding with `applyScaleAndOffset: true`
 * does NOT convert them -- verified against @garmin/fitsdk@21.208.0 on
 * 2026-07-28. Skipping this conversion yields coordinates that are silently
 * wrong rather than obviously broken.
 */
const SEMICIRCLES_TO_DEGREES = 180 / 2 ** 31

export function semicirclesToDegrees(semicircles: number): number {
  return semicircles * SEMICIRCLES_TO_DEGREES
}

export function degreesToSemicircles(degrees: number): number {
  return degrees / SEMICIRCLES_TO_DEGREES
}
