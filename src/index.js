/**
 * Public surface for the sun-position-calculator library.
 *
 * Re-exports everything callers need. Keeping the indirection lets the core
 * module grow without breaking consumers that import from the package root.
 */
export {
  calculateSunPosition,
  formatHHMM,
  TWILIGHT_ZENITHS,
} from './core.js';
