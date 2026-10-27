package com.multipleride.driver.overlay

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import com.multipleride.driver.R

/**
 * Native Android Floating Circular Overlay Bubble Manager.
 *
 * Requirements:
 * - Small circular bubble using existing MultipleRide Driver App logo/icon.
 * - Draggable around the screen, stays within usable screen bounds.
 * - Snaps to the nearest screen edge smoothly on release.
 * - Single tap brings existing Driver App to foreground (reopens existing activity).
 * - No separate panels, no PiP, no mini-window.
 * - Prevents duplicate bubbles across repeated minimize/resume events.
 * - Hides and cleans up when app resumes, driver goes offline, or on logout.
 * - Completely isolated from LocationService and driver availability logic.
 */
class FloatingBubbleManager private constructor(private val context: Context) {

    companion object {
        private const val TAG = "FloatingBubbleManager"
        private const val BUBBLE_SIZE_DP = 58
        private const val BUBBLE_MARGIN_DP = 12

        @Volatile
        private var instance: FloatingBubbleManager? = null

        fun getInstance(context: Context): FloatingBubbleManager {
            return instance ?: synchronized(this) {
                instance ?: FloatingBubbleManager(context.applicationContext).also { instance = it }
            }
        }
    }

    private val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as? WindowManager
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile
    private var bubbleView: View? = null

    @Volatile
    private var isShowing = false

    @Volatile
    private var isFeatureEnabled = false

    @Volatile
    private var isDriverEligible = false

    @Volatile
    private var isAppInForeground = true

    private var layoutParams: WindowManager.LayoutParams? = null
    private var lastX = -1
    private var lastY = -1

