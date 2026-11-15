package com.ardia.phone

import android.content.Context

object PendingCounts {
    private const val PREFERENCES = "ardia-pending-counts"
    const val TABS_SENT = "tabs_sent"

    fun add(context: Context, field: String, by: Int = 1) = synchronized(this) {
        val preferences = (context.applicationContext ?: context).getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        preferences.edit().putInt(field, preferences.getInt(field, 0) + by).commit()
        Unit
    }

    fun take(context: Context): Map<String, Int> = synchronized(this) {
        val preferences = (context.applicationContext ?: context).getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)
        val taken = preferences.all.mapNotNull { (field, value) -> (value as? Int)?.takeIf { it > 0 }?.let { field to it } }.toMap()
        preferences.edit().clear().commit()
        taken
    }
}
