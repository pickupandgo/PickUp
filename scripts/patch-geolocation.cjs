// Targeted, version-checked native hotfix. Runs after npm install/ci; no extra patch dependency.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const pkg = path.join(root, 'node_modules', '@react-native-community', 'geolocation');
const version = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8')).version;
if (version !== '3.4.0') throw new Error('Review the geolocation native hotfix before changing version ' + version);
const target = path.join(pkg, 'android/src/main/java/com/reactnativecommunity/geolocation/PlayServicesLocationManager.java');
let source = fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
const marker = '// PICKUP: each one-shot callback owns its cleanup and settles exactly once.';
if (source.includes(marker)) {
  console.log('Geolocation callback hotfix already applied.');
  process.exit(0);
}
if (!source.includes('private LocationCallback mSingleLocationCallback;')) throw new Error('Unexpected geolocation native source');
const sharedAssignments = /mSingleLocationCallback = createSingleLocationCallback\(success, error\);\n\s*checkLocationSettings\(options, mSingleLocationCallback, error\);/g;
if ((source.match(sharedAssignments) || []).length !== 2) throw new Error('Unexpected one-shot callback assignments');
source = source.replace('    private LocationCallback mSingleLocationCallback;\n', '');
source = source.replace(sharedAssignments,
  'LocationCallback singleLocationCallback = createSingleLocationCallback(success, error);\n' +
  '            checkLocationSettings(options, singleLocationCallback, error);');
const start = source.indexOf('    private LocationCallback createSingleLocationCallback(');
const end = source.indexOf('    private static class CallbackHolder', start);
if (start < 0 || end < 0) throw new Error('Cannot locate native callback hotfix boundaries');
const callback = `
    private LocationCallback createSingleLocationCallback(Callback success, Callback error) {
        final CallbackHolder callbackHolder = new CallbackHolder(success, error);

        return new LocationCallback() {
            ${marker}
            private boolean settled = false;

            private boolean finish() {
                if (settled) return false;
                settled = true;
                // Never remove a shared mutable field: another request may have replaced/cleared it.
                mFusedLocationClient.removeLocationUpdates(this);
                return true;
            }

            @Override
            public void onLocationResult(@NonNull LocationResult locationResult) {
                if (!finish()) return;
                Location location = locationResult.getLastLocation();
                if (location == null) {
                    callbackHolder.error(PositionError.buildError(PositionError.POSITION_UNAVAILABLE, "No location provided (FusedLocationProvider/lastLocation)."));
                    return;
                }
                callbackHolder.success(location);
            }

            @Override
            public void onLocationAvailability(@NonNull LocationAvailability locationAvailability) {
                if (!locationAvailability.isLocationAvailable() && finish()) {
                    callbackHolder.error(PositionError.buildError(PositionError.POSITION_UNAVAILABLE, "Location not available (FusedLocationProvider/lastLocation)."));
                }
            }
        };
    }

`;
source = source.slice(0, start) + callback + source.slice(end);
fs.writeFileSync(target, source);
console.log('Applied geolocation per-request callback hotfix (3.4.0).');
