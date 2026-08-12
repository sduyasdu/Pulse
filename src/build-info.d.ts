// Build-time constants injected by Vite's `define` (see vite.config.ts).
// They are substituted as literals at build time, so they exist in the bundle
// but not in the module graph — hence the ambient declarations.

/** Short SHA of the commit this bundle was built from, or "unknown". */
declare const __APP_COMMIT__: string;
/** Build date, YYYY-MM-DD. The source of the copyright year (About-Spec AB8). */
declare const __APP_BUILT__: string;
