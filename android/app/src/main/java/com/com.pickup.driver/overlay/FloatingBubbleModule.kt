package com.multipleride.driver.overlay

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule

@ReactModule(name = FloatingBubbleModule.NAME)
class FloatingBubbleModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val NAME = "FloatingBubbleModule"
    }

    private val bubbleManager = FloatingBubbleManager.getInstance(reactContext)

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = NAME

    override fun onHostResume() {
        bubbleManager.onAppResumed()
    }

    override fun onHostPause() {
        bubbleManager.onAppMinimized()
    }

    override fun onHostDestroy() {
        bubbleManager.cleanup()
    }

    @ReactMethod
    fun canDrawOverlays(promise: Promise) {
        try {
            promise.resolve(bubbleManager.canDrawOverlays())
        } catch (e: Exception) {
            promise.reject("OVERLAY_CHECK_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun requestOverlayPermission(promise: Promise) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                val intent = Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:${reactContext.packageName}")
                ).apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                reactContext.startActivity(intent)
                promise.resolve(true)
            } else {
                promise.resolve(true)
            }
        } catch (e: Exception) {
            promise.reject("PERMISSION_REQUEST_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun setFeatureEnabled(enabled: Boolean, promise: Promise) {
        try {
            bubbleManager.setFeatureEnabled(enabled)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_FEATURE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun setDriverEligible(eligible: Boolean, promise: Promise) {
        try {
            bubbleManager.setDriverEligible(eligible)
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("SET_ELIGIBLE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun showBubble(promise: Promise) {
        try {
            val shown = bubbleManager.showBubble()
            promise.resolve(shown)
        } catch (e: Exception) {
            promise.reject("SHOW_BUBBLE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun hideBubble(promise: Promise) {
        try {
            val hidden = bubbleManager.hideBubble()
            promise.resolve(hidden)
        } catch (e: Exception) {
            promise.reject("HIDE_BUBBLE_FAILED", e.message, e)
        }
    }

    @ReactMethod
    fun isBubbleShowing(promise: Promise) {
        try {
            promise.resolve(bubbleManager.isShowing())
        } catch (e: Exception) {
            promise.reject("IS_SHOWING_FAILED", e.message, e)
        }
    }
}
