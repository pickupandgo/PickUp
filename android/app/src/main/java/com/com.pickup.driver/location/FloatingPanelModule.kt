package com.multipleride.driver.location

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import com.facebook.react.bridge.*

class FloatingPanelModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
    override fun getName() = "PartnerFloatingPanel"
    @ReactMethod fun status(promise: Promise) { promise.resolve(Arguments.createMap().apply {
        putBoolean("enabled", PartnerFloatingPanel.enabled()); putBoolean("permission", Settings.canDrawOverlays(reactApplicationContext))
    }) }
    @ReactMethod fun enable(value: Boolean, promise: Promise) { PartnerFloatingPanel.setEnabled(value); promise.resolve(true) }
    @ReactMethod fun permission(promise: Promise) {
        try { reactApplicationContext.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${reactApplicationContext.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); promise.resolve(true) }
        catch (_: Exception) { promise.reject("OVERLAY_SETTINGS", "Open Android settings to allow display over other apps.") }
    }
    @ReactMethod fun state(title: String, detail: String, offerId: String?, expiresAt: Double) { PartnerFloatingPanel.update(title, detail, offerId, expiresAt.toLong()) }
    @ReactMethod fun clear() { PartnerFloatingPanel.clear() }
    @ReactMethod fun takeAction(promise: Promise) { val action = PartnerFloatingPanel.takeAction(); promise.resolve(action?.let { Arguments.createMap().apply { putString("offerId",it.first); putString("action",it.second) } }) }
}
