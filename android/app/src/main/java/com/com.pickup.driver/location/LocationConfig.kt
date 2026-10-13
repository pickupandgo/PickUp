package com.multipleride.driver.location

/**
 * Centralized configuration for the location subsystem.
 *
 * All tunable constants in one place for battery/performance optimization.
 * The TypeScript/business layer can request different profiles via the RN bridge;
 * each profile maps to a set of values here.
 */
object LocationConfig {

    // ─── Accuracy Profiles ─────────────────────────────────────────────
    // These correspond to com.google.android.gms.location.Priority values.
    // We use integer constants to avoid coupling this config to the GMS import.

    /** High accuracy (GPS + WiFi + Cell). Use during active navigation. */
    const val PRIORITY_HIGH_ACCURACY: Int = 100

    /** Balanced (WiFi + Cell, ~100m). Use when driver is online/available. */
    const val PRIORITY_BALANCED: Int = 102

    /** Low power (~10km city block). Use for coarse presence. */
    const val PRIORITY_LOW_POWER: Int = 104

    /** Passive (piggyback on other apps' requests). Use when idle. */
    const val PRIORITY_PASSIVE: Int = 105

    // ─── Update Intervals ──────────────────────────────────────────────

    /** Default desired update interval in milliseconds. */
    const val DEFAULT_INTERVAL_MS: Long = 10_000L

    /** Fastest interval (rate-limit). Will not receive updates faster than this. */
    const val DEFAULT_FASTEST_INTERVAL_MS: Long = 5_000L

    /** Active trip interval — higher frequency for navigation. */
    const val ACTIVE_TRIP_INTERVAL_MS: Long = 5_000L

    /** Active trip fastest interval. */
    const val ACTIVE_TRIP_FASTEST_INTERVAL_MS: Long = 2_000L

    /** Online/available interval — moderate frequency. */
    const val ONLINE_INTERVAL_MS: Long = 15_000L

    /** Online/available fastest interval. */
    const val ONLINE_FASTEST_INTERVAL_MS: Long = 8_000L

    // ─── Distance Filtering ────────────────────────────────────────────

    /** Minimum displacement in meters before an update is delivered. */
    const val DEFAULT_MIN_DISPLACEMENT_METERS: Float = 10f

    /** Active trip displacement — more granular. */
    const val ACTIVE_TRIP_MIN_DISPLACEMENT_METERS: Float = 5f

    /** Online/available displacement — less granular. */
    const val ONLINE_MIN_DISPLACEMENT_METERS: Float = 50f

    // ─── Geofence ──────────────────────────────────────────────────────

    /** Default geofence radius in meters (e.g., "arrived at pickup" detection). */
    const val DEFAULT_GEOFENCE_RADIUS_METERS: Float = 100f

    /** Maximum number of concurrent geofences. Android limit is 100. */
    const val MAX_GEOFENCES: Int = 20

    /** Loitering delay in milliseconds for DWELL transition. */
    const val DEFAULT_LOITERING_DELAY_MS: Int = 30_000

    // ─── Timeout ───────────────────────────────────────────────────────

    /** Timeout for single location request in milliseconds. */
    const val SINGLE_LOCATION_TIMEOUT_MS: Long = 15_000L

    // ─── Foreground Service ────────────────────────────────────────────

    /** Notification channel ID for the foreground service. */
    const val NOTIFICATION_CHANNEL_ID: String = "pickup_location_channel"

    /** Notification channel name (user-visible). */
    const val NOTIFICATION_CHANNEL_NAME: String = "Location Tracking"

    /** Foreground service notification ID. */
    const val FOREGROUND_NOTIFICATION_ID: Int = 9001

    /** Foreground service notification title. */
    const val NOTIFICATION_TITLE: String = "Pick Up Driver"

    /** Foreground service notification text. */
    const val NOTIFICATION_TEXT: String = "Tracking your location for active trip"
}
