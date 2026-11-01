// Execute the real installed Java callback code against late/overlapping native events.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const sourceArg = process.argv.indexOf('--source');
const sourceFile = sourceArg >= 0 ? process.argv[sourceArg + 1] :
  path.join(root, 'node_modules/@react-native-community/geolocation/android/src/main/java/com/reactnativecommunity/geolocation/PlayServicesLocationManager.java');
const source = fs.readFileSync(sourceFile, 'utf8');
const start = source.indexOf('    private LocationCallback createSingleLocationCallback(');
if (start < 0) throw new Error('Could not find installed native callback');
const methods = source.slice(start, source.lastIndexOf('}')).replace(/@NonNull /g, '');
const sharedField = source.includes('private LocationCallback mSingleLocationCallback;');
const java = `
import java.util.*;
public class GeolocationCallbackRegression {
    private final FakeFused mFusedLocationClient = new FakeFused();
    private LocationCallback mSingleLocationCallback;
    static class WritableMap {}
    interface Callback { void invoke(WritableMap value); }
    static class Location {}
    static class LocationResult {
        final Location value;
        LocationResult(Location value) { this.value = value; }
        Location getLastLocation() { return value; }
    }
    static class LocationAvailability {
        final boolean available;
        LocationAvailability(boolean available) { this.available = available; }
        boolean isLocationAvailable() { return available; }
    }
    static class LocationCallback {
        public void onLocationResult(LocationResult result) {}
        public void onLocationAvailability(LocationAvailability availability) {}
    }
    static class FakeFused {
        final List<LocationCallback> removed = new ArrayList<>();
        void removeLocationUpdates(LocationCallback callback) {
            if (callback == null) throw new NullPointerException("Listener must not be null");
            removed.add(callback);
        }
    }
    static class PositionError {
        static final int POSITION_UNAVAILABLE = 2;
        static WritableMap buildError(int code, String message) { return new WritableMap(); }
    }
    static class Log { static void e(String tag, String message) {} }
    static WritableMap locationToMap(Location location) { return new WritableMap(); }
    ${methods}
    static void check(boolean ok, String message) { if (!ok) throw new AssertionError(message); }
    LocationCallback request(int[] success, int[] error) {
        LocationCallback callback = createSingleLocationCallback(v -> success[0]++, v -> error[0]++);
        if (${sharedField}) mSingleLocationCallback = callback;
        return callback;
    }
    public static void main(String[] args) {
        GeolocationCallbackRegression owner = new GeolocationCallbackRegression();
        int[] success = {0}, error = {0};
        LocationCallback callback = owner.request(success, error);
        callback.onLocationResult(new LocationResult(new Location()));
        callback.onLocationResult(new LocationResult(new Location()));
        callback.onLocationAvailability(new LocationAvailability(false));
        check(success[0] == 1 && error[0] == 0, "Duplicate native events must settle success once");
        check(owner.mFusedLocationClient.removed.equals(Arrays.asList(callback)), "Cleanup must remove only its own callback once");

        owner = new GeolocationCallbackRegression();
        int[] a = {0}, b = {0};
        LocationCallback first = owner.request(a, new int[]{0});
        LocationCallback second = owner.request(b, new int[]{0});
        first.onLocationResult(new LocationResult(new Location()));
        second.onLocationResult(new LocationResult(new Location()));
        check(a[0] == 1 && b[0] == 1, "Overlapping requests must each succeed");
        check(owner.mFusedLocationClient.removed.equals(Arrays.asList(first, second)), "Each request must remove itself, never another listener");

        owner = new GeolocationCallbackRegression();
        success = new int[]{0}; error = new int[]{0};
        callback = owner.request(success, error);
        callback.onLocationAvailability(new LocationAvailability(false));
        callback.onLocationResult(new LocationResult(new Location()));
        callback.onLocationAvailability(new LocationAvailability(false));
        check(success[0] == 0 && error[0] == 1, "Unavailable then late result must settle error once");
        check(owner.mFusedLocationClient.removed.equals(Arrays.asList(callback)), "Error must clean up the listener once");

        owner = new GeolocationCallbackRegression();
        success = new int[]{0}; error = new int[]{0};
        callback = owner.request(success, error);
        callback.onLocationResult(new LocationResult(null));
        callback.onLocationResult(new LocationResult(new Location()));
        check(success[0] == 0 && error[0] == 1, "Null position must not later become success");
        check(owner.mFusedLocationClient.removed.equals(Arrays.asList(callback)), "Null position must clean up its listener");
        System.out.println("PASS: duplicate result, overlapping requests, late result after error, null position");
    }
}
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-geolocation-'));
const bin = (name) => process.env.JAVA_HOME ?
  path.join(process.env.JAVA_HOME, 'bin', name + (process.platform === 'win32' ? '.exe' : '')) : name;
let status = 1;
try {
  const file = path.join(dir, 'GeolocationCallbackRegression.java');
  fs.writeFileSync(file, java);
  const compile = spawnSync(bin('javac'), ['-d', dir, file], { encoding: 'utf8' });
  if (compile.status !== 0) throw new Error(compile.stderr || String(compile.error));
  const run = spawnSync(bin('java'), ['-cp', dir, 'GeolocationCallbackRegression'], { encoding: 'utf8' });
  process.stdout.write(run.stdout || '');
  process.stderr.write(run.stderr || '');
  status = run.status ?? 1;
} finally {
  if (path.dirname(path.resolve(dir)) !== path.resolve(os.tmpdir()) || !path.basename(dir).startsWith('pickup-geolocation-')) {
    throw new Error('Refusing cleanup outside the generated regression-test directory');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}
process.exitCode = status;
