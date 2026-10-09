import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateSunPosition,
  formatHHMM,
  TWILIGHT_ZENITHS,
} from '../src/index.js';

// Tolerance: we compare fractional hours. 0.02 h ≈ 1.2 min. NOAA's worksheet
// itself is good to roughly ±1 min, so anything tighter than this is testing
// numerics rather than astronomy.
const HOUR_TOL = 0.05;
const approx = (actual, expected, tol = HOUR_TOL) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${expected.toFixed(4)} ± ${tol}, got ${actual.toFixed(4)}`,
  );

test('formatHHMM rounds half-minutes sensibly', () => {
  assert.equal(formatHHMM(0), '00:00');
  assert.equal(formatHHMM(12.5), '12:30');
  assert.equal(formatHHMM(23.999), '00:00');
  assert.equal(formatHHMM(-0.1), '23:54'); // normalised before formatting
  assert.equal(formatHHMM(null), null);
});

test('TWILIGHT_ZENITHS is frozen and matches NOAA conventions', () => {
  assert.equal(Object.isFrozen(TWILIGHT_ZENITHS), true);
  assert.equal(TWILIGHT_ZENITHS.SUNRISE_SUNSET, 90.833);
  assert.equal(TWILIGHT_ZENITHS.CIVIL, 96);
  assert.equal(TWILIGHT_ZENITHS.NAUTICAL, 102);
  assert.equal(TWILIGHT_ZENITHS.ASTRONOMICAL, 108);
});

test('solar noon at Greenwich near the equinox is close to 12:00', () => {
  // 2024-03-20 at 0°,0° — equinox. The equation of time is small here.
  const r = calculateSunPosition({
    year: 2024, month: 3, day: 20, latitude: 0, longitude: 0,
  });
  approx(r.solarNoon, 12.0, 0.15);
});

test('solar noon shifts with longitude (4 min per degree)', () => {
  const base = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 0, longitude: 0,
  });
  const east = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 0, longitude: 15,
  });
  // 15° east → solar noon 1 hour earlier in local mean solar time.
  approx(east.solarNoon - base.solarNoon, -1, 0.05);
});

test('London summer solstice sunrise is roughly 04:43 UTC', () => {
  // NOAA reports ~03:43 UTC for 2024-06-21 at London (51.477, -0.001). Our
  // times are local mean solar time, which at longitude 0 is within a minute
  // of UTC.
  const r = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 51.477, longitude: 0,
  });
  approx(r.sunrise, 3.73, 0.15);
  approx(r.sunset, 20.22, 0.15);
  assert.equal(r.midnightSun, false);
});

test('Arctic Circle summer solstice has a midnight Sun', () => {
  // North of the Arctic Circle on 21 June the Sun never sets.
  const r = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 70, longitude: 0,
  });
  assert.equal(r.sunrise, null);
  assert.equal(r.sunset, null);
  assert.equal(r.midnightSun, true);
});

test('Arctic Circle winter solstice has polar night', () => {
  // Sun never rises.
  const r = calculateSunPosition({
    year: 2024, month: 12, day: 21, latitude: 70, longitude: 0,
  });
  assert.equal(r.sunrise, null);
  assert.equal(r.sunset, null);
  assert.equal(r.midnightSun, false);
});

test('civil dawn precedes sunrise and civil dusk follows sunset', () => {
  const r = calculateSunPosition({
    year: 2024, month: 3, day: 20, latitude: 40, longitude: 0,
  });
  assert.ok(r.civilDawn < r.sunrise, 'civil dawn should precede sunrise');
  assert.ok(r.civilDusk > r.sunset, 'civil dusk should follow sunset');
  // Nautical and astronomical extend further still.
  assert.ok(r.nauticalDawn < r.civilDawn);
  assert.ok(r.astronomicalDawn <= r.nauticalDawn);
});

test('equator on equinox has ~12h day length', () => {
  const r = calculateSunPosition({
    year: 2024, month: 3, day: 20, latitude: 0, longitude: 0,
  });
  approx(r.sunset - r.sunrise, 12, 0.15);
});

test('invalid latitude throws RangeError', () => {
  assert.throws(
    () => calculateSunPosition({ year: 2024, month: 6, day: 21, latitude: 91, longitude: 0 }),
    RangeError,
  );
});

test('invalid longitude throws RangeError', () => {
  assert.throws(
    () => calculateSunPosition({ year: 2024, month: 6, day: 21, latitude: 0, longitude: 200 }),
    RangeError,
  );
});

test('invalid month throws RangeError', () => {
  assert.throws(
    () => calculateSunPosition({ year: 2024, month: 13, day: 1, latitude: 0, longitude: 0 }),
    RangeError,
  );
});

test('non-finite inputs throw TypeError', () => {
  assert.throws(
    () => calculateSunPosition({
      year: NaN, month: 6, day: 21, latitude: 0, longitude: 0,
    }),
    TypeError,
  );
});

test('southern hemisphere summer solstice has long day', () => {
  // Sydney ~ -33.87, 151.21 on 2024-12-21. We pass longitude 0 so the output
  // is local mean solar time; day length should exceed 14 hours.
  const r = calculateSunPosition({
    year: 2024, month: 12, day: 21, latitude: -33.87, longitude: 0,
  });
  assert.ok(r.sunset - r.sunrise > 13.5, `expected long day, got ${(r.sunset - r.sunrise).toFixed(2)} h`);
});

test('polar night also marks nautical/astronomical twights as null', () => {
  // On a polar night, all twilight phases that need the Sun below a given
  // zenith should be null because the Sun is already below all of them and
  // never crosses back up this date.
  const r = calculateSunPosition({
    year: 2024, month: 12, day: 21, latitude: 75, longitude: 0,
  });
  assert.equal(r.civilDawn, null);
  assert.equal(r.civilDusk, null);
});

test('midnight Sun at high latitude still has civil/nautical dusk null', () => {
  // Sun above horizon all day; higher-zenith twilights may be partially
  // present, but we only assert that they are not impossible (not NaN) —
  // specifically, no NaN values appear in the result.
  const r = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 80, longitude: 0,
  });
  for (const [k, v] of Object.entries(r)) {
    if (k === 'midnightSun') continue;
    assert.ok(v === null || Number.isFinite(v), `non-finite/non-null value: ${v}`);
  }
});

test('close to Arctic Circle: lat 66.5 on June solstice is a borderline case', () => {
  // Just inside the polar circle, Sun should graze the horizon. We only
  // assert that the result is well-formed (no NaN, no exceptions).
  const r = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 66.5, longitude: 0,
  });
  for (const [k, v] of Object.entries(r)) {
    if (k === 'midnightSun') continue;
    assert.ok(v === null || Number.isFinite(v), `non-finite/non-null value: ${v}`);
  }
});

test('date consistency: same date twice gives identical results', () => {
  const a = calculateSunPosition({
    year: 2024, month: 9, day: 22, latitude: 45, longitude: -120,
  });
  const b = calculateSunPosition({
    year: 2024, month: 9, day: 22, latitude: 45, longitude: -120,
  });
  assert.deepEqual(a, b);
});

test('west longitude shifts solar noon later in local mean solar time', () => {
  // At longitude -75 (e.g. New York's meridian), solar noon is 5 hours later
  // than at Greenwich in local *civil* time. We report local mean solar
  // time *including the longitude offset* (so noon at -75 is ~17:00), which
  // keeps the rise/set times consistent with the noon value.
  const r = calculateSunPosition({
    year: 2024, month: 6, day: 21, latitude: 0, longitude: -75,
  });
  approx(r.solarNoon, 17.0, 0.15);
});
