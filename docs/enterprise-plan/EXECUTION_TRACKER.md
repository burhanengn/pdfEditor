# EXECUTION TRACKER — gullacpdf Enterprise Viewer/Editor & Flutter Mobile

> **Tek Doğruluk Kaynağı:** `docs/enterprise-plan/00_DECISION_LOG.md` – `04_MOBILE_APP_STRATEGY_AND_OS_INTEGRATION.md`
> **Başlangıç Tarihi:** 2026-11-17
> **Durum:** Aktif — Tam otonom uçtan uca inşa

---

## Faz F0 — Hızlı Kazanımlar ve Ölçüm Tabanı

- [x] **F0.1** Performans ölçüm tabanı: referans PDF üretici (1 sayfa form, çok sayfalı metin, vektör yoğun, şifreli, Türkçe/RTL/CJK), performans izleme yardımcısı (`TTFP`, uzun görevler, bellek işaretleri) ve ölçüm testleri
- [x] **F0.2** `wasmWorkerClient` + `pdfWasm.worker.ts`: `Transferable` ile sıfır-kopya aktarım; worker içinde belge kimlik kaydı (`registerSourceDoc` / `releaseSourceDoc`); `extractPageText` ve `prepareCleanPage` çağrılarından bayt yükünün çıkarılması
- [x] **F0.3** PDF baytlarının Zustand store'dan (`useEditorStore.sourceDocs`) çıkarılması; baytların store dışı `sourceDocRegistry`'de tutulması
- [x] **F0.4** Sayfa analizinin (`extractPageImagesAndRules` + `extractPageText`) yalnızca düzenleme niyetinde tetiklenmesi; Viewer/okuma akışında çalışmaması
- [x] **F0.5** `MobilePagesSheet` ve `PageOrganizeModal` için paylaşımlı sanal thumbnail ızgarası (`@tanstack/react-virtual`)
- [x] **F0.6** `embeddedFontExtractor`'ın Web Worker'a taşınması (ana thread'de `PDFDocument.load` çağrısının tamamen kaldırılması)
- [x] **F0.7** Otomatik kayıt (IndexedDB/OPFS oturum depolama), oturum kurtarma banner'ı/diyaloğu ve `beforeunload` kaydedilmemiş değişiklik uyarısı
- [x] **F0.8** i18n sözlüğü (`en` varsayılan, `tr` seçilebilir; cihaz dili `tr` ise Türkçe; dinamik `<html lang>`), ve tüm repo genelinde **gullacpdf** marka birliği (`README.md`, `package.json`, `index.html`, `vite.config.ts`)
- [x] **F0.9** Enterprise Tasarım Sistemi CSS token'ları (`--gp-*`), tipografi ölçeği (`>= 12px` zorunluluğu, 12 px altı tüm sınıfların kaldırılması) ve Açık/Koyu/Sepya tema token altyapısı

---

## Faz F1 — PDFium Viewer Çekirdeği & Çift Modlu Mobile-First Web UX

- [x] **F1.1** Sabitlenmiş PDFium Wasm ikilisi (`pdfium.wasm`) ve JS/TS köprü adaptörü + tek-thread öncelikli/iptal edilebilir iş kuyruğu (`PdfiumScheduler`)
- [x] **F1.2** Üç katmanlı render boru hattı (İskelet → Düşük çözünürlüklü önizleme → 512×512 karolar), bayt bütçeli LRU `TileCache`, `ImageBitmap` transferi, `visibilitychange` / bellek baskısında `trim()`, prefix-sum + ikili arama sayfa sanallaştırması
- [x] **F1.3** Worker topolojisi (`Engine Worker` + `Render Worker` + `Export Worker`; mobilde >80 MB için tek-worker düşüşü; `SharedArrayBuffer` gerektirmeyen yapı)
- [x] **F1.4** Çift Modlu Durum Makinesi (`view` varsayılan ↔ `edit` tek tuş + `E` kısayolu, ±2 px görünüm çapası korunumu) ve Viewer yetenekleri (saydam `TextLayer`, akışlı Türkçe-katlamalı arama, Outline + sanal Thumbnail `NavigatorDrawer`, `LinkLayer`, Okuma temaları Açık/Koyu/Sepya, Sayfaya Git hapı, Yazdır, Açık Kaynak Lisanslar, K4 hafif işaretleme)
- [x] **F1.5** Mobile-First Web Arayüzü (360×640'tan Kompakt `<600`, Orta `600–1023`, Geniş `>=1024`), başparmak bölgesi düzeni, kademeli `Sheet` (Peek/Yarım/Tam, drag/snap/scroll-handoff/History-Esc), `>=44×44px` dokunma hedefleri, sol-el desteği
- [x] **F1.6** Merkezi Dokunmatik Jest Motoru (`PointerTracker`, `GestureArena` hakemlik tablosu, statik `touch-action: none`, odak korumalı Pinch-to-Zoom + lastik sınır + mıknatıs, ataletli Pan + eksen kilidi, 44 px tutamaçlı nesne sürükleme/boyutlandırma/döndürme, dokunmatik metin seçimi büyüteci, `getCoalescedEvents` / stylus basınçlı çizim)
- [x] **F1.7** Editor UX bölünmesi (`ViewerShell` + tembel `EditorShell`, 6 eylemli bağlamsal çubuklar, 3 katmanlı `ObjectsPanel`, "Önizle" modu, **K7** "Kopya olarak kaydet" varsayılanı + üzerine yazma ilk onay diyaloğu)
- [x] **F1.8** `pdfjs-dist` Viewer render yolundan çıkarılması; F1 bütçe ve erişilebilirlik doğrulamaları (Vitest + Playwright)

---

## Faz F2 — Rust Çekirdek A (`gp-model`, `gp-geom`, `gp-text`, `bindings/wasm`)

- [x] **F2.1** Rust workspace kurulumu (`core/Cargo.toml`, `gp-model`, `gp-geom`, `gp-text`, `gp-pdf`, `gp-engine`, `bindings/wasm`)
- [x] **F2.2** `gp-model`: Doküman modeli (`PageMeta`, `CanvasElement`), `Command` + ters komut günlüğü ile undo/redo, seçim, `serde` oturum serileştirme
- [x] **F2.3** `gp-geom`: `coordinates.ts`, `snapGuides.ts`, `vectorShapes.ts`, `imageMask.ts` (`computeRotatedResizeRect`, hit-test, snapping, clipping mask) Rust portu + birim testleri
- [x] **F2.4** `gp-text`: `textExtractor.ts`, `richText.ts`, `fonts.ts`, `pageRange.ts`, `pageNumbers.ts` Rust portu + Türkçe arama katlama + birim testleri
- [x] **F2.5** `core/bindings/wasm` (`wasm-pack`) derlemesi, Web Worker entegrasyonu ve tüm mevcut Vitest eşdeğerlik testlerinin yeşil geçmesi

---

## Faz F3 — Rust Çekirdek B (`gp-pdf-pdfium`, `gp-redact`) & MuPDF/AGPL Sökülmesi

- [x] **F3.1** **D3 Teknik Doğrulama (Spike):** PDFium nesne düzeyinde kaldırma + kısmi glif yeniden yazımı VE `lopdf` tabanlı Rust içerik akışı yeniden yazıcı; her redaksiyon sonrası `FPDFText_*` ile metnin sıfır kaldığını kanıtlayan otomatik assertion testleri
- [x] **F3.2** `gp-pdf-pdfium`: `PdfBackend` uygulaması (karo/thumbnail raster, metin/span, arama, outline, bağlantılar, nesne çıkarımı, metin/görsel/yol ekleme + font gömme, sayfa içe aktarma/silme/döndürme, `FPDF_SaveAsCopy`)
- [x] **F3.3** `gp-engine`: Session cephesi (tek PDFium thread'i + öncelik kuyruğu/iptal, sayfa LRU, `trim()`, ilerleme/iptal destekli derleme)
- [x] **F3.4** Web sürümünün tamamen `core/bindings/wasm` + PDFium'a geçirilmesi; `mupdf`, `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit` bağımlılıklarının tamamen sökülmesi (AGPL bağımlılığı = 0) ve regresyon doğrulaması (`23/23` Cargo, `108/108` Vitest, `22/22` Playwright E2E)

---

## Faz F4 — Web Üretim Optimizasyonu & Cloudflare Pages

- [x] **F4.1** `public/_headers` (Cloudflare Pages önbellek başlıkları), belgede güvenli SW güncelleme toast'ı, `file_handlers` + `launchQueue`, `share_target`, File System Access API entegrasyonu
- [x] **F4.2** Bellek sızıntısı ve referans doküman seti görsel/performans regresyon kapısı (`19/19` dosya / `111/111` Vitest + `24/24` Playwright E2E)

---

## Faz M0 – M4 — Flutter Mobil Uygulama & OS "Birlikte Aç" Entegrasyonu

- [x] **M0.1** `design-tokens/` tek kaynak üretici (`design-tokens/generate.mjs`: CSS `--gp-*` + Dart `GpPalette` `ThemeExtension` + ortak EN/TR sözlük `dictionaries.ts` / `gp_l10n.g.dart` / ARB üretimi)
- [x] **M0.2** `mobile/` Flutter projesinin kurulması (Android API 26+, iOS 16+, tablet çoklu pencere, MuPDF YOK) + `core/bindings/frb` (`flutter_rust_bridge` v2.12.0) ve PDFium `chromium/7881` yerel ikili/köprü entegrasyonu
- [x] **M0.3** M0 Teknik Prototip: `Session` köprüsü, 256×256 `TileCache` (`ui.Image` + bayt bütçeli LRU + `didHaveMemoryPressure` `trim()`), `PdfViewport` `CustomPainter`, `GpGestureController` (pinch/pan/atalet + kalem/avuç içi) ve testler
- [x] **M1.1** **OS "Birlikte Aç" / Varsayılan PDF Açıcı Entegrasyonu:**
  - Android: `AndroidManifest.xml` (`ACTION_VIEW`, `ACTION_SEND`, `ACTION_SEND_MULTIPLE`, `content://` + `file://`, depolama izni yok) + `FileBridgePlugin.kt` (64 KB akış kopyalama, `OpenableColumns`, `onNewIntent`, `FLAG_GRANT_WRITE_URI_PERMISSION`, `ACTION_CREATE_DOCUMENT`, `FileProvider` paylaşım)
  - iOS: `Info.plist` (`CFBundleDocumentTypes` `com.adobe.pdf` Alternate/Editor, `LSSupportsOpeningDocumentsInPlace`, `UIFileSharingEnabled`) + `SceneDelegate.swift` + `FileBridge.swift` (`openURLContexts`, `startAccessingSecurityScopedResource`, `NSFileCoordinator`, `bookmarkData`, `replaceItemAt`)
  - Dart `GpFileBridge` + `GpOpenRequest` → doğrudan Viewer modunda açılış
- [x] **M1.2** Flutter Viewer UI (Kompakt Telefon, Orta/Geniş Tablet, Katlanabilir `bookSplit` duruş & Split View, Açık/Koyu/Sepya temalar, akışlı Türkçe arama, İçindekiler/Thumbnail sheet, Farklı Kaydet/Paylaş/Yazdır, EN/TR)
- [x] **M2.1** Flutter Editor Temel (Tek tuşla Viewer↔Editor geçişi + ±2px anchor korunumu, `EditableText` metin düzenleme, hayalet imza yerleştirme, kalem basınç/silgi çizimi, vurgulama, şekil/düzen, undo/redo, oturum otomatik kayıt/kurtarma, güvenli atomik geçici-dosya doğrulamalı Kaydet / Kopya kaydet)
- [x] **M3.1** Flutter Editor İleri + iOS Share Extension (Şekil/kalem/kırmızı redaksiyon, sayfa döndürme/sıralama/silme/birleştirme, donanım klavye kısayolları `Ctrl+Z/Y/S/F` + `E`, Flutter motoru yüklemeyen yerel `ios/ShareExtension` + `group.dev.gullacpdf.mobile` App Group el sıkışması)
- [x] **M4.1** Mobil Sertleştirme & Doğrulama (`flutter analyze` 0 sorun, `flutter test` tüm testler yeşil + canlı `gp_frb.dll` / `pdfium.dll` FFI doğrulaması, Android arm64 APK derlemesi & `AndroidManifest`/plist/`AGPL=0` denetimi)
