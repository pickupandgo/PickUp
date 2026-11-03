package com.multipleride.driver.location

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import com.google.firebase.auth.FirebaseAuth

/** Optional, non-focusable panel. Business actions are handed to the authenticated app. */
internal object PartnerFloatingPanel : Application.ActivityLifecycleCallbacks {
    private lateinit var context: Context
    private val handler = Handler(Looper.getMainLooper())
    private var visibleActivities = 0
    private var panel: LinearLayout? = null
    private var layout: WindowManager.LayoutParams? = null
    private var collapsed = false
    private var hidden = false
    private var owner: String? = null
    private var title = "MultipleRide Partner"
    private var detail = ""
    private var offerId: String? = null
    private var expiresAt = 0L
    private var pending: Triple<String, String, String>? = null
    private var bodyView: TextView? = null
    private val pulse = object : Runnable {
        override fun run() {
            if (panel == null) return
            if (!Settings.canDrawOverlays(context) || !OnlinePreference.isOnline(context) ||
                !LocationService.isServiceRunning() || (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked) {
                remove(); return
            }
            if (offerId != null && expiresAt <= System.currentTimeMillis()) { offerId = null; detail = "Request expired. Open Partner for current availability."; render(); return }
            bodyView?.text = bodyText()
            handler.postDelayed(this, 1000)
        }
    }
    private fun bodyText(): String = if (expiresAt > System.currentTimeMillis() && offerId != null)
        "$title\n${(expiresAt-System.currentTimeMillis())/1000}s remaining\n$detail" else "Online · ${LocationService.connectionHealth().lowercase()}\n$detail"
    fun install(app: Application) { context = app; app.registerActivityLifecycleCallbacks(this) }
    fun enabled() = context.getSharedPreferences("partner_panel", Context.MODE_PRIVATE).getBoolean("enabled", false)
    fun setEnabled(value: Boolean) {
        context.getSharedPreferences("partner_panel", Context.MODE_PRIVATE).edit().putBoolean("enabled", value).apply()
        hidden = false; refresh()
    }
    fun update(nextTitle: String, nextDetail: String, id: String?, expiry: Long) {
        handler.post {
            owner = FirebaseAuth.getInstance().currentUser?.uid
            title = nextTitle.take(80); detail = nextDetail.take(300)
            offerId = id?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) }; expiresAt = expiry
            refresh()
        }
    }
    fun takeAction(): Pair<String, String>? {
        val action = pending; pending = null
        return if (action != null && action.first == FirebaseAuth.getInstance().currentUser?.uid)
            Pair(action.second, action.third) else null
    }
    fun clear() { handler.post { pending = null; offerId = null; detail = ""; owner = null; remove() } }
    fun refresh() { handler.post { render() } }
    private fun remove() {
        handler.removeCallbacks(pulse)
        panel?.let { try { (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(it) } catch (_: Exception) {} }
        panel = null
        bodyView = null
    }
    private fun open(action: String? = null) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        if (action != null && offerId != null && expiresAt > System.currentTimeMillis()) pending = Triple(uid, offerId!!, action)
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
            it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            context.startActivity(it)
        }
        remove()
    }
    private fun render() {
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        val locked = (context.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
        if (!enabled() || hidden || visibleActivities > 0 || locked || uid == null ||
            !OnlinePreference.isOnline(context) || !LocationService.isServiceRunning() || !Settings.canDrawOverlays(context)) {
            remove(); return
        }
        if (owner != null && owner != uid) { clear(); return }
        remove()
        val density = context.resources.displayMetrics.density
        fun dp(n: Int) = (n * density).toInt()
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(8), dp(12), dp(8))
            setBackgroundColor(Color.rgb(247,249,252)); elevation = dp(6).toFloat()
        }
        val header = TextView(context).apply {
            text = "MultipleRide Partner"
            textSize = 14f; setTextColor(Color.rgb(3,7,29)); minHeight = dp(48)
        }
        root.addView(header)
        if (!collapsed) {
            val body = TextView(context).apply {
                text = bodyText()
                textSize = 14f; setTextColor(Color.rgb(48,55,71))
            }
            bodyView = body; root.addView(body)
            if (offerId != null && expiresAt > System.currentTimeMillis()) {
                for (action in listOf("Accept", "Decline")) root.addView(Button(context).apply {
                    text = action; minHeight = dp(48); setOnClickListener { open(action.lowercase()) }
                })
            }
        }
        val buttons = LinearLayout(context)
        buttons.addView(Button(context).apply { text = "Open"; minHeight = dp(48); setOnClickListener { open() } }, LinearLayout.LayoutParams(0, -2, 1f))
        buttons.addView(Button(context).apply { text = if (collapsed) "+" else "−"; contentDescription = "Collapse or expand floating panel"; minHeight = dp(48); setOnClickListener { collapsed = !collapsed; render() } }, LinearLayout.LayoutParams(0, -2, 1f))
        buttons.addView(Button(context).apply { text = "Hide"; minHeight = dp(48); setOnClickListener { hidden = true; remove() } }, LinearLayout.LayoutParams(0, -2, 1f))
        root.addView(buttons)
        val width = minOf(dp(300), context.resources.displayMetrics.widthPixels - dp(24))
        val params = WindowManager.LayoutParams(width, WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT).apply {
            gravity = Gravity.TOP or Gravity.START; x = layout?.x ?: dp(12); y = layout?.y ?: dp(120)
        }
        var downX = 0f; var downY = 0f; var startX = 0; var startY = 0
        header.setOnTouchListener { _, event ->
            when (event.action) {
                MotionEvent.ACTION_DOWN -> { downX = event.rawX; downY = event.rawY; startX = params.x; startY = params.y; true }
                MotionEvent.ACTION_MOVE -> {
                    params.x = (startX + event.rawX - downX).toInt().coerceIn(0, maxOf(0, context.resources.displayMetrics.widthPixels-width))
                    params.y = (startY + event.rawY - downY).toInt().coerceIn(dp(24), maxOf(dp(24),context.resources.displayMetrics.heightPixels-root.height-dp(48)))
                    try { (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).updateViewLayout(root, params) } catch (_: Exception) {}
                    true
                }
                else -> true
            }
        }
        try { (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(root, params); panel = root; layout = params; handler.postDelayed(pulse, 1000) }
        catch (_: Exception) { panel = null }
    }
    override fun onActivityStarted(activity: Activity) { visibleActivities++; hidden = false; remove() }
    override fun onActivityStopped(activity: Activity) { visibleActivities = maxOf(0,visibleActivities-1); handler.postDelayed({ render() }, 500) }
    override fun onActivityResumed(activity: Activity) { remove() }
    override fun onActivityCreated(activity: Activity, state: Bundle?) {}
    override fun onActivityPaused(activity: Activity) {}
    override fun onActivitySaveInstanceState(activity: Activity, state: Bundle) {}
    override fun onActivityDestroyed(activity: Activity) {}
}
