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

- [ ] **F1.1** Sabitlenmiş PDFium Wasm ikilisi (`pdfium.wasm`) ve JS/TS köprü adaptörü + tek-thread öncelikli/iptal edilebilir iş kuyruğu (`PdfiumScheduler`)
- [ ] **F1.2** Üç katmanlı render boru hattı (İskelet → Düşük çözünürlüklü önizleme → 512×512 karolar), bayt bütçeli LRU `TileCache`, `ImageBitmap` transferi, `visibilitychange` / bellek baskısında `trim()`, prefix-sum + ikili arama sayfa sanallaştırması
- [ ] **F1.3** Worker topolojisi (`Engine Worker` + `Render Worker` + `Export Worker`; mobilde >80 MB için tek-worker düşüşü; `SharedArrayBuffer` gerektirmeyen yapı)
- [ ] **F1.4** Çift Modlu Durum Makinesi (`view` varsayılan ↔ `edit` tek tuş + `E` kısayolu, ±2 px görünüm çapası korunumu) ve Viewer yetenekleri (saydam `TextLayer`, akışlı Türkçe-katlamalı arama, Outline + sanal Thumbnail `NavigatorDrawer`, `LinkLayer`, Okuma temaları Açık/Koyu/Sepya, Sayfaya Git hapı, Yazdır, Açık Kaynak Lisanslar, K4 hafif işaretleme)
- [ ] **F1.5** Mobile-First Web Arayüzü (360×640'tan Kompakt `<600`, Orta `600–1023`, Geniş `>=1024`), başparmak bölgesi düzeni, kademeli `Sheet` (Peek/Yarım/Tam, drag/snap/scroll-handoff/History-Esc), `>=44×44px` dokunma hedefleri, sol-el desteği
- [ ] **F1.6** Merkezi Dokunmatik Jest Motoru (`PointerTracker`, `GestureArena` hakemlik tablosu, statik `touch-action: none`, odak korumalı Pinch-to-Zoom + lastik sınır + mıknatıs, ataletli Pan + eksen kilidi, 44 px tutamaçlı nesne sürükleme/boyutlandırma/döndürme, dokunmatik metin seçimi büyüteci, `getCoalescedEvents` / stylus basınçlı çizim)
- [ ] **F1.7** Editor UX bölünmesi (`ViewerShell` + tembel `EditorShell`, 6 eylemli bağlamsal çubuklar, 3 katmanlı `ObjectsPanel`, "Önizle" modu, **K7** "Kopya olarak kaydet" varsayılanı + üzerine yazma ilk onay diyaloğu)
- [ ] **F1.8** `pdfjs-dist` Viewer render yolundan çıkarılması; F1 bütçe ve erişilebilirlik doğrulamaları (Vitest + Playwright)

---

## Faz F2 — Rust Çekirdek A (`gp-model`, `gp-geom`, `gp-text`, `bindings/wasm`)

- [ ] **F2.1** Rust workspace kurulumu (`core/Cargo.toml`, `gp-model`, `gp-geom`, `gp-text`, `gp-pdf`, `gp-engine`, `bindings/wasm`)
- [ ] **F2.2** `gp-model`: Doküman modeli (`PageMeta`, `CanvasElement`), `Command` + ters komut günlüğü ile undo/redo, seçim, `serde` oturum serileştirme
- [ ] **F2.3** `gp-geom`: `coordinates.ts`, `snapGuides.ts`, `vectorShapes.ts`, `imageMask.ts` (`computeRotatedResizeRect`, hit-test, snapping, clipping mask) Rust portu + birim testleri
- [ ] **F2.4** `gp-text`: `textExtractor.ts`, `richText.ts`, `fonts.ts`, `pageRange.ts`, `pageNumbers.ts` Rust portu + Türkçe arama katlama + birim testleri
- [ ] **F2.5** `core/bindings/wasm` (`wasm-pack`) derlemesi, Web Worker entegrasyonu ve tüm mevcut Vitest eşdeğerlik testlerinin yeşil geçmesi

---

## Faz F3 — Rust Çekirdek B (`gp-pdf-pdfium`, `gp-redact`) & MuPDF/AGPL Sökülmesi

- [ ] **F3.1** **D3 Teknik Doğrulama (Spike):** PDFium nesne düzeyinde kaldırma + kısmi glif yeniden yazımı VE `lopdf` tabanlı Rust içerik akışı yeniden yazıcı; her redaksiyon sonrası `FPDFText_*` ile metnin sıfır kaldığını kanıtlayan otomatik assertion testleri
- [ ] **F3.2** `gp-pdf-pdfium`: `PdfBackend` uygulaması (karo/thumbnail raster, metin/span, arama, outline, bağlantılar, nesne çıkarımı, metin/görsel/yol ekleme + font gömme, sayfa içe aktarma/silme/döndürme, `FPDF_SaveAsCopy`)
- [ ] **F3.3** `gp-engine`: Session cephesi (tek PDFium thread'i + öncelik kuyruğu/iptal, sayfa LRU, `trim()`, ilerleme/iptal destekli derleme)
- [ ] **F3.4** Web sürümünün tamamen `core/bindings/wasm` + PDFium'a geçirilmesi; `mupdf`, `pdfjs-dist`, `pdf-lib`, `@pdf-lib/fontkit` bağımlılıklarının tamamen sökülmesi (AGPL bağımlılığı = 0) ve regresyon doğrulaması

---

## Faz F4 — Web Üretim Optimizasyonu & Cloudflare Pages

- [ ] **F4.1** `public/_headers` (Cloudflare Pages önbellek başlıkları), belgede güvenli SW güncelleme toast'ı, `file_handlers` + `launchQueue`, `share_target`, File System Access API entegrasyonu
- [ ] **F4.2** Bellek sızıntısı ve referans doküman seti görsel/performans regresyon kapısı

---

## Faz M0 – M4 — Flutter Mobil Uygulama & OS "Birlikte Aç" Entegrasyonu

- [ ] **M0.1** `design-tokens/` tek kaynak üretici (CSS `--gp-*` + Dart `ThemeExtension` + ortak EN/TR sözlük üretimi)
- [ ] **M0.2** `mobile/` Flutter projesinin kurulması (Android API 26+, iOS 16+, tablet çoklu pencere, MuPDF YOK) + `core/bindings/frb` (`flutter_rust_bridge` v2) ve PDFium yerel ikili/köprü entegrasyonu
- [ ] **M0.3** M0 Teknik Prototip: `Session` köprüsü, 256×256 `TileCache` (`ui.Image` + bayt bütçeli LRU + bellek uyarısı `trim()`), `PdfViewport` `CustomPainter`, `GestureArena` (pinch/pan/atalet) ve testler
- [ ] **M1.1** **OS "Birlikte Aç" / Varsayılan PDF Açıcı Entegrasyonu:**
  - Android: `AndroidManifest.xml` (`ACTION_VIEW`, `ACTION_SEND`, `ACTION_SEND_MULTIPLE`, `content://` + `file://`, depolama izni yok) + `FileBridgePlugin.kt` (64 KB akış kopyalama, `OpenableColumns`, `onNewIntent`, `FLAG_GRANT_WRITE_URI_PERMISSION`, `ACTION_CREATE_DOCUMENT`, `FileProvider` paylaşım)
  - iOS: `Info.plist` (`CFBundleDocumentTypes` `com.adobe.pdf` Alternate/Editor, `LSSupportsOpeningDocumentsInPlace`, `UIFileSharingEnabled`) + `SceneDelegate.swift` + `FileBridge.swift` (`openURLContexts`, `startAccessingSecurityScopedResource`, `NSFileCoordinator`, `bookmarkData`, `replaceItemAt`)
  - Dart `FileBridge` + `OpenRequest` → doğrudan Viewer modunda açılış
- [ ] **M1.2** Flutter Viewer UI (Kompakt Telefon, Orta/Geniş Tablet, Katlanabilir duruş & Split View, Açık/Koyu/Sepya temalar, akışlı arama, İçindekiler/Thumbnail sheet, Farklı Kaydet/Paylaş/Yazdır, EN/TR)
- [ ] **M2.1** Flutter Editor Temel (Tek tuşla Viewer↔Editor geçişi, `EditableText` metin düzenleme, hayalet imza yerleştirme, kalem basınç/silgi çizimi, vurgulama, görsel ekleme, undo/redo, oturum otomatik kayıt/kurtarma, güvenli atomik geçici-dosya doğrulamalı Kaydet / Kopya kaydet)
- [ ] **M3.1** Flutter Editor İleri + iOS Share Extension (Şekil/yol, kırpma/maske, sayfa düzenleme/birleştirme/bölme, donanım klavye kısayolları, Flutter motoru yüklemeyen yerel `ios/ShareExtension` + App Group el sıkışması)
- [ ] **M4.1** Mobil Sertleştirme & Doğrulama (`flutter analyze`, `flutter test`, Android derleme/manifest kontrolü, erişilebilirlik `Semantics` ve sıfır-AGPL denetimi)
