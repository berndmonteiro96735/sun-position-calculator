/**
 * Sun position core algorithms.
 *
 * Implements the NOAA / Spencer-style solar position calculations. All times
 * are returned as fractional hours in the range [0, 24). The caller is
 * responsible for converting to a civil timezone.
 *
 * Design decisions:
 *   - Fractional hours (not Date) so results are timezone-agnostic and easy to
 *     test deterministically.
 *   - Angles in degrees throughout. Radians are used only transiently inside
 *     trigonometric helpers. This matches the form in which the NOAA
 *     worksheets are published and makes auditing the formulas easier.
 *   - Julian dates are in the "days since J2000" convention (JD - 2451545.0),
 *     which keeps numbers small and doubles precise enough for arcminute-level
 *     results.
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/** Solar zenith angle (degrees from vertical) for each twilight phase. */
export const TWILIGHT_ZENITHS = Object.freeze({
  SUNRISE_SUNSET: 90.833, // atmospheric refraction at the horizon
  CIVIL: 96,
  NAUTICAL: 102,
  ASTRONOMICAL: 108,
});

const sin = (deg) => Math.sin(deg * DEG2RAD);
const cos = (deg) => Math.cos(deg * DEG2RAD);
const acos = (x) => {
  // Numerical noise can push the argument just outside [-1, 1]; clamp it so
  // callers near the polar-circle boundary get a real answer rather than NaN.
  const clamped = Math.max(-1, Math.min(1, x));
  return Math.acos(clamped) * RAD2DEG;
};

const toHours = (value) => {
  // Normalise a time-of-day to [0, 24). A rise that resolves to -0.4 (23:36)
  // and a set at 0.2 (00:12) both belong on this date; the caller decides what
  // that means.
  const v = value % 24;
  return v < 0 ? v + 24 : v;
};

/**
 * Whole days from J2000 (2000-01-01 12:00 UT) to the given date at 00:00 UT.
 * Bessel's integer-offset scheme — accurate to better than a minute over the
 * years a civil application cares about.
 */
const julianDay2000 = (year, month, day) => {
  // Use the astronomical convention: Jan/Feb are treated as months 13/14 of
  // the prior year, so leap-day handling reduces to one integer division.
  let y = year;
  let m = month;
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  // -0.5 day accounts for the fact that JD starts at noon UT while our date
  // starts at midnight.
  const jd =
    Math.floor(365.25 * (y + 4716)) +
    Math.floor(30.6001 * (m + 1)) +
    day +
    b -
    1524.5;
  return jd - 2451545.0;
};

/** Geometric mean longitude of the Sun (degrees). */
const meanSolarLongitude = (t) => 280.46646 + t * (36000.76983 + t * 0.0003032);

/** Geometric mean anomaly of the Sun (degrees). */
const meanSolarAnomaly = (t) => 357.52911 + t * (35999.05029 - t * 0.0001537);

/** Eccentricity of Earth's orbit (dimensionless). */
const earthEccentricity = (t) => 0.016708634 - t * (0.000042037 + t * 0.0000001267);

/** Equation of center for the Sun (degrees), to harmonic order 3. */
const sunEquationOfCenter = (t, m) => {
  return (
    sin(m) * (1.914602 - t * (0.004817 + t * 0.000014)) +
    sin(2 * m) * (0.019993 - t * 0.000101) +
    sin(3 * m) * 0.000289
  );
};

/**
 * Sun's true longitude (degrees, mean equinox of date).
 */
const sunTrueLongitude = (t, m) => meanSolarLongitude(t) + sunEquationOfCenter(t, m);

/**
 * Apparent longitude (true longitude corrected for nutation and aberration,
 * degrees).
 */
const sunApparentLongitude = (t, lambda) => {
  const omega = 125.04 - t * 1934.136;
  return lambda - 0.00569 - 0.00478 * sin(omega);
};

/** Mean obliquity of the ecliptic, corrected for nutation (degrees). */
const correctedObliquity = (t) => {
  const base = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const omega = 125.04 - t * 1934.136;
  return base + 0.00256 * cos(omega);
};

/**
 * Equation of time (minutes) — the difference between apparent solar time and
 * mean solar time. Used to convert between clock noon and true solar noon.
 */
const equationOfTime = (t, m, e) => {
  const y = Math.tan(correctedObliquity(t) / 2 * DEG2RAD);
  const y2 = y * y;
  const l = meanSolarLongitude(t);
  const sin2l = sin(2 * l);
  const sin4l = sin(4 * l);
  const sinm = sin(m);
  const sin2m = sin(2 * m);
  // NOAA's polynomial form. Deliberately written in a single expression so it
  // matches the published worksheet term-for-term.
  return 4 * RAD2DEG * (
    y2 * sin2l -
    2 * e * sinm +
    4 * e * y2 * sinm * cos(2 * l) -
    0.5 * y2 * y2 * sin4l -
    1.25 * e * e * sin2m
  );
};

/**
 * Declination of the Sun (degrees north of the celestial equator).
 */
const sunDeclination = (t, lambda, epsilon) => {
  return Math.asin(sin(epsilon) * sin(lambda)) * RAD2DEG;
};

