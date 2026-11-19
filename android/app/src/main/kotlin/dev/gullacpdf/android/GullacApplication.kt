package dev.gullacpdf.android

import android.app.Application
import android.content.ComponentCallbacks2
import dev.gullacpdf.android.engine.NativePdfBridge

class GullacApplication : Application() {
    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
        if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            val budget = if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
                8L * 1024L * 1024L
            } else {
                32L * 1024L * 1024L
            }
            NativePdfBridge.trimEngineMemory(budget)
        }
    }

    override fun onLowMemory() {
        super.onLowMemory()
        NativePdfBridge.trimEngineMemory(4L * 1024L * 1024L)
    }
}
