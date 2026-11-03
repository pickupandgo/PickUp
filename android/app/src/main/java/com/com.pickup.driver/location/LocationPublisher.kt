package com.multipleride.driver.location

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.multipleride.driver.BuildConfig
import okhttp3.Call
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Latest fix only. One HTTP request, bounded retry, no persisted credentials/location history. */
internal class LocationPublisher(
    private val base: String = BuildConfig.API_BASE_URL.trimEnd('/'),
    private val identity: () -> String? = { FirebaseAuth.getInstance().currentUser?.uid },
    private val tokenProvider: (Boolean) -> String = { refresh ->
        val user = FirebaseAuth.getInstance().currentUser ?: throw IllegalStateException("Sign-in required")
        Tasks.await(user.getIdToken(refresh), 10, TimeUnit.SECONDS).token
            ?: throw IllegalStateException("Authentication unavailable")
    },
    private val send: ((String, String, String) -> Int)? = null,
    private val now: () -> Long = { System.currentTimeMillis() },
    private val onSuccess: (Long) -> Unit = {},
    private val onFailure: (String, Boolean) -> Unit,
) {
    private val worker = Executors.newSingleThreadScheduledExecutor()
    private val client by lazy { OkHttpClient.Builder().connectTimeout(5, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
        .followRedirects(false).followSslRedirects(false).build() }
    private val lock = Any()
    private var closed = false
    private var generation = 0
    private var tripId: String? = null
    private var pending: LocationResult? = null
    private var scheduled = false
    private var lastCaptured = 0L
    private var inFlightCaptured = 0L
    private var backoff = 2L
    private var call: Call? = null
    private val uid = identity()

    init {
        require(base.matches(Regex("https://[A-Za-z0-9.-]+(?::[0-9]+)?"))) { "HTTPS Engine configuration required" }
        require(uid != null && uid.matches(Regex("[A-Za-z0-9_-]{1,128}"))) { "Driver sign-in required" }
    }

    fun configure(value: String?) = synchronized(lock) {
        require(value == null || value.matches(Regex("[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}"))) { "Invalid trip reference" }
        if (tripId != value) { tripId = value; generation++; pending = null; call?.cancel() }
    }

    fun offer(fix: LocationResult) = synchronized(lock) {
        val age = now() - fix.timestamp
        if (closed || !fix.latitude.isFinite() || kotlin.math.abs(fix.latitude) > 90 ||
            !fix.longitude.isFinite() || kotlin.math.abs(fix.longitude) > 180 ||
            !fix.accuracy.isFinite() || fix.accuracy !in 0f..100f || age !in -5000L..30000L ||
            fix.timestamp <= lastCaptured || fix.timestamp <= inFlightCaptured || fix.timestamp <= (pending?.timestamp ?: 0L)) return@synchronized
        pending = fix
        schedule(0)
    }

    private fun schedule(delay: Long) {
        if (scheduled || closed) return
        scheduled = true
        worker.schedule({ publish() }, delay, TimeUnit.SECONDS)
    }

    private fun publish() {
        val snapshot = synchronized(lock) {
            if (closed) return
            val fix = pending ?: run { scheduled = false; return }
            pending = null
            inFlightCaptured = fix.timestamp
            Triple(fix, tripId, generation)
        }
        val (fix, trip, version) = snapshot
        var retry = false
        try {
            if (identity() != uid) { close(); return }
            if (now() - fix.timestamp > 30000) return
            // All values were bounded above; trip references are UUIDs, never arbitrary strings.
            val tripField = if (trip == null) "" else ",\"tripId\":\"$trip\""
            val payload = "{\"latitude\":${fix.latitude},\"longitude\":${fix.longitude},\"capturedAt\":${fix.timestamp},\"accuracy\":${fix.accuracy}$tripField}"
            for (attempt in 0..1) {
                val token = tokenProvider(attempt == 1)
                synchronized(lock) { if (closed || generation != version || identity() != uid || now() - fix.timestamp > 30000) return }
                val url = "$base/drivers/$uid/location"
                val code = if (send != null) send.invoke(url, token, payload) else {
                    val request = Request.Builder().url(url).header("Authorization", "Bearer $token")
                        .patch(payload.toRequestBody("application/json".toMediaType())).build()
                    val current = client.newCall(request)
                    synchronized(lock) { if (closed || generation != version) return; call = current }
                    current.execute().use { it.code }
                }
                if (code == 401 && attempt == 0) continue
                if (code in 200..299) {
                    synchronized(lock) { lastCaptured = maxOf(lastCaptured, fix.timestamp); backoff = 2 }
                    onSuccess(fix.timestamp)
                } else if (code == 401 || code == 403) {
                    onFailure("Location sharing authorization failed. Reopen the app to recover.", true)
                    close()
                } else if (code == 429 || code >= 500) retry = true
                else onFailure("Location update was rejected. A fresh GPS fix is required.", false)
                break
            }
        } catch (_: Exception) { retry = true }
        finally {
            synchronized(lock) {
                call = null; scheduled = false; inFlightCaptured = 0L
                if (!closed && generation == version) {
                    if (retry && pending == null && now() - fix.timestamp <= 30000) pending = fix
                    if (pending != null) {
                        schedule(if (retry) backoff else 0)
                        if (retry) backoff = minOf(15L, backoff * 2)
                    }
                } else if (!closed && pending != null) schedule(0)
            }
        }
    }

    fun close() = synchronized(lock) {
        closed = true; generation++; pending = null; call?.cancel(); worker.shutdownNow()
    }
}
