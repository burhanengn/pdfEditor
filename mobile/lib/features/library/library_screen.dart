import 'package:flutter/material.dart';

import '../../app/session_state.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../theme/gp_tokens.g.dart';

/// Home / Library screen shown ONLY when opened manually without an incoming PDF intent (04 §5.3).
class GpLibraryScreen extends StatelessWidget {
  const GpLibraryScreen({
    super.key,
    required this.appState,
    required this.layoutSpec,
    required this.l10n,
    required this.onOpenPicker,
    required this.onCreateBlankPdf,
    required this.onReopenRecent,
    required this.onOpenDefaultAppSettings,
    required this.onSetLocale,
    required this.onSetTheme,
    required this.onDiscardRecovery,
  });

  final GpAppState appState;
  final GpLayoutSpec layoutSpec;
  final GpL10n l10n;
  final VoidCallback onOpenPicker;
  final VoidCallback onCreateBlankPdf;
  final void Function(GpRecentDoc doc) onReopenRecent;
  final VoidCallback onOpenDefaultAppSettings;
  final void Function(GpLocale locale) onSetLocale;
  final void Function(GpReadingTheme theme) onSetTheme;
  final VoidCallback onDiscardRecovery;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

    return Scaffold(
      backgroundColor: palette.surface,
      appBar: AppBar(
        backgroundColor: palette.surfaceRaised,
        foregroundColor: palette.textPrimary,
        elevation: 0,
        toolbarHeight: layoutSpec.isTabletOrDesktop
            ? GpComponents.toolbarHeightDesktop
            : GpComponents.toolbarHeightMobile,
        title: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              decoration: BoxDecoration(
                color: palette.accent,
                borderRadius: BorderRadius.circular(8),
              ),
              alignment: Alignment.center,
              child: Text(
                'g',
                style: GpTypography.titleM.copyWith(color: palette.accentForeground),
              ),
            ),
            const SizedBox(width: GpSpacing.s3),
            Text(
              l10n.t('app.name'),
              style: GpTypography.titleM.copyWith(color: palette.textPrimary),
            ),
          ],
        ),
        actions: [
          PopupMenuButton<GpLocale>(
            tooltip: l10n.t('settings.language'),
            initialValue: appState.locale,
            onSelected: onSetLocale,
            icon: ConstrainedBox(
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.language, size: 20),
                  const SizedBox(width: 4),
                  Text(
                    appState.locale.name.toUpperCase(),
                    style: GpTypography.label.copyWith(color: palette.textPrimary),
                  ),
                ],
              ),
            ),
            itemBuilder: (_) => [
              PopupMenuItem(value: GpLocale.en, child: Text(l10n.t('settings.languageEn'))),
              PopupMenuItem(value: GpLocale.tr, child: Text(l10n.t('settings.languageTr'))),
            ],
          ),
          IconButton(
            tooltip: l10n.t('theme.dark'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: () {
              final next = appState.theme == GpReadingTheme.dark
                  ? GpReadingTheme.light
                  : (appState.theme == GpReadingTheme.light
                      ? GpReadingTheme.sepia
                      : GpReadingTheme.dark);
              onSetTheme(next);
            },
            icon: Icon(
              appState.theme == GpReadingTheme.dark
                  ? Icons.dark_mode
                  : (appState.theme == GpReadingTheme.sepia
                      ? Icons.menu_book
                      : Icons.light_mode),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 760),
            child: ListView(
              padding: const EdgeInsets.all(GpSpacing.s4),
              children: [
                if (appState.recoverableAutosaveJson != null)
                  Container(
                    margin: const EdgeInsets.only(bottom: GpSpacing.s4),
                    padding: const EdgeInsets.all(GpSpacing.s3),
                    decoration: BoxDecoration(
                      color: palette.surfaceOverlay,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: palette.accent),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.history, color: palette.accent),
                        const SizedBox(width: GpSpacing.s3),
                        Expanded(
                          child: Text(
                            l10n.t('session.recoveryPrompt', {'name': 'document.pdf'}),
                            style: GpTypography.body.copyWith(color: palette.textPrimary),
                          ),
                        ),
                        TextButton(
                          onPressed: onDiscardRecovery,
                          child: Text(l10n.t('action.discardSession')),
                        ),
                      ],
                    ),
                  ),

                // Primary hero actions
                Container(
                  padding: const EdgeInsets.all(GpSpacing.s5),
                  decoration: BoxDecoration(
                    color: palette.surfaceRaised,
                    borderRadius: BorderRadius.circular(GpComponents.sheetRadius),
                    border: Border.all(color: palette.borderSubtle),
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.t('app.tagline'),
                        style: GpTypography.titleL.copyWith(color: palette.textPrimary),
                      ),
                      const SizedBox(height: GpSpacing.s4),
                      Wrap(
                        spacing: GpSpacing.s3,
                        runSpacing: GpSpacing.s3,
                        children: [
                          FilledButton.icon(
                            key: const Key('library-open-pdf-btn'),
                            onPressed: onOpenPicker,
                            style: FilledButton.styleFrom(
                              backgroundColor: palette.accent,
                              foregroundColor: palette.accentForeground,
                              minimumSize: const Size(160, GpComponents.primaryTouchTarget),
                            ),
                            icon: const Icon(Icons.folder_open),
                            label: Text(l10n.t('action.openPdf')),
                          ),
                          OutlinedButton.icon(
                            key: const Key('library-blank-pdf-btn'),
                            onPressed: onCreateBlankPdf,
                            style: OutlinedButton.styleFrom(
                              foregroundColor: palette.textPrimary,
                              side: BorderSide(color: palette.border),
                              minimumSize: const Size(160, GpComponents.primaryTouchTarget),
                            ),
                            icon: const Icon(Icons.note_add),
                            label: Text(l10n.t('action.startBlank')),
                          ),
                        ],
                      ),
                      const SizedBox(height: GpSpacing.s3),
                      TextButton.icon(
                        onPressed: onOpenDefaultAppSettings,
                        style: TextButton.styleFrom(
                          minimumSize: const Size(44, GpComponents.touchTargetMin),
                        ),
                        icon: const Icon(Icons.app_shortcut, size: 18),
                        label: Text(l10n.t('mobile.setDefaultAppHint')),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: GpSpacing.s5),
                Text(
                  l10n.t('mobile.recentDocuments'),
                  style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                ),
                const SizedBox(height: GpSpacing.s2),

                if (appState.recentDocs.isEmpty)
                  Container(
                    padding: const EdgeInsets.all(GpSpacing.s4),
                    decoration: BoxDecoration(
                      color: palette.surfaceRaised,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: palette.borderSubtle),
                    ),
                    child: Text(
                      l10n.t('mobile.noRecentDocuments'),
                      style: GpTypography.body.copyWith(color: palette.textSecondary),
                    ),
                  )
                else
                  ...appState.recentDocs.map(
                    (doc) => Card(
                      color: palette.surfaceRaised,
                      elevation: 0,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12),
                        side: BorderSide(color: palette.borderSubtle),
                      ),
                      child: ListTile(
                        minVerticalPadding: GpSpacing.s3,
                        leading: Icon(Icons.picture_as_pdf, color: palette.danger),
                        title: Text(
                          doc.displayName,
                          style: GpTypography.body.copyWith(color: palette.textPrimary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        subtitle: Text(
                          '${l10n.t('nav.pages')} ${doc.lastPageIndex + 1}',
                          style: GpTypography.caption.copyWith(color: palette.textSecondary),
                        ),
                        trailing: Icon(Icons.chevron_right, color: palette.textSecondary),
                        onTap: () => onReopenRecent(doc),
                      ),
                    ),
                  ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
