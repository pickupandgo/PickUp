package com.multipleride.driver.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import android.Manifest
import android.content.pm.PackageManager
import com.google.firebase.auth.FirebaseAuth

/**
 * Android foreground service for persistent location tracking during active trips.
 *
 * This service keeps the app alive while the driver is performing a delivery,
 * showing a persistent notification as required by Android foreground service policy.
 *
 * Start/stop is controlled by the RN bridge (LocationModule) based on driver/trip state.
 * The service does NOT make business-logic decisions — it only provides the
 * Android lifecycle necessary for continuous GPS in foreground/background.
 *
 * A single LocationPublisher sends authenticated fixes while JS is suspended.
 */
class LocationService : Service() {

    companion object {
        private const val TAG = "PickUpLocationSvc"

        private const val ACTION_START = "com.multipleride.driver.location.ACTION_START"
        private const val ACTION_STOP = "com.multipleride.driver.location.ACTION_STOP"

        @Volatile
        private var isRunning: Boolean = false

        fun isServiceRunning(): Boolean = isRunning

        /**
         * Convenience: start the foreground location service.
         */
        fun start(context: Context, tripId: String? = null) {
            val intent = Intent(context, LocationService::class.java).apply {
                action = ACTION_START
                putExtra("tripId", tripId)
            }
            ContextCompat.startForegroundService(context, intent)
        }

        /**
         * Convenience: stop the foreground location service.
         */
        fun stop(context: Context) {
            context.stopService(Intent(context, LocationService::class.java))
        }
    }

    private var locationManager: LocationManager? = null
    private var publisher: LocationPublisher? = null
    private var owner: String? = null
    private var activeTrip = false
    private val authListener = FirebaseAuth.AuthStateListener { auth ->
        if (owner != null && auth.currentUser?.uid != owner) stopSelf()
    }

    // ─── Service Lifecycle ─────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        locationManager = LocationManager(applicationContext)
        FirebaseAuth.getInstance().addAuthStateListener(authListener)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> {
                try {
                    publisher?.configure(intent.getStringExtra("tripId"))
                    startForegroundTracking(intent.getStringExtra("tripId"))
                } catch (_: Exception) { stopSelf() }
            }
            ACTION_STOP -> stopForegroundTracking()
            else -> stopSelf() // No silent resurrection of location sharing after process death.
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        FirebaseAuth.getInstance().removeAuthStateListener(authListener)
        publisher?.close(); publisher = null
        stopForegroundTracking()
        locationManager?.destroy()
        locationManager = null
        isRunning = false
        super.onDestroy()
    }

    // ─── Foreground Tracking ───────────────────────────────────────────

    private fun startForegroundTracking(tripId: String?) {
        if (isRunning) {
            if (activeTrip != (tripId != null) || locationManager?.isCurrentlyTracking() != true) {
                locationManager?.stopTracking()
                startLocationUpdates(tripId != null)
            }
            return
        }

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            throw SecurityException("Precise location permission required")
        }
        owner = FirebaseAuth.getInstance().currentUser?.uid ?: throw SecurityException("Sign-in required")

        val notification = buildNotification()

        // Android 14+ (API 34+) requires foreground service type
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(
                LocationConfig.FOREGROUND_NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(LocationConfig.FOREGROUND_NOTIFICATION_ID, notification)
        }

        publisher = LocationPublisher { message, terminal ->
            LocationModule.foregroundEmitter?.emitLocationError(LocationErrorCode.TRACKING_UNAVAILABLE)
            // No upstream payload, token, coordinates or history in logs/notifications.
            val manager = getSystemService(NotificationManager::class.java)
            manager.notify(LocationConfig.FOREGROUND_NOTIFICATION_ID,
                NotificationCompat.Builder(this, LocationConfig.NOTIFICATION_CHANNEL_ID)
                    .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                    .setContentTitle("Driver location sharing").setContentText(message).setOngoing(true).build())
            if (terminal) stopSelf()
        }.also { it.configure(tripId) }
        startLocationUpdates(tripId != null)
        isRunning = true
        LocationModule.foregroundEmitter?.emitTrackingStateChanged(TrackingState.TRACKING)
        Log.d(TAG, "Foreground tracking started")
    }

    private fun startLocationUpdates(inTrip: Boolean) {
        activeTrip = inTrip
        locationManager?.startTracking(
            priority = LocationConfig.PRIORITY_HIGH_ACCURACY,
            intervalMs = if (inTrip) LocationConfig.ACTIVE_TRIP_INTERVAL_MS else LocationConfig.ONLINE_INTERVAL_MS,
            fastestIntervalMs = if (inTrip) LocationConfig.ACTIVE_TRIP_FASTEST_INTERVAL_MS else LocationConfig.ONLINE_FASTEST_INTERVAL_MS,
            minDisplacementMeters = 0f, // Stationary drivers still need fresh fixes, not replayed timestamps.
            updateListener = object : LocationManager.LocationUpdateListener {
                override fun onLocationUpdate(result: LocationResult) {
                    publisher?.offer(result)
                    LocationModule.foregroundEmitter?.emitLocationUpdate(result)
                }

                override fun onLocationError(error: LocationErrorCode) {
                    LocationModule.foregroundEmitter?.emitLocationError(error)
                }
            },
        )

    }

    private fun stopForegroundTracking() {
        locationManager?.stopTracking()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        isRunning = false
        LocationModule.foregroundEmitter?.emitTrackingStateChanged(TrackingState.STOPPED)
        Log.d(TAG, "Foreground tracking stopped")
    }

    // ─── Notification ──────────────────────────────────────────────────

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            LocationConfig.NOTIFICATION_CHANNEL_ID,
            LocationConfig.NOTIFICATION_CHANNEL_NAME,
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Used while tracking driver location during active trips"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            packageManager.getLaunchIntentForPackage(packageName),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        return NotificationCompat.Builder(this, LocationConfig.NOTIFICATION_CHANNEL_ID)
            .setContentTitle(LocationConfig.NOTIFICATION_TITLE)
            .setContentText("Sharing location while online or on an active trip")
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    // ─── Event Emitter Injection ───────────────────────────────────────

}
