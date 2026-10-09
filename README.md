# Sun Position Calculator

Calculates solar noon, sunrise, sunset, and four twilight phases (civil, nautical, astronomical) for any latitude, longitude, and date using the NOAA solar position worksheet. Zero runtime dependencies, ESM only.

```js
import { calculateSunPosition, formatHHMM } from 'sun-position-calculator';

const r = calculateSunPosition({
  year: 2024, month: 6, day: 21,
  latitude: 51.477,  // London
  longitude: -0.001,
});

console.log(formatHHMM(r.sunrise));           // ~"03:43"
console.log(formatHHMM(r.solarNoon));         // ~"12:02"
console.log(formatHHMM(r.astronomicalDusk));  // ~"23:04"
console.log(r.midnightSun);                   // false
```

## Why this exists

Existing JS solar libraries either ship a large general-purpose astronomy stack or pull in `moment`/`luxon` for timezone handling. This library does one thing: it turns a `(lat, lon, date)` triple into rise/set times. It exists because the author needed civil-twilight bounds inside a serverless function with a cold-start budget, and pulling a 200 KB astronomy library for four numbers was not defensible.

The trade-off is precision and timezone handling. The NOAA worksheet this implements is good to about ±1 minute of UT for mid-latitudes between 1900 and 2100; outside that range it drifts. Times are returned as fractional hours in *local mean solar time*, not civil time — converting to UTC or a named zone is left to the caller. This keeps the library free of timezone tables and makes every result deterministic.

## The awkward edge

Near the polar circles the Sun can graze the horizon for an entire day. The library returns `null` for whichever phases do not occur on the given date and sets `midnightSun: true` when the Sun never dips below the horizon at the `SUNRISE_SUNSET` zenith (90.833°). Twilight phases at higher zenith angles may still report times even during a midnight Sun, or may themselves be `null`; the `midnightSun` flag refers specifically to the Sun crossing the apparent horizon, not to the higher-zenith thresholds. If you need to render "the Sun never sets this week" for a polar context, check `midnightSun` first and treat the twilight values as informational.

## Exports

- `calculateSunPosition({ year, month, day, latitude, longitude })` → object with `solarNoon`, `sunrise`, `sunset`, `civilDawn`, `civilDusk`, `nauticalDawn`, `nauticalDusk`, `astronomicalDawn`, `astronomicalDusk`, `midnightSun`. Each time is a fractional hour in local mean solar time, normalised to `[0, 24)`. Phases that do not occur on the date are `null`.
- `formatHHMM(fractionalHour | null)` → `"HH:MM"` or `null`. Rounds to the nearest minute.
- `TWILIGHT_ZENITHS` → frozen object `{ SUNRISE_SUNSET: 90.833, CIVIL: 96, NAUTICAL: 102, ASTRONOMICAL: 108 }`.

Longitudes are east-positive, latitudes north-positive. Inputs outside their natural ranges throw `RangeError`; non-finite inputs throw `TypeError`.
