package com.multipleride.driver.location

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.module.annotations.ReactModule

/**
 * React Native native module exposing the Kotlin location subsystem to JavaScript.
 *
 * This module is the boundary between React Native and the native location layer.
 * It does NOT contain business logic — it translates RN calls to [LocationManager]
 * operations and emits events via [LocationEventEmitter].
 *
 * Exposed to JS as "PickUpLocationModule".
 */
@ReactModule(name = LocationModule.NAME)
class LocationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "PickUpLocationModule"
    }

    private val locationManager = LocationManager(reactContext)
    private val eventEmitter = LocationEventEmitter(reactContext)

    override fun getName(): String = NAME

    // ─── Permission ────────────────────────────────────────────────────

    /**
     * Returns the current location permission state.
     * Resolves with: "granted" | "denied" | "permanently_denied" | "not_determined"
     */
    @ReactMethod
    fun getPermissionStatus(promise: Promise) {
        val fineGranted = ContextCompat.checkSelfPermission(
            reactApplicationContext,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        val coarseGranted = ContextCompat.checkSelfPermission(
            reactApplicationContext,
            Manifest.permission.ACCESS_COARSE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED

        val state = when {
            fineGranted || coarseGranted -> PermissionState.GRANTED
            else -> PermissionState.DENIED
        }

        promise.resolve(state.value)
    }

    /**
     * Returns whether background location permission is granted.
     * Only relevant on Android 10+ (API 29+).
     */
    @ReactMethod
    fun hasBackgroundPermission(promise: Promise) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val granted = ContextCompat.checkSelfPermission(
                reactApplicationContext,
                Manifest.permission.ACCESS_BACKGROUND_LOCATION,
            ) == PackageManager.PERMISSION_GRANTED
            promise.resolve(granted)
        } else {
            // Pre-Q: background location is implicit with foreground permission
            promise.resolve(true)
        }
    }

    /**
     * Returns whether location providers (GPS/network) are enabled.
     */
    @ReactMethod
    fun isProviderEnabled(promise: Promise) {
        promise.resolve(locationManager.isLocationProviderEnabled())
    }

    // ─── Current Location ──────────────────────────────────────────────

    /**
     * Gets the current device location.
     * Resolves with a location object or rejects with an error.
     */
    @ReactMethod
    fun getCurrentLocation(promise: Promise) {
        locationManager.getCurrentLocation(
            onResult = { result ->
                val map = Arguments.createMap().apply {
                    putDouble("latitude", result.latitude)
                    putDouble("longitude", result.longitude)
                    putDouble("accuracy", result.accuracy.toDouble())
                    putDouble("altitude", result.altitude)
                    putDouble("speed", result.speed.toDouble())
                    putDouble("bearing", result.bearing.toDouble())
                    putDouble("timestamp", result.timestamp.toDouble())
                    putString("provider", result.provider)
                }
                promise.resolve(map)
            },
            onError = { error ->
                promise.reject(error.code, error.message)
            },
        )
    }

    // ─── Continuous Tracking ───────────────────────────────────────────

    /**
     * Starts continuous location tracking with the given configuration.
     *
     * @param config ReadableMap with optional keys:
     *   - priority (int): LocationConfig.PRIORITY_* constant
     *   - intervalMs (int): Update interval in ms
     *   - fastestIntervalMs (int): Fastest interval in ms
     *   - minDisplacementMeters (double): Minimum displacement
     */
    @ReactMethod
    fun startTracking(config: ReadableMap?, promise: Promise) {
        val priority = if (config?.hasKey("priority") == true) {
            config.getInt("priority")
        } else {
            LocationConfig.PRIORITY_HIGH_ACCURACY
        }

        val intervalMs = if (config?.hasKey("intervalMs") == true) {
            config.getInt("intervalMs").toLong()
        } else {
            LocationConfig.DEFAULT_INTERVAL_MS
        }

        val fastestIntervalMs = if (config?.hasKey("fastestIntervalMs") == true) {
            config.getInt("fastestIntervalMs").toLong()
        } else {
            LocationConfig.DEFAULT_FASTEST_INTERVAL_MS
        }

        val minDisplacement = if (config?.hasKey("minDisplacementMeters") == true) {
            config.getDouble("minDisplacementMeters").toFloat()
        } else {
            LocationConfig.DEFAULT_MIN_DISPLACEMENT_METERS
        }

        locationManager.startTracking(
            priority = priority,
            intervalMs = intervalMs,
            fastestIntervalMs = fastestIntervalMs,
            minDisplacementMeters = minDisplacement,
            updateListener = object : LocationManager.LocationUpdateListener {
                override fun onLocationUpdate(result: LocationResult) {
                    eventEmitter.emitLocationUpdate(result)
                }

                override fun onLocationError(error: LocationErrorCode) {
                    eventEmitter.emitLocationError(error)
                }
            },
        )

        eventEmitter.emitTrackingStateChanged(TrackingState.TRACKING)
        promise.resolve(true)
    }

    /**
     * Stops continuous location tracking.
     */
    @ReactMethod
    fun stopTracking(promise: Promise) {
        locationManager.stopTracking()
        eventEmitter.emitTrackingStateChanged(TrackingState.STOPPED)
        promise.resolve(true)
    }

    /**
     * Returns whether tracking is currently active.
     */
    @ReactMethod
    fun isTracking(promise: Promise) {
        promise.resolve(locationManager.isCurrentlyTracking())
    }

    // ─── Foreground Service ────────────────────────────────────────────

    /**
     * Starts the foreground location service for active trip tracking.
     */
    @ReactMethod
    fun startForegroundService(promise: Promise) {
        try {
            LocationService.start(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                LocationErrorCode.SERVICE_FAILURE.code,
                LocationErrorCode.SERVICE_FAILURE.message,
                e,
            )
        }
    }

    /**
     * Stops the foreground location service.
     */
    @ReactMethod
    fun stopForegroundService(promise: Promise) {
        try {
            LocationService.stop(reactApplicationContext)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject(
                LocationErrorCode.SERVICE_FAILURE.code,
                LocationErrorCode.SERVICE_FAILURE.message,
                e,
            )
        }
    }

    /**
     * Returns whether the foreground service is currently running.
     */
    @ReactMethod
    fun isForegroundServiceRunning(promise: Promise) {
        promise.resolve(LocationService.isServiceRunning())
    }

    // ─── Geofencing ────────────────────────────────────────────────────

    /**
     * Adds a geofence with the given parameters.
     *
     * @param params ReadableMap with keys:
     *   - id (string): Unique geofence ID
     *   - latitude (double)
     *   - longitude (double)
     *   - radiusMeters (double): Radius in meters
     */
    @ReactMethod
    fun addGeofence(params: ReadableMap, promise: Promise) {
        val id = params.getString("id") ?: run {
            promise.reject("INVALID_PARAMS", "Geofence 'id' is required")
            return
        }
        val latitude = params.getDouble("latitude")
        val longitude = params.getDouble("longitude")
        val radius = if (params.hasKey("radiusMeters")) {
            params.getDouble("radiusMeters").toFloat()
        } else {
            LocationConfig.DEFAULT_GEOFENCE_RADIUS_METERS
        }

        val request = GeofenceRequest(
            id = id,
            latitude = latitude,
            longitude = longitude,
            radiusMeters = radius,
        )

        val pendingIntent = getGeofencePendingIntent()

        locationManager.addGeofence(
            request = request,
            pendingIntent = pendingIntent,
            onSuccess = { promise.resolve(true) },
            onError = { error -> promise.reject(error.code, error.message) },
        )
    }

    /**
     * Removes a geofence by its ID.
     */
    @ReactMethod
    fun removeGeofence(geofenceId: String, promise: Promise) {
        locationManager.removeGeofence(geofenceId)
        promise.resolve(true)
    }

    // ─── Event Listener Support (required by RN NativeEventEmitter) ───

    @ReactMethod
    fun addListener(eventName: String) {
        eventEmitter.incrementListenerCount()
    }

    @ReactMethod
    fun removeListeners(count: Int) {
        eventEmitter.decrementListenerCount(count)
    }

    // ─── Cleanup ───────────────────────────────────────────────────────

    override fun onCatalystInstanceDestroy() {
        locationManager.destroy()
        super.onCatalystInstanceDestroy()
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    private fun getGeofencePendingIntent(): android.app.PendingIntent {
        val intent = android.content.Intent(
            reactApplicationContext,
            GeofenceBroadcastReceiver::class.java,
        )
        return android.app.PendingIntent.getBroadcast(
            reactApplicationContext,
            0,
            intent,
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_MUTABLE,
        )
    }
}
