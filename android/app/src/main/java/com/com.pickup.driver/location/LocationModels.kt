package com.multipleride.driver.location

/**
 * Strongly-typed Kotlin models for the native location subsystem.
 *
 * These models are independent of React Native and Android SDK implementation details.
 * They represent the contract between the Kotlin location layer and the RN bridge.
 */

/**
 * Represents a single device location fix.
 */
data class LocationResult(
    val latitude: Double,
    val longitude: Double,
    val accuracy: Float,
    val altitude: Double,
    val speed: Float,
    val bearing: Float,
    val timestamp: Long,
    val provider: String,
)

/**
 * Structured error types for the location subsystem.
 * Each variant maps to a specific failure mode exposed to the RN layer.
 */
enum class LocationErrorCode(val code: String, val message: String) {
    PERMISSION_DENIED("PERMISSION_DENIED", "Location permission was denied by the user"),
    PERMISSION_PERMANENTLY_DENIED("PERMISSION_PERMANENTLY_DENIED", "Location permission is permanently denied. Enable in Settings."),
    PROVIDER_DISABLED("PROVIDER_DISABLED", "Location services (GPS/network) are disabled on this device"),
    LOCATION_UNAVAILABLE("LOCATION_UNAVAILABLE", "Unable to determine device location"),
    TIMEOUT("TIMEOUT", "Location request timed out"),
    TRACKING_UNAVAILABLE("TRACKING_UNAVAILABLE", "Continuous tracking is not available"),
    SERVICE_FAILURE("SERVICE_FAILURE", "Location foreground service encountered a failure"),
    GEOFENCE_FAILURE("GEOFENCE_FAILURE", "Geofence registration or monitoring failed"),
    UNKNOWN("UNKNOWN", "An unexpected location error occurred"),
}

/**
 * Represents the current permission state for location access.
 */
enum class PermissionState(val value: String) {
    GRANTED("granted"),
    DENIED("denied"),
    PERMANENTLY_DENIED("permanently_denied"),
    NOT_DETERMINED("not_determined"),
}

/**
 * Represents the current tracking state of the location subsystem.
 */
enum class TrackingState(val value: String) {
    IDLE("idle"),
    TRACKING("tracking"),
    BACKGROUND_TRACKING("background_tracking"),
    STOPPED("stopped"),
}

/**
 * Represents the result of a geofence transition event.
 */
data class GeofenceEvent(
    val geofenceId: String,
    val transitionType: GeofenceTransition,
    val latitude: Double,
    val longitude: Double,
    val timestamp: Long,
)

/**
 * Geofence transition types.
 */
enum class GeofenceTransition(val value: String) {
    ENTER("enter"),
    EXIT("exit"),
    DWELL("dwell"),
}

/**
 * Request to register a geofence.
 */
data class GeofenceRequest(
    val id: String,
    val latitude: Double,
    val longitude: Double,
    val radiusMeters: Float,
    val expirationMs: Long = GeofenceRequest.NO_EXPIRATION,
    val transitionTypes: Set<GeofenceTransition> = setOf(GeofenceTransition.ENTER),
    val loiteringDelayMs: Int = 0,
) {
    companion object {
        const val NO_EXPIRATION: Long = -1L
    }
}
