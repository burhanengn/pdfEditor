package dev.gullacpdf.android.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf

val LocalGpPalette = staticCompositionLocalOf { GpPalettes.Dark }

@Composable
fun GullacTheme(
    readingTheme: GpReadingTheme,
    content: @Composable () -> Unit,
) {
    val palette = GpPalettes.forTheme(readingTheme)
    val colorScheme = if (readingTheme == GpReadingTheme.LIGHT) {
        lightColorScheme(
            primary = palette.accent,
            onPrimary = palette.accentForeground,
            surface = palette.surface,
            onSurface = palette.textPrimary,
            surfaceVariant = palette.surfaceRaised,
            onSurfaceVariant = palette.textSecondary,
            background = palette.surface,
            onBackground = palette.textPrimary,
            outline = palette.border,
            outlineVariant = palette.borderSubtle,
            error = palette.danger,
        )
    } else {
        darkColorScheme(
            primary = palette.accent,
            onPrimary = palette.accentForeground,
            surface = palette.surface,
            onSurface = palette.textPrimary,
            surfaceVariant = palette.surfaceRaised,
            onSurfaceVariant = palette.textSecondary,
            background = palette.surface,
            onBackground = palette.textPrimary,
            outline = palette.border,
            outlineVariant = palette.borderSubtle,
            error = palette.danger,
        )
    }

    CompositionLocalProvider(LocalGpPalette provides palette) {
        MaterialTheme(
            colorScheme = colorScheme,
            content = content,
        )
    }
}