    /**
     * Checks whether the SYSTEM_ALERT_WINDOW permission is currently granted.
     */
    fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
    }

    /**
     * Updates user preference for the floating bubble feature.
     */
    fun setFeatureEnabled(enabled: Boolean) {
        isFeatureEnabled = enabled
        if (!enabled) {
            hideBubble()
        } else if (!isAppInForeground && isDriverEligible) {
            showBubble()
        }
    }

    /**
     * Updates driver eligibility (e.g. Online searching for rides or on an active trip).
     */
    fun setDriverEligible(eligible: Boolean) {
        isDriverEligible = eligible
        if (!eligible) {
            hideBubble()
        } else if (!isAppInForeground && isFeatureEnabled) {
            showBubble()
        }
    }

    /**
     * Called when the app transitions from foreground to background / minimized.
     */
    fun onAppMinimized() {
        isAppInForeground = false
        if (isFeatureEnabled && isDriverEligible && canDrawOverlays()) {
            showBubble()
        }
    }

    /**
     * Called when the app returns to foreground.
     */
    fun onAppResumed() {
        isAppInForeground = true
        hideBubble()
    }

    fun isShowing(): Boolean = isShowing

    /**
     * Displays the circular floating bubble over other apps.
     */
    @Synchronized
    fun showBubble(): Boolean {
        if (!canDrawOverlays()) {
            Log.w(TAG, "Cannot show bubble: overlay permission not granted")
            return false
        }

        if (isShowing && bubbleView != null) {
            Log.d(TAG, "Bubble is already showing, skipping duplicate")
            return true
        }

        mainHandler.post {
            try {
                if (isShowing && bubbleView != null) return@post
                val wm = windowManager ?: return@post

                val density = context.resources.displayMetrics.density
                val bubbleSizePx = (BUBBLE_SIZE_DP * density).toInt()
                val marginPx = (BUBBLE_MARGIN_DP * density).toInt()
                val displayMetrics = context.resources.displayMetrics
                val screenWidth = displayMetrics.widthPixels
                val screenHeight = displayMetrics.heightPixels

                val layoutType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                } else {
                    @Suppress("DEPRECATION")
                    WindowManager.LayoutParams.TYPE_PHONE
                }

                val initialX = if (lastX >= 0) lastX else (screenWidth - bubbleSizePx - marginPx)
                val initialY = if (lastY >= 0) lastY else (screenHeight / 3)

                val params = WindowManager.LayoutParams(
                    bubbleSizePx,
                    bubbleSizePx,
                    layoutType,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                            WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
                    PixelFormat.TRANSLUCENT
                ).apply {
                    gravity = Gravity.TOP or Gravity.START
                    x = initialX
                    y = initialY
                }
                layoutParams = params

                val view = createBubbleView(bubbleSizePx, density, params)
                bubbleView = view
                wm.addView(view, params)
                isShowing = true
                Log.d(TAG, "Floating bubble displayed successfully")
            } catch (e: Exception) {
                Log.e(TAG, "Error displaying floating bubble", e)
                isShowing = false
                bubbleView = null
            }
        }
        return true
    }

    /**
     * Removes the circular floating bubble from the WindowManager.
     */
    @Synchronized
    fun hideBubble(): Boolean {
        mainHandler.post {
            try {
                val view = bubbleView
                if (view != null && isShowing && windowManager != null) {
                    windowManager.removeView(view)
                    Log.d(TAG, "Floating bubble removed successfully")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error removing floating bubble", e)
            } finally {
                bubbleView = null
                isShowing = false
            }
        }
        return true
    }

    fun cleanup() {
        hideBubble()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createBubbleView(
        sizePx: Int,
        density: Float,
        params: WindowManager.LayoutParams
    ): View {
        val root = FrameLayout(context).apply {
            layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(Color.WHITE)
                setStroke((2.5f * density).toInt(), Color.parseColor("#2563EB")) // Primary brand blue ring
            }
            elevation = 10f * density
            outlineProvider = ViewOutlineProvider.BACKGROUND
            clipToOutline = true
        }

        val iconRes = try {
            R.mipmap.ic_launcher_round
        } catch (_: Throwable) {
            R.mipmap.ic_launcher
        }

        val imageView = ImageView(context).apply {
            val padding = (7 * density).toInt()
            setPadding(padding, padding, padding, padding)
            scaleType = ImageView.ScaleType.FIT_CENTER
            setImageResource(iconRes)
        }
        root.addView(
            imageView,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )

        val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
        var initialX = 0
        var initialY = 0
        var initialTouchX = 0f
        var initialTouchY = 0f
        var touchStartTime = 0L
        var isDragging = false

        root.setOnTouchListener { _, event ->
            val wm = windowManager ?: return@setOnTouchListener false
            val currentParams = layoutParams ?: return@setOnTouchListener false

            when (event.action) {
                MotionEvent.ACTION_DOWN -> {
                    initialX = currentParams.x
                    initialY = currentParams.y
                    initialTouchX = event.rawX
                    initialTouchY = event.rawY
                    touchStartTime = System.currentTimeMillis()
                    isDragging = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - initialTouchX).toInt()
                    val dy = (event.rawY - initialTouchY).toInt()

                    if (!isDragging && Math.hypot(dx.toDouble(), dy.toDouble()) > touchSlop) {
                        isDragging = true
                    }

                    if (isDragging) {
                        val metrics = context.resources.displayMetrics
                        val screenWidth = metrics.widthPixels
                        val screenHeight = metrics.heightPixels
                        val minY = (24 * density).toInt()
                        val maxY = screenHeight - sizePx - (48 * density).toInt()

                        currentParams.x = (initialX + dx).coerceIn(0, screenWidth - sizePx)
                        currentParams.y = (initialY + dy).coerceIn(minY, maxY)

                        lastX = currentParams.x
                        lastY = currentParams.y

                        try {
                            wm.updateViewLayout(root, currentParams)
                        } catch (_: Exception) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    val totalDx = Math.abs(event.rawX - initialTouchX)
                    val totalDy = Math.abs(event.rawY - initialTouchY)
                    val duration = System.currentTimeMillis() - touchStartTime

                    if (!isDragging && totalDx < touchSlop && totalDy < touchSlop && duration < 350) {
                        // Tapped: Bring existing MultipleRide Driver App to foreground
                        openDriverApp()
                    } else {
                        // Dragged: Snap to nearest screen edge smoothly
                        snapToNearestEdge(root, currentParams, sizePx, density)
                    }
                    true
                }
                else -> false
            }
        }

        return root
    }

    private fun openDriverApp() {
        try {
            val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_SINGLE_TOP or
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
            }
            if (launchIntent != null) {
                context.startActivity(launchIntent)
            }
            hideBubble()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to launch driver app", e)
        }
    }

    private fun snapToNearestEdge(
        view: View,
        params: WindowManager.LayoutParams,
        sizePx: Int,
        density: Float
    ) {
        val wm = windowManager ?: return
        val metrics = context.resources.displayMetrics
        val screenWidth = metrics.widthPixels
        val marginPx = (BUBBLE_MARGIN_DP * density).toInt()

        val bubbleCenter = params.x + (sizePx / 2)
        val targetX = if (bubbleCenter < screenWidth / 2) {
            marginPx
        } else {
            screenWidth - sizePx - marginPx
        }

        val startX = params.x
        val animator = ValueAnimator.ofInt(startX, targetX).apply {
            duration = 180
            interpolator = DecelerateInterpolator()
            addUpdateListener { va ->
                if (isShowing && bubbleView != null) {
                    params.x = va.animatedValue as Int
                    lastX = params.x
                    try {
                        wm.updateViewLayout(view, params)
                    } catch (_: Exception) {}
                }
            }
        }
        animator.start()
    }
}
