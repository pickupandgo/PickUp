package com.multipleride.driver.location

import android.content.Context
import com.google.firebase.auth.FirebaseAuth

/** Explicit availability preference only. Never a claim of connectivity or a stored token. */
internal object OnlinePreference {
    private const val STORE = "partner_availability"
    fun isOnline(context: Context): Boolean {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return false
        val prefs = context.getSharedPreferences(STORE, Context.MODE_PRIVATE)
        return prefs.getString("owner", null) == uid && prefs.getBoolean("online", false)
    }
    fun set(context: Context, online: Boolean) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        val saved = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit()
            .putString("owner", uid).putBoolean("online", uid != null && online).commit()
        check(saved) { "Availability preference could not be saved" }
    }
}
