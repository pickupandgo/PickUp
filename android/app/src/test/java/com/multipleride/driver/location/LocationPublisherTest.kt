package com.multipleride.driver.location

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicLong
import java.util.Collections

class LocationPublisherTest {
    private val time = 1800000000000L
    private fun fix(timestamp: Long = time) = LocationResult(26.2, 73.1, 5f, 0.0, 0f, 0f, timestamp, "gps")
    private fun await(latch: CountDownLatch) = assertTrue("Publisher did not finish", latch.await(5, TimeUnit.SECONDS))

    @Test fun serializesRequestsAndCoalescesPendingFixes() {
        val started = CountDownLatch(1); val release = CountDownLatch(1); val done = CountDownLatch(2)
        val requests = Collections.synchronizedList(mutableListOf<String>())
        val active = AtomicInteger(); val maximum = AtomicInteger()
        val publisher = LocationPublisher(base = "https://engine.test", identity = { "driver-a" },
            tokenProvider = { "synthetic-token" }, now = { time }, send = { url, _, body ->
                assertEquals("https://engine.test/drivers/driver-a/location", url)
                maximum.set(maxOf(maximum.get(), active.incrementAndGet()))
                requests.add(body)
                if (requests.size == 1) { started.countDown(); await(release) }
                active.decrementAndGet(); done.countDown(); 200
            }, onFailure = { _, _ -> fail("Unexpected publisher failure") })
        try {
            publisher.offer(fix(time - 3)); await(started)
            publisher.offer(fix(time - 3)) // duplicate while first request is in flight
            publisher.offer(fix(time - 2)); publisher.offer(fix(time - 1))
            release.countDown(); await(done)
            assertEquals(1, maximum.get()); assertEquals(2, requests.size)
            assertTrue(requests[1].contains("\"capturedAt\":${time - 1}"))
        } finally { release.countDown(); publisher.close() }
    }

    @Test fun retriesTransientFailureWithoutPersistingAQueue() {
        val calls = AtomicInteger(); val done = CountDownLatch(1)
        val publisher = LocationPublisher(base = "https://engine.test", identity = { "driver-a" },
            tokenProvider = { "synthetic-token" }, now = { time }, send = { _, _, _ ->
                if (calls.incrementAndGet() == 1) 503 else { done.countDown(); 200 }
            }, onFailure = { _, _ -> fail("Unexpected authorization error") })
        try { publisher.offer(fix()); await(done); assertEquals(2, calls.get()) }
        finally { publisher.close() }
    }

    @Test fun refreshesOnceThenStopsOnAuthorizationFailure() {
        val refreshed = Collections.synchronizedList(mutableListOf<Boolean>())
        val denied = CountDownLatch(1); val calls = AtomicInteger()
        val publisher = LocationPublisher(base = "https://engine.test", identity = { "driver-a" },
            tokenProvider = { refreshed.add(it); "synthetic-token" }, now = { time },
            send = { _, _, _ -> if (calls.incrementAndGet() == 1) 401 else 403 },
            onFailure = { _, terminal -> if (terminal) denied.countDown() })
        try {
            publisher.offer(fix()); await(denied)
            assertEquals(listOf(false, true), refreshed)
        } finally { publisher.close() }
    }

    @Test fun dropsExpiredFixAfterTokenRefreshAndRejectsMalformedGps() {
        val clock = AtomicLong(time); val called = AtomicInteger(); val tokenRequested = CountDownLatch(1)
        val publisher = LocationPublisher(base = "https://engine.test", identity = { "driver-a" },
            tokenProvider = { clock.set(time + 31000); tokenRequested.countDown(); "synthetic-token" },
            now = { clock.get() }, send = { _, _, _ -> called.incrementAndGet(); 200 }, onFailure = { _, _ -> })
        try {
            publisher.offer(fix().copy(latitude = Double.NaN))
            publisher.offer(fix(time - 31000))
            publisher.offer(fix()); await(tokenRequested)
            assertEquals(0, called.get())
        } finally { publisher.close() }
    }

    @Test fun requiresHttpsAndValidTripReferences() {
        assertThrows(IllegalArgumentException::class.java) {
            LocationPublisher(base = "http://engine.test", identity = { "driver-a" }, onFailure = { _, _ -> })
        }
        val publisher = LocationPublisher(base = "https://engine.test", identity = { "driver-a" }, onFailure = { _, _ -> })
        try { assertThrows(IllegalArgumentException::class.java) { publisher.configure("not-a-trip") } }
        finally { publisher.close() }
    }
}
