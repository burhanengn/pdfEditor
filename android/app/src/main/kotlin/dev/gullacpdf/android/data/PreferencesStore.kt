package dev.gullacpdf.android.data

import android.content.Context
import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpRecentDoc
import dev.gullacpdf.android.model.GpSavedSignature
import dev.gullacpdf.android.theme.GpReadingTheme
import org.json.JSONArray
import java.util.Locale

class PreferencesStore(context: Context) {
    private val prefs = context.getSharedPreferences("gp_native_prefs_v1", Context.MODE_PRIVATE)

    companion object {
        private const val K_LOCALE = "gp_locale"
        private const val K_THEME = "gp_theme"
        private const val K_DARK_INVERT = "gp_dark_invert"
        private const val K_LEFT_HANDED = "gp_left_handed"
        private const val K_DONT_ASK_OVERWRITE = "gp_dont_ask_overwrite"
        private const val K_RECENTS = "gp_recents_v1"
        private const val K_SIG_VAULT = "gp_sig_vault_v1"
        private const val K_AUTOSAVE = "gp_autosave_v1"
    }

    fun loadLocale(): GpLocale {
        val saved = prefs.getString(K_LOCALE, null)
        return when (saved) {
            "tr" -> GpLocale.TR
            "en" -> GpLocale.EN
            else -> GpStrings.detect(Locale.getDefault().language)
        }
    }

    fun saveLocale(locale: GpLocale) {
        prefs.edit().putString(K_LOCALE, locale.code).apply()
    }

    fun loadTheme(): GpReadingTheme {
        return when (prefs.getString(K_THEME, "dark")) {
            "light" -> GpReadingTheme.LIGHT
            "sepia" -> GpReadingTheme.SEPIA
            else -> GpReadingTheme.DARK
        }
    }

    fun saveTheme(theme: GpReadingTheme) {
        prefs.edit().putString(K_THEME, theme.engineKey).apply()
    }

    fun loadDarkInvert(): Boolean = prefs.getBoolean(K_DARK_INVERT, false)
    fun saveDarkInvert(value: Boolean) = prefs.edit().putBoolean(K_DARK_INVERT, value).apply()

    fun loadLeftHanded(): Boolean = prefs.getBoolean(K_LEFT_HANDED, false)
    fun saveLeftHanded(value: Boolean) = prefs.edit().putBoolean(K_LEFT_HANDED, value).apply()

    fun loadDontAskOverwrite(): Boolean = prefs.getBoolean(K_DONT_ASK_OVERWRITE, false)
    fun saveDontAskOverwrite(value: Boolean) = prefs.edit().putBoolean(K_DONT_ASK_OVERWRITE, value).apply()

    fun loadRecents(): List<GpRecentDoc> {
        val raw = prefs.getString(K_RECENTS, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    add(GpRecentDoc.fromJson(o))
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveRecents(list: List<GpRecentDoc>) {
        val arr = JSONArray().apply { list.forEach { put(it.toJson()) } }
        prefs.edit().putString(K_RECENTS, arr.toString()).apply()
    }

    fun loadSavedSignatures(): List<GpSavedSignature> {
        val raw = prefs.getString(K_SIG_VAULT, null) ?: return emptyList()
        return try {
            val arr = JSONArray(raw)
            buildList {
                for (i in 0 until arr.length()) {
                    val o = arr.optJSONObject(i) ?: continue
                    add(GpSavedSignature.fromJson(o))
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun saveSavedSignatures(list: List<GpSavedSignature>) {
        val arr = JSONArray().apply { list.forEach { put(it.toJson()) } }
        prefs.edit().putString(K_SIG_VAULT, arr.toString()).apply()
    }

    fun loadAutosave(): String? = prefs.getString(K_AUTOSAVE, null)
    fun saveAutosave(json: String) = prefs.edit().putString(K_AUTOSAVE, json).apply()
    fun clearAutosave() = prefs.edit().remove(K_AUTOSAVE).apply()
}
