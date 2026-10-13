package com.multipleride.driver.location

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Context
import android.location.LocationManager as AndroidLocationManager
import android.os.Build
import android.os.Looper
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.GeofencingClient
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingRequest
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult as GmsLocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

/**
 * Owns all interaction with Android location APIs (FusedLocationProviderClient).
 *
 * This class is independent from React Native. It receives a [Context], obtains
 * the FusedLocationProviderClient, and provides structured callbacks via
 * [LocationUpdateListener] and [GeofenceListener].
 *
 * No UI logic, no RN imports, no backend communication.
 */
class LocationManager(private val context: Context) {

    companion object {
        private const val TAG = "PickUpLocationMgr"
    }

    // ─── Listeners ─────────────────────────────────────────────────────

    interface LocationUpdateListener {
        fun onLocationUpdate(result: LocationResult)
        fun onLocationError(error: LocationErrorCode)
    }

    interface GeofenceListener {
        fun onGeofenceEvent(event: GeofenceEvent)
        fun onGeofenceError(error: LocationErrorCode)
    }

    // ─── State ─────────────────────────────────────────────────────────

    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)

    private val geofencingClient: GeofencingClient =
        LocationServices.getGeofencingClient(context)

    private var locationCallback: LocationCallback? = null
    private var listener: LocationUpdateListener? = null
    private var geofenceListener: GeofenceListener? = null

    @Volatile
    private var isTracking: Boolean = false

    // ─── Provider Availability ─────────────────────────────────────────

    /**
     * Checks if GPS and/or network location providers are enabled on the device.
     */
    fun isLocationProviderEnabled(): Boolean {
        val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as? AndroidLocationManager
            ?: return false
        return locationManager.isProviderEnabled(AndroidLocationManager.GPS_PROVIDER) ||
            locationManager.isProviderEnabled(AndroidLocationManager.NETWORK_PROVIDER)
    }

    // ─── Single Location ───────────────────────────────────────────────

    /**
     * Obtains the current location with a single request.
     * Calls [onResult] on success or [onError] on failure.
     */
    @SuppressLint("MissingPermission")
    fun getCurrentLocation(
        onResult: (LocationResult) -> Unit,
        onError: (LocationErrorCode) -> Unit,
    ) {
        if (!isLocationProviderEnabled()) {
            onError(LocationErrorCode.PROVIDER_DISABLED)
            return
        }

        val cts = com.google.android.gms.tasks.CancellationTokenSource()

        fusedClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token)
            .addOnSuccessListener { location ->
                if (location != null) {
                    onResult(location.toLocationResult())
                } else {
                    onError(LocationErrorCode.LOCATION_UNAVAILABLE)
                }
            }
            .addOnFailureListener { e ->
                Log.w(TAG, "getCurrentLocation failed", e)
                onError(LocationErrorCode.LOCATION_UNAVAILABLE)
            }
    }

    // ─── Continuous Tracking ───────────────────────────────────────────

    /**
     * Starts continuous location updates with the given configuration.
     *
     * @param priority One of [LocationConfig] PRIORITY_* constants.
     * @param intervalMs Desired update interval.
     * @param fastestIntervalMs Fastest (rate-limit) interval.
     * @param minDisplacementMeters Minimum displacement before update.
     * @param updateListener Callback for location updates and errors.
     */
    @SuppressLint("MissingPermission")
    fun startTracking(
        priority: Int = LocationConfig.DEFAULT_INTERVAL_MS.toInt(),
        intervalMs: Long = LocationConfig.DEFAULT_INTERVAL_MS,
        fastestIntervalMs: Long = LocationConfig.DEFAULT_FASTEST_INTERVAL_MS,
        minDisplacementMeters: Float = LocationConfig.DEFAULT_MIN_DISPLACEMENT_METERS,
        updateListener: LocationUpdateListener,
    ) {
        // Prevent duplicate listeners
        stopTracking()

        if (!isLocationProviderEnabled()) {
            updateListener.onLocationError(LocationErrorCode.PROVIDER_DISABLED)
            return
        }

        this.listener = updateListener

        val locationRequest = LocationRequest.Builder(priority, intervalMs)
            .setMinUpdateIntervalMillis(fastestIntervalMs)
            .setMinUpdateDistanceMeters(minDisplacementMeters)
            .build()

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: GmsLocationResult) {
                val location = result.lastLocation ?: return
                listener?.onLocationUpdate(location.toLocationResult())
            }
        }

        fusedClient.requestLocationUpdates(
            locationRequest,
            locationCallback!!,
            Looper.getMainLooper(),
        ).addOnFailureListener { e ->
            Log.w(TAG, "requestLocationUpdates failed", e)
            updateListener.onLocationError(LocationErrorCode.TRACKING_UNAVAILABLE)
        }

        isTracking = true
    }

    /**
     * Stops continuous location updates and cleans up the callback.
     */
    fun stopTracking() {
        locationCallback?.let { cb ->
            fusedClient.removeLocationUpdates(cb)
        }
        locationCallback = null
        listener = null
        isTracking = false
    }

    /**
     * Returns whether continuous tracking is currently active.
     */
    fun isCurrentlyTracking(): Boolean = isTracking

    // ─── Geofencing ────────────────────────────────────────────────────

    /**
     * Registers a geofence with the given [request].
     *
     * @param request The geofence parameters.
     * @param pendingIntent PendingIntent that will be fired on geofence transitions.
     * @param onSuccess Called when the geofence is registered.
     * @param onError Called on failure.
     */
    @SuppressLint("MissingPermission")
    fun addGeofence(
        request: com.multipleride.driver.location.GeofenceRequest,
        pendingIntent: PendingIntent,
        onSuccess: () -> Unit,
        onError: (LocationErrorCode) -> Unit,
    ) {
        val transitionTypes = request.transitionTypes.fold(0) { acc, t ->
            acc or when (t) {
                GeofenceTransition.ENTER -> Geofence.GEOFENCE_TRANSITION_ENTER
                GeofenceTransition.EXIT -> Geofence.GEOFENCE_TRANSITION_EXIT
                GeofenceTransition.DWELL -> Geofence.GEOFENCE_TRANSITION_DWELL
            }
        }

        val geofence = Geofence.Builder()
            .setRequestId(request.id)
            .setCircularRegion(request.latitude, request.longitude, request.radiusMeters)
            .setExpirationDuration(
                if (request.expirationMs == com.multipleride.driver.location.GeofenceRequest.NO_EXPIRATION) {
                    Geofence.NEVER_EXPIRE
                } else {
                    request.expirationMs
                }
            )
            .setTransitionTypes(transitionTypes)
            .apply {
                if (request.loiteringDelayMs > 0) {
                    setLoiteringDelay(request.loiteringDelayMs)
                }
            }
            .build()

        val geofencingRequest = GeofencingRequest.Builder()
            .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
            .addGeofence(geofence)
            .build()

        geofencingClient.addGeofences(geofencingRequest, pendingIntent)
            .addOnSuccessListener { onSuccess() }
            .addOnFailureListener { e ->
                Log.w(TAG, "addGeofence failed for ${request.id}", e)
                onError(LocationErrorCode.GEOFENCE_FAILURE)
            }
    }

    /**
     * Removes a geofence by its ID.
     */
    fun removeGeofence(geofenceId: String) {
        geofencingClient.removeGeofences(listOf(geofenceId))
            .addOnFailureListener { e ->
                Log.w(TAG, "removeGeofence failed for $geofenceId", e)
            }
    }

    /**
     * Removes all registered geofences using the given PendingIntent.
     */
    fun removeAllGeofences(pendingIntent: PendingIntent) {
        geofencingClient.removeGeofences(pendingIntent)
            .addOnFailureListener { e ->
                Log.w(TAG, "removeAllGeofences failed", e)
            }
    }

    /**
     * Sets the geofence listener for handling transition events.
     */
    fun setGeofenceListener(listener: GeofenceListener?) {
        this.geofenceListener = listener
    }

    /**
     * Called by [GeofenceBroadcastReceiver] to dispatch geofence events.
     */
    fun dispatchGeofenceEvent(event: GeofenceEvent) {
        geofenceListener?.onGeofenceEvent(event)
    }

    /**
     * Called by [GeofenceBroadcastReceiver] to dispatch geofence errors.
     */
    fun dispatchGeofenceError(error: LocationErrorCode) {
        geofenceListener?.onGeofenceError(error)
    }

    // ─── Cleanup ───────────────────────────────────────────────────────

    /**
     * Full cleanup: stops tracking, removes listeners.
     * Call on activity/service destruction.
     */
    fun destroy() {
        stopTracking()
        geofenceListener = null
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    /**
     * Converts an Android [android.location.Location] to our [LocationResult] model.
     */
    private fun android.location.Location.toLocationResult(): LocationResult {
        return LocationResult(
            latitude = latitude,
            longitude = longitude,
            accuracy = accuracy,
            altitude = altitude,
            speed = speed,
            bearing = bearing,
            timestamp = time,
            provider = provider ?: "unknown",
        )
    }
}
