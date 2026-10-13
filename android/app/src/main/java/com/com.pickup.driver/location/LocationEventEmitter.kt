package com.multipleride.driver.location

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Clean event mechanism for pushing native location updates to React Native.
 *
 * Wraps RN's [DeviceEventManagerModule.RCTDeviceEventEmitter] with:
 * - Structured location payloads
 * - Safe event delivery (no crash if no JS listener)
 * - Listener count tracking to avoid emitting when nobody is listening
 * - Defined event names as constants
 *
 * No business logic. No duplicate listener issues — RN JS side manages
 * subscription/unsubscription; this class only emits.
 */
class LocationEventEmitter(private val reactContext: ReactApplicationContext) {

    companion object {
        /** Event names — must match the JS side constants. */
        const val EVENT_LOCATION_UPDATE = "onLocationUpdate"
        const val EVENT_LOCATION_ERROR = "onLocationError"
        const val EVENT_TRACKING_STATE_CHANGED = "onTrackingStateChanged"
        const val EVENT_GEOFENCE_EVENT = "onGeofenceEvent"
        const val EVENT_GEOFENCE_ERROR = "onGeofenceError"

        /** All supported event names for registration. */
        val SUPPORTED_EVENTS: List<String> = listOf(
            EVENT_LOCATION_UPDATE,
            EVENT_LOCATION_ERROR,
            EVENT_TRACKING_STATE_CHANGED,
            EVENT_GEOFENCE_EVENT,
            EVENT_GEOFENCE_ERROR,
        )
    }

    @Volatile
    private var listenerCount: Int = 0

    // ─── Listener Count Management ─────────────────────────────────────

    /**
     * Called by [LocationModule.addListener] to track active JS listeners.
     */
    fun incrementListenerCount() {
        listenerCount++
    }

    /**
     * Called by [LocationModule.removeListeners] to track active JS listeners.
     */
    fun decrementListenerCount(count: Int) {
        listenerCount = (listenerCount - count).coerceAtLeast(0)
    }

    private fun hasListeners(): Boolean = listenerCount > 0

    // ─── Emit Methods ──────────────────────────────────────────────────

    /**
     * Emits a location update event to JavaScript.
     */
    fun emitLocationUpdate(result: LocationResult) {
        if (!hasListeners()) return
        emit(EVENT_LOCATION_UPDATE, result.toWritableMap())
    }

    /**
     * Emits a location error event to JavaScript.
     */
    fun emitLocationError(error: LocationErrorCode) {
        if (!hasListeners()) return
        val map = Arguments.createMap().apply {
            putString("code", error.code)
            putString("message", error.message)
        }
        emit(EVENT_LOCATION_ERROR, map)
    }

    /**
     * Emits a tracking state change event to JavaScript.
     */
    fun emitTrackingStateChanged(state: TrackingState) {
        if (!hasListeners()) return
        val map = Arguments.createMap().apply {
            putString("state", state.value)
        }
        emit(EVENT_TRACKING_STATE_CHANGED, map)
    }

    /**
     * Emits a geofence event to JavaScript.
     */
    fun emitGeofenceEvent(event: GeofenceEvent) {
        if (!hasListeners()) return
        val map = Arguments.createMap().apply {
            putString("geofenceId", event.geofenceId)
            putString("transitionType", event.transitionType.value)
            putDouble("latitude", event.latitude)
            putDouble("longitude", event.longitude)
            putDouble("timestamp", event.timestamp.toDouble())
        }
        emit(EVENT_GEOFENCE_EVENT, map)
    }

    /**
     * Emits a geofence error event to JavaScript.
     */
    fun emitGeofenceError(error: LocationErrorCode) {
        if (!hasListeners()) return
        val map = Arguments.createMap().apply {
            putString("code", error.code)
            putString("message", error.message)
        }
        emit(EVENT_GEOFENCE_ERROR, map)
    }

    // ─── Internal ──────────────────────────────────────────────────────

    private fun emit(eventName: String, params: WritableMap) {
        if (!reactContext.hasActiveReactInstance()) return
        reactContext
            .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit(eventName, params)
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    private fun LocationResult.toWritableMap(): WritableMap {
        return Arguments.createMap().apply {
            putDouble("latitude", latitude)
            putDouble("longitude", longitude)
            putDouble("accuracy", accuracy.toDouble())
            putDouble("altitude", altitude)
            putDouble("speed", speed.toDouble())
            putDouble("bearing", bearing.toDouble())
            putDouble("timestamp", timestamp.toDouble())
            putString("provider", provider)
        }
    }
}
