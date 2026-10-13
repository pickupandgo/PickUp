package com.multipleride.driver.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofenceStatusCodes
import com.google.android.gms.location.GeofencingEvent

/**
 * BroadcastReceiver for geofence transition events.
 *
 * Registered in AndroidManifest.xml. When a geofence transition occurs,
 * Android delivers the event here. This receiver extracts the structured
 * data and delegates to [LocationManager.dispatchGeofenceEvent].
 *
 * No business logic. No direct RN interaction.
 */
class GeofenceBroadcastReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "PickUpGeofenceRx"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent)

        if (geofencingEvent == null) {
            Log.w(TAG, "Received null GeofencingEvent")
            return
        }

        if (geofencingEvent.hasError()) {
            val errorMessage = GeofenceStatusCodes.getStatusCodeString(geofencingEvent.errorCode)
            Log.e(TAG, "Geofence error: $errorMessage")
            // Cannot dispatch to LocationManager here without a reference;
            // the LocationModule/Service will handle error propagation.
            return
        }

        val transition = when (geofencingEvent.geofenceTransition) {
            Geofence.GEOFENCE_TRANSITION_ENTER -> GeofenceTransition.ENTER
            Geofence.GEOFENCE_TRANSITION_EXIT -> GeofenceTransition.EXIT
            Geofence.GEOFENCE_TRANSITION_DWELL -> GeofenceTransition.DWELL
            else -> {
                Log.w(TAG, "Unknown geofence transition: ${geofencingEvent.geofenceTransition}")
                return
            }
        }

        val triggeringLocation = geofencingEvent.triggeringLocation
        val timestamp = triggeringLocation?.time ?: System.currentTimeMillis()
        val lat = triggeringLocation?.latitude ?: 0.0
        val lng = triggeringLocation?.longitude ?: 0.0

        geofencingEvent.triggeringGeofences?.forEach { geofence ->
            val event = GeofenceEvent(
                geofenceId = geofence.requestId,
                transitionType = transition,
                latitude = lat,
                longitude = lng,
                timestamp = timestamp,
            )
            Log.d(TAG, "Geofence transition: ${event.geofenceId} -> ${event.transitionType.value}")
            // Events will be dispatched via LocationModule in Phase 12
        }
    }
}