/**
 * Hour angle (degrees) at which the Sun reaches a given zenith angle.
 * Returns `null` when the Sun never reaches that angle on this date —
 * the polar-day / polar-night case. Callers must handle the null.
 */
const hourAngleAtZenith = (latitude, declination, zenith) => {
  const lat = sin(latitude);
  const dec = sin(declination);
  const zen = cos(zenith);
  const arg = (zen - lat * dec) / (cos(latitude) * cos(declination));
  if (arg < -1 || arg > 1) return null;
  return acos(arg);
};

/**
 * Solar noon (fractional hour, local apparent time adjusted for the equation
 * of time and longitude offset). Uses a caller-supplied longitude offset so
 * the caller controls the timezone convention.
 */
const solarNoonHour = (t, longitudeDegrees) => {
  const m = meanSolarAnomaly(t);
  const e = earthEccentricity(t);
  const eqt = equationOfTime(t, m, e);
  // Solar noon at a given longitude occurs when the Sun transits the local
  // meridian. Each degree of longitude east of the reference shifts noon by 4
  // minutes earlier; west shifts it later.
  return toHours(12 - eqt / 60 - longitudeDegrees / 15);
};

/**
 * Sunrise / sunset pair at a given zenith threshold.
 * Returns `{ rise, set }` in fractional local hours, or `null` for whichever
 * phase is absent on this date (polar conditions).
 */
const riseSetAtZenith = (t, latitude, longitude, zenith) => {
  const m = meanSolarAnomaly(t);
  const e = earthEccentricity(t);
  const lambda0 = sunTrueLongitude(t, m);
  const lambda = sunApparentLongitude(t, lambda0);
  const epsilon = correctedObliquity(t);
  const dec = sunDeclination(t, lambda, epsilon);
  const ha = hourAngleAtZenith(latitude, dec, zenith);
  if (ha === null) {
    // arg > 1 → Sun never rises (polar night). arg < -1 → Sun never sets (midnight Sun).
    const arg = (cos(zenith) - sin(latitude) * sin(dec)) / (cos(latitude) * cos(dec));
    return { rise: null, set: null, midnightSun: arg < -1 };
  }
  const eqt = equationOfTime(t, m, e);
  const noon = 12 - eqt / 60 - longitude / 15;
  const halfDay = ha / 15; // 15° per hour
  return {
    rise: toHours(noon - halfDay),
    set: toHours(noon + halfDay),
    midnightSun: false,
  };
};

/**
 * Fractional-hour conversion of the [0, 24) value into `HH:MM` text.
 * Kept here so callers and tests share one formatter. Rounds to the nearest
 * minute.
 */
export const formatHHMM = (fractionalHour) => {
  if (fractionalHour === null || fractionalHour === undefined) return null;
  const totalMinutes = Math.round(fractionalHour * 60);
  const h = Math.floor((totalMinutes % 1440 + 1440) / 60) % 24;
  const mm = ((totalMinutes % 60) + 60) % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};

/**
 * Calculate solar positions and phases for a given date and observer location.
 *
 * @param {object} args
 * @param {number} args.year  Gregorian year, e.g. 2024.
 * @param {number} args.month Month 1-12.
 * @param {number} args.day   Day of month 1-31.
 * @param {number} args.latitude  Observer latitude in degrees, north positive.
 * @param {number} args.longitude Observer longitude in degrees, east positive.
 * @returns {{
 *   solarNoon: number,
 *   sunrise: (number|null),
 *   sunset: (number|null),
 *   civilDawn: (number|null),
 *   civilDusk: (number|null),
 *   nauticalDawn: (number|null),
 *   nauticalDusk: (number|null),
 *   astronomicalDawn: (number|null),
 *   astronomicalDusk: (number|null),
 *   midnightSun: boolean,
 * }} Times are fractional hours in local mean solar time. Times that do not
 *   occur on this date are `null`.
 */
export const calculateSunPosition = ({ year, month, day, latitude, longitude }) => {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new TypeError('year/month/day must be finite numbers');
  }
  if (month < 1 || month > 12) throw new RangeError(`month out of range: ${month}`);
  if (day < 1 || day > 31) throw new RangeError(`day out of range: ${day}`);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`longitude out of range: ${longitude}`);
  }

  const t = julianDay2000(year, month, day) / 36525;
  const noon = solarNoonHour(t, longitude);

  const at = (zenith) => riseSetAtZenith(t, latitude, longitude, zenith);

  const sr = at(TWILIGHT_ZENITHS.SUNRISE_SUNSET);
  const civil = at(TWILIGHT_ZENITHS.CIVIL);
  const nautical = at(TWILIGHT_ZENITHS.NAUTICAL);
  const astro = at(TWILIGHT_ZENITHS.ASTRONOMICAL);

  // midnightSun flag follows the most permissive of the thresholds (the
  // horizon one). If the Sun grazes the horizon, the higher zeniths may still
  // dip below it, but the meaningful "does it stay up" question is at the
  // surface.
  return {
    solarNoon: noon,
    sunrise: sr.rise,
    sunset: sr.set,
    civilDawn: civil.rise,
    civilDusk: civil.set,
    nauticalDawn: nautical.rise,
    nauticalDusk: nautical.set,
    astronomicalDawn: astro.rise,
    astronomicalDusk: astro.set,
    midnightSun: sr.midnightSun,
  };
};
