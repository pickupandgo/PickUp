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
 * No direct backend communication. No UI logic.
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
        fun start(context: Context) {
            val intent = Intent(context, LocationService::class.java).apply {
                action = ACTION_START
            }
            context.startForegroundService(intent)
        }

        /**
         * Convenience: stop the foreground location service.
         */
        fun stop(context: Context) {
            val intent = Intent(context, LocationService::class.java).apply {
                action = ACTION_STOP
            }
            context.startService(intent)
        }
    }

    private var locationManager: LocationManager? = null
    private var eventEmitter: LocationEventEmitter? = null

    // ─── Service Lifecycle ─────────────────────────────────────────────

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
        locationManager = LocationManager(applicationContext)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_START -> startForegroundTracking()
            ACTION_STOP -> stopForegroundTracking()
            else -> Log.w(TAG, "Unknown action: ${intent?.action}")
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        stopForegroundTracking()
        locationManager?.destroy()
        locationManager = null
        isRunning = false
        super.onDestroy()
    }

    // ─── Foreground Tracking ───────────────────────────────────────────

    private fun startForegroundTracking() {
        if (isRunning) {
            Log.d(TAG, "Service already running, ignoring duplicate start")
            return
        }

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

        locationManager?.startTracking(
            priority = LocationConfig.PRIORITY_HIGH_ACCURACY,
            intervalMs = LocationConfig.ACTIVE_TRIP_INTERVAL_MS,
            fastestIntervalMs = LocationConfig.ACTIVE_TRIP_FASTEST_INTERVAL_MS,
            minDisplacementMeters = LocationConfig.ACTIVE_TRIP_MIN_DISPLACEMENT_METERS,
            updateListener = object : LocationManager.LocationUpdateListener {
                override fun onLocationUpdate(result: LocationResult) {
                    eventEmitter?.emitLocationUpdate(result)
                }

                override fun onLocationError(error: LocationErrorCode) {
                    eventEmitter?.emitLocationError(error)
                }
            },
        )

        isRunning = true
        Log.d(TAG, "Foreground tracking started")
    }

    private fun stopForegroundTracking() {
        locationManager?.stopTracking()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
        isRunning = false
        Log.d(TAG, "Foreground tracking stopped")
    }

    // ─── Notification ──────────────────────────────────────────────────

    private fun createNotificationChannel() {
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
            .setContentText(LocationConfig.NOTIFICATION_TEXT)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    // ─── Event Emitter Injection ───────────────────────────────────────

    /**
     * Called by [LocationModule] to inject the event emitter so the service
     * can push location updates to the RN layer.
     */
    fun setEventEmitter(emitter: LocationEventEmitter) {
        this.eventEmitter = emitter
    }
}
