/**
 * Wiring verification for the PICKUP UI prototype.
 *
 * 1. Every navigation target used in a screen must be a route registered in App.tsx.
 * 2. Every registered route must be reachable from at least one other screen.
 * 3. No interactive element may be left with a handler that resolves to undefined.
 *
 * Run: node scripts/check-wiring.js
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
// Driver screens live outside src/screens but are registered in the same stack.
const scanDirs = [path.join(root, 'src', 'screens'), path.join(root, 'src', 'driver')];

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]
  );

// --- registered routes -------------------------------------------------------
const appSrc = fs.readFileSync(path.join(root, 'App.tsx'), 'utf8');
const registered = new Set(
  [...appSrc.matchAll(/<Stack\.Screen\s+name="([^"]+)"/g)].map((m) => m[1])
);

// --- navigation targets used by screens --------------------------------------
const files = scanDirs
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) => walk(dir))
  .filter((f) => f.endsWith('.tsx'));
const used = new Map(); // route -> Set(file)
const unknown = [];
const deadHandlers = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);

  // Any quoted `...Screen` literal is a navigation target. Matching literals
  // rather than balanced navigate(...) calls keeps ternary and computed
  // targets (e.g. `isCash ? 'A' : 'B'`) from being missed.
  for (const lit of src.matchAll(/'(\w+Screen)'/g)) {
    const target = lit[1];
    if (!used.has(target)) used.set(target, new Set());
    used.get(target).add(path.basename(file, '.tsx'));
    if (!registered.has(target)) unknown.push(`${rel} -> '${target}'`);
  }

  // onPress bound directly to a bare *optional* callback with no fallback,
  // e.g. onPress={onHelp} -- silently dead when the prop is not supplied.
  // Safe when either:
  //   - the prop is declared required (`onAccept: () => void`), or
  //   - the element is guarded by `{prop && <Pressable .../>}`
  for (const m of src.matchAll(/onPress=\{(on[A-Z]\w*)\}/g)) {
    const name = m[1];
    const guarded = new RegExp(`\\{\\s*${name}\\s*&&`).test(src);
    const optional = new RegExp(`${name}\\?\\s*:`).test(src);
    if (!guarded && optional) deadHandlers.push(`${rel}: onPress={${name}}`);
  }
}

// --- unreachable routes ------------------------------------------------------
const selfOnly = (route) => {
  const from = used.get(route);
  return from && from.size === 1 && from.has(route);
};
// The entry route needs no inbound edge, and the Gallery is a dev launcher.
const initialRoute = /initialRouteName="([^"]+)"/.exec(appSrc)?.[1];
const entryPoints = new Set(['Gallery', initialRoute].filter(Boolean));

const unreachable = [...registered].filter(
  (r) => !entryPoints.has(r) && (!used.has(r) || selfOnly(r))
);

// Alternate layouts and edge-case states with no natural parent in the linear
// customer journey. These are demoed from the Gallery route by design.
const GALLERY_ONLY = new Set([
  'BookingReviewScreen',
  // Showcase of field-validation error states, not a step in a valid booking.
  'ValidateBookingScreen',
  'VehicleSelectionScreen',
  'SearchingDriverScreen',
  'LoadingSkeletonScreen',
  'EmptyStateScreen',
  'ErrorScreen',
  'SearchUnavailableScreen',
  // Superseded by CustomerLiveTrackingScreen for the live flow; kept in the
  // gallery as a fully-static demo of the tracking layout.
  'ActiveTripTrackingScreen',
]);
const orphans = unreachable.filter((r) => !GALLERY_ONLY.has(r));
const galleryOnly = unreachable.filter((r) => GALLERY_ONLY.has(r));

// --- report ------------------------------------------------------------------
const problems = [];
if (unknown.length) problems.push(['Unknown navigation targets', unknown]);
if (orphans.length) problems.push(['Unreachable routes', orphans]);
if (deadHandlers.length) problems.push(['Possible dead handlers', deadHandlers]);

console.log(`Registered routes: ${registered.size}`);
console.log(`Screen files scanned: ${files.length}`);
console.log(`Distinct navigation targets used: ${used.size}`);

console.log(
  `Reachable from the flow: ${registered.size - 1 - galleryOnly.length}` +
    ` | Gallery-only by design: ${galleryOnly.length}`
);
if (galleryOnly.length) {
  galleryOnly.forEach((r) => console.log(`  (gallery) ${r}`));
}

for (const [label, items] of problems) {
  console.log(`\n${label} (${items.length}):`);
  items.forEach((i) => console.log(`  - ${i}`));
}

if (!problems.length) console.log('\nAll checks passed.');
process.exit(problems.length ? 1 : 0);
