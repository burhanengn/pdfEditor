package dev.gullacpdf.android.ui.library

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import dev.gullacpdf.android.l10n.GpLocale
import dev.gullacpdf.android.l10n.GpStrings
import dev.gullacpdf.android.model.GpRecentDoc
import dev.gullacpdf.android.theme.GpComponents
import dev.gullacpdf.android.theme.GpReadingTheme
import dev.gullacpdf.android.theme.GpSpacing
import dev.gullacpdf.android.theme.GpTypography
import dev.gullacpdf.android.theme.LocalGpPalette
import dev.gullacpdf.android.ui.components.GpIcons
import dev.gullacpdf.android.ui.components.GullacBrandMark
import dev.gullacpdf.android.viewmodel.GpAppState

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LibraryScreen(
    state: GpAppState,
    strings: GpStrings,
    onOpenPicker: () -> Unit,
    onCreateBlankPdf: () -> Unit,
    onReopenRecent: (GpRecentDoc) -> Unit,
    onOpenDefaultAppSettings: () -> Unit,
    onSetLocale: (GpLocale) -> Unit,
    onCycleTheme: () -> Unit,
    onDiscardRecovery: () -> Unit,
) {
    val palette = LocalGpPalette.current
    var langMenuOpen by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .navigationBarsPadding(),
    ) {
        // Polished Branded Top Header
        Surface(
            color = palette.surfaceRaised,
            shadowElevation = 2.dp,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Row(
                modifier = Modifier
                    .statusBarsPadding()
                    .height(56.dp)
                    .padding(horizontal = GpSpacing.s4),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                GullacBrandMark(size = 32.dp)
                Spacer(Modifier.width(12.dp))
                Text(
                    text = strings.t("app.name"),
                    style = GpTypography.titleL,
                    color = palette.textPrimary,
                )
                Spacer(Modifier.weight(1f))

                Box {
                    TextButton(onClick = { langMenuOpen = true }) {
                        Icon(GpIcons.Language, contentDescription = strings.t("settings.language"), tint = palette.textPrimary, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(4.dp))
                        Text(state.locale.code.uppercase(), style = GpTypography.label, color = palette.textPrimary)
                    }
                    DropdownMenu(expanded = langMenuOpen, onDismissRequest = { langMenuOpen = false }) {
                        DropdownMenuItem(
                            text = { Text(strings.t("settings.languageEn")) },
                            onClick = { langMenuOpen = false; onSetLocale(GpLocale.EN) },
                        )
                        DropdownMenuItem(
                            text = { Text(strings.t("settings.languageTr")) },
                            onClick = { langMenuOpen = false; onSetLocale(GpLocale.TR) },
                        )
                    }
                }

                IconButton(onClick = onCycleTheme) {
                    Icon(
                        imageVector = GpIcons.ThemeMode,
                        contentDescription = strings.t(
                            when (state.theme) {
                                GpReadingTheme.LIGHT -> "theme.light"
                                GpReadingTheme.DARK -> "theme.dark"
                                GpReadingTheme.SEPIA -> "theme.sepia"
                            },
                        ),
                        tint = palette.textPrimary,
                    )
                }
            }
        }

        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.TopCenter,
        ) {
            LazyColumn(
                modifier = Modifier
                    .widthIn(max = 760.dp)
                    .fillMaxSize()
                    .padding(horizontal = GpSpacing.s4),
                verticalArrangement = Arrangement.spacedBy(GpSpacing.s3),
            ) {
                item { Spacer(Modifier.height(GpSpacing.s2)) }

                if (state.recoverableAutosaveJson != null) {
                    item {
                        Surface(
                            color = palette.surfaceOverlay,
                            shape = RoundedCornerShape(14.dp),
                            border = BorderStroke(1.dp, palette.accent),
                        ) {
                            Row(
                                modifier = Modifier.fillMaxWidth().padding(GpSpacing.s3),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Text(
                                    text = strings.t("session.recoveryPrompt", mapOf("name" to "document.pdf")),
                                    style = GpTypography.body,
                                    color = palette.textPrimary,
                                    modifier = Modifier.weight(1f),
                                )
                                TextButton(onClick = onDiscardRecovery) {
                                    Text(strings.t("action.discardSession"))
                                }
                            }
                        }
                    }
                }

                // Hero Card
                item {
                    Surface(
                        color = palette.surfaceRaised,
                        shape = RoundedCornerShape(GpComponents.sheetRadius),
                        border = BorderStroke(1.dp, palette.borderSubtle),
                        shadowElevation = 1.dp,
                    ) {
                        Column(modifier = Modifier.fillMaxWidth().padding(GpSpacing.s5)) {
                            Text(
                                text = strings.t("app.tagline"),
                                style = GpTypography.titleL,
                                color = palette.textPrimary,
                            )
                            Spacer(Modifier.height(GpSpacing.s4))
                            FlowRow(
                                horizontalArrangement = Arrangement.spacedBy(GpSpacing.s3),
                                verticalArrangement = Arrangement.spacedBy(GpSpacing.s2),
                            ) {
                                Button(
                                    onClick = onOpenPicker,
                                    colors = ButtonDefaults.buttonColors(
                                        containerColor = palette.accent,
                                        contentColor = palette.accentForeground,
                                    ),
                                    modifier = Modifier.height(GpComponents.primaryTouchTarget),
                                ) {
                                    Icon(GpIcons.FolderOpen, contentDescription = null, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(strings.t("action.openPdf"), style = GpTypography.label)
                                }
                                OutlinedButton(
                                    onClick = onCreateBlankPdf,
                                    border = BorderStroke(1.dp, palette.border),
                                    modifier = Modifier.height(GpComponents.primaryTouchTarget),
                                ) {
                                    Icon(GpIcons.NoteAdd, contentDescription = null, tint = palette.textPrimary, modifier = Modifier.size(18.dp))
                                    Spacer(Modifier.width(8.dp))
                                    Text(strings.t("action.startBlank"), style = GpTypography.label, color = palette.textPrimary)
                                }
                            }
                            Spacer(Modifier.height(GpSpacing.s2))
                            TextButton(onClick = onOpenDefaultAppSettings) {
                                Text(
                                    text = strings.t("mobile.setDefaultAppHint"),
                                    style = GpTypography.caption,
                                    color = palette.accent,
                                )
                            }
                        }
                    }
                }

                item {
                    Spacer(Modifier.height(GpSpacing.s1))
                    Text(
                        text = strings.t("mobile.recentDocuments"),
                        style = GpTypography.titleM,
                        color = palette.textPrimary,
                    )
                }

                if (state.recentDocs.isEmpty()) {
                    item {
                        Surface(
                            color = palette.surfaceRaised,
                            shape = RoundedCornerShape(14.dp),
                            border = BorderStroke(1.dp, palette.borderSubtle),
                        ) {
                            Text(
                                text = strings.t("mobile.noRecentDocuments"),
                                style = GpTypography.body,
                                color = palette.textSecondary,
                                modifier = Modifier.fillMaxWidth().padding(GpSpacing.s4),
                            )
                        }
                    }
                } else {
                    items(state.recentDocs, key = { it.sourceId + it.lastOpenedMs }) { doc ->
                        Surface(
                            color = palette.surfaceRaised,
                            shape = RoundedCornerShape(14.dp),
                            border = BorderStroke(1.dp, palette.borderSubtle),
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onReopenRecent(doc) },
                        ) {
                            Row(
                                modifier = Modifier.padding(horizontal = GpSpacing.s4, vertical = GpSpacing.s3),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Surface(
                                    color = palette.danger.copy(alpha = 0.14f),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.size(40.dp),
                                ) {
                                    Box(contentAlignment = Alignment.Center) {
                                        Text("PDF", style = GpTypography.caption, color = palette.danger)
                                    }
                                }
                                Spacer(Modifier.width(12.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = doc.displayName,
                                        style = GpTypography.body,
                                        color = palette.textPrimary,
                                        maxLines = 1,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                    Text(
                                        text = "${strings.t("nav.pages")} ${doc.lastPageIndex + 1}",
                                        style = GpTypography.caption,
                                        color = palette.textSecondary,
                                    )
                                }
                                Icon(GpIcons.ChevronRight, contentDescription = null, tint = palette.textSecondary)
                            }
                        }
                    }
                }

                item { Spacer(Modifier.height(GpSpacing.s5)) }
            }
        }
    }
}
