# 04 — Mobil Uygulama Stratejisi ve İşletim Sistemi Entegrasyonu

> Kapsam: Native (Kotlin + Swift) ↔ Flutter kararı, uçtan uca mobil mimari, "Birlikte Aç" entegrasyonu, kaydetme akışları.
> **Kesinleşen kararlar:** Flutter (K5), motor PDFium (K2), Capacitor köprüsü yok (K6), varsayılan "kopya kaydet" (K7), Android 8.0 / iOS 16 + tablet ilk sürümde (K9). Tümü: [00](00_DECISION_LOG.md).
> Durum: **Sadece planlama.** Çekirdek mimari için [01](01_SYSTEM_AUDIT_AND_CORE_ARCHITECTURE.md), UX için [02](02_VIEWER_AND_EDITOR_DUAL_MODE_UX.md) ve [03](03_MOBILE_FIRST_WEB_AND_TOUCH_ENGINE.md).

---

## 1. Kararın Dayandığı Gerçekler

1. **Hazır bir Rust çekirdeği yok** (01 §0). Bugünkü motor TypeScript + MuPDF Wasm + pdf.js + pdf-lib; bunların hiçbiri mobil yerel koda doğrudan taşınmaz. Mobil uygulama, 01 §5'te tanımlanan **Rust çekirdeğinin (F2–F3) yazılmasına bağımlıdır.** Bu maliyet iki seçenek için de aynıdır. Hedef motor **PDFium**'dur (K2); Android ve iOS için hazır derlemeleri vardır ve izin verici lisanslıdır.
2. Uygulamanın arayüzü **platform bileşeni ağırlıklı değil, özel çizim ağırlıklıdır:** karo tabanlı kâğıt, seçim/tutamaç overlay'i, düğüm editörü, kırpma/maske, imza çizimi, özel jest hakemi. Bu yüzeylerin hiçbiri hazır `UIKit`/`Compose` bileşeni değildir; her platformda sıfırdan yazılır.
3. Web arayüzü (React) yaşamaya devam edecek. Yani UI kod tabanı sayısı: **Flutter ile 2** (React + Flutter), **Native ile 3** (React + Compose + SwiftUI).
4. Commit geçmişi tek geliştiriciye işaret ediyor; bakım kapasitesi kararın birincil kısıtıdır.

---

## 2. Karşılaştırma

| Kriter | Native (Kotlin/Compose + Swift/SwiftUI) | Flutter (Dart + `flutter_rust_bridge`) |
|---|---|---|
| **Ham render performansı** | Mükemmel. Karolar `Bitmap`/`CGImage`/Metal ile. | Mükemmele çok yakın. Impeller (iOS varsayılan, Android varsayılan) ile 60/120 fps; karolar `ui.Image` olarak `CustomPainter`'da. Ağır iş (raster) iki durumda da **Rust thread'lerinde** — fark yaratan kısım UI çerçevesi değil. |
| **Rust çekirdek köprüsü** | UniFFI ile Kotlin + Swift bağlamaları (iki ayrı bağlama yüzeyi, iki ayrı async/iptal modeli, iki paketleme: AAR + XCFramework). | `flutter_rust_bridge` v2: tek bağlama; `async`, `Stream` (ilerleme, arama sonuçları), sıfır kopya bayt aktarımı hazır. Paketleme `cargokit`/yerel varlıklar ile otomatik. |
| **Özel canvas + jest motoru** | İki kez yazılır (Compose `pointerInput` + UIKit `UIGestureRecognizer`); davranış eşitliği elle sağlanır. | **Bir kez** yazılır; 03'teki arena tasarımı Flutter'ın `GestureArena` modeliyle bire bir örtüşür. Piksel düzeyinde aynı davranış iki platformda. |
| **Geliştirme hızı** | Her özellik ×2; iki dil, iki UI paradigması, iki test paketi. | Tek kod tabanı; hot reload; tek widget/golden test paketi. |
| **Bakım maliyeti** | Yüksek: 3 UI kod tabanında özellik eşitliği (web + 2 mobil). | Orta: 2 UI kod tabanı. Flutter/Impeller sürüm yükseltmeleri ek risk kalemi. |
| **OS entegrasyonu** | En iyi; tüm API'ler birinci sınıf. | İyi. Gerekenler (intent-filter, belge türleri, security-scoped erişim, Share Extension) **ince yerel şim** ile yapılır: Android ~200 satır Kotlin, iOS ~300 satır Swift + extension hedefi. Manifest/plist ayarları zaten koddan bağımsız. |
| **Platforma özgü his** | Doğal (sistem metin seçimi, menüler, tipografi). | Material/Cupertino widget'ları + uyarlamalı tasarım; PDF üzerindeki metin seçimi her iki yaklaşımda da **özel** yazılmak zorunda (içerik özel çizim). |
| **Sistem PDF bileşenlerinden yararlanma** | PDFKit (iOS) / `PdfRenderer` (Android) ile hızlı viewer mümkün — ancak editör çekirdeğiyle **farklı motor** → görüntü tutarsızlığı (01 A1'in mobil tekrarı). Kullanılmaması gerekir. | Kullanılmaz; tek motor. |
| **Uygulama boyutu** | Çekirdek + ince UI (~15–20 MB). | + Flutter motoru (~5–8 MB). Kabul edilebilir. |
| **Tablet / katlanabilir / masaüstü** | Ayrı çalışma. | Aynı kod; ileride Windows/macOS masaüstü hedefi de açılır. |
| **Riskler** | Kapasite: tek geliştiriciyle iki yerel editör UI'ı gerçekçi değil. | iOS Share Extension Flutter dışı (yerel) yazılır; platform kanalı hataları; çok büyük karo akışında Dart↔Rust kopya maliyeti (çözüm: §4.4). |

---

## 3. KARAR: **Flutter + Rust çekirdek (`flutter_rust_bridge`)**

**Bu proje için doğru yaklaşım Flutter'dır.** Gerekçe:

1. **Maliyetin büyük kısmı zaten "özel çizim + özel jest".** Native'in en güçlü olduğu alan (hazır platform bileşenleri) bu uygulamada az kullanılır; en pahalı kısım (editör yüzeyi) Native'de iki kez, Flutter'da bir kez yazılır.
2. **Performans darboğazı UI çerçevesi değil, motor.** Karo rasteri, metin analizi, arama ve derleme Rust'ta ve arka plan thread'lerinde çalışır. UI'ın işi hazır bitmap'leri transform etmek ve overlay çizmektir; Impeller bunu 60/120 fps'te yapar. Native'in buradaki ölçülebilir üstünlüğü, iki kat UI maliyetini karşılamaz.
3. **Tek köprü yüzeyi.** `flutter_rust_bridge`, 01 §5.3'teki Session API'sini (async, akış, iptal, sıfır kopya) tek seferde bağlar. UniFFI ile aynı API iki dile, iki eşzamanlılık modeline uyarlanır.
4. **Davranış eşitliği.** 03'teki jest motoru (slop değerleri, hakemlik, atalet eğrisi) tek uygulama olduğu için Android ve iOS'ta aynıdır; QA matrisi yarıya iner.
5. **OS entegrasyonu Flutter'ı engellemez.** "Birlikte Aç" için gerekenlerin çoğu **bildirimsel** (manifest/plist); kalan kısım küçük, kararlı, seyrek değişen yerel koddur (§5).
6. **Kapasite gerçeği.** Tek geliştirici + yaşayan web arayüzü varken üçüncü ve dördüncü UI kod tabanı sürdürülemez.

**Flutter'ın kapsamı yalnızca mobil (ve ileride masaüstü) kabuktur. Web arayüzü React olarak kalır;** Flutter Web'e geçilmez (metin erişilebilirliği, ilk yük boyutu ve mevcut yatırım nedeniyle). İki UI, aynı Rust çekirdeğini ve aynı tasarım token'larını paylaşır.

**Kararın geri alınma koşulu:** F4 başındaki prototipte (§7, M0) orta sınıf Android'de karo akışı + pinch p95 kare süresi 16,7 ms'yi tutturamazsa, render yüzeyi yerel `Texture` (dış doku) katmanına alınır; bu da yetmezse yalnızca *viewport* yerel görünüm (PlatformView) olur. Tamamen Native'e dönüş öngörülmez.

> Not — kapsam dışı bırakılan üçüncü yol: Mevcut web uygulamasını Capacitor/WebView ile sarmak, çekirdek TypeScript olduğu için en hızlı mağaza girişidir; ancak WebView bellek tavanı, jest hassasiyeti ve 01'deki darboğazları aynen taşır, "enterprise seviye yerel deneyim" hedefini karşılamaz. **Karar (K6): kullanılmayacak;** yerel uygulama çıkana kadar mobil kullanıcılar PWA ile karşılanır (03 §6).

---

## 4. Flutter Uçtan Uca Mimari

### 4.1 Depo Yerleşimi

```
pdfEditor/
  core/                  # Rust workspace (01 §5.2) — web ve mobil ortak
    bindings/frb/        # flutter_rust_bridge API katmanı (ince; iş mantığı yok)
  web/ (mevcut src/)     # React arayüzü
  mobile/
    lib/
      app/               # yönlendirme, tema (token'lardan üretilen ThemeExtension), l10n
      features/
        library/         # son açılanlar, dosya seçici
        viewer/          # ViewerScreen, arama, outline, thumbnail sheet
        editor/          # EditorScreen, araç şeridi, bağlamsal şerit, denetçi sheet
      viewport/          # PdfViewport (karo boyama, sanallaştırma), ViewportController
      gestures/          # GestureArena tanıyıcıları (03 §5)
      engine/            # Dart cephesi: Session, TileCache, zamanlayıcı
      platform/          # FileBridge (MethodChannel/EventChannel sarmalayıcı)
    android/             # MainActivity + FileBridgePlugin.kt, AndroidManifest
    ios/                 # Runner (SceneDelegate, FileBridge.swift), ShareExtension hedefi
  design-tokens/         # tek kaynak → CSS değişkenleri + Dart sabitleri üretilir
```

### 4.2 Katmanlar ve Sorumluluklar

| Katman | Teknoloji | Sorumluluk |
|---|---|---|
| Sunum | Flutter widget'ları, Material 3 + uyarlamalı (Cupertino davranışları: geri kaydırma, sheet fiziği) | Ekranlar, sheet'ler, araç şeritleri. İş mantığı yok. |
| Görünüm durumu | Riverpod | Mod (view/edit), zoom, tema, seçim aynası, sheet durumu. Doküman modeli **tutulmaz**; çekirdekten yama olarak yansıtılır. |
| Viewport | `CustomPainter` + `Ticker` | Karo/önizleme boyama, overlay çizimi, transform. Jest sırasında widget rebuild yok (yalnızca `repaint` bildirimi). |
| Jest | `Listener` + özel tanıyıcılar (Flutter `GestureArena` üzerinde) | 03 §5'teki hakemlik, atalet, pinch. |
| Motor cephesi | Dart | `Session` sarmalayıcı, öncelikli/iptal edilebilir karo kuyruğu, bayt bütçeli `TileCache`, bellek uyarısı işleme. |
| Köprü | `flutter_rust_bridge` v2 | Async çağrılar, `Stream` (ilerleme/arama), sıfır kopya tamponlar. |
| Çekirdek | Rust (`gp-engine`) | Tek doğruluk kaynağı: doküman, komutlar, undo, hit-test, raster, arama, derleme. |
| Platform | Kotlin / Swift (ince) | Dosya açma niyetleri, URI/security-scoped erişim, kaydet/paylaş, bellek uyarıları. |

### 4.3 Thread Modeli
- **UI isolate:** yalnızca boyama ve jest. Hiçbir PDF işi yok.
- **Rust iş parçacıkları** (çekirdek içinde): PDFium thread-güvenli olmadığı için **tek "PDFium thread'i"** tüm motor çağrılarını (raster, metin, arama, analiz, kaydetme) öncelik kuyruğundan sırayla yürütür. Ayrıca PDFium'a dokunmayan işler için küçük bir yardımcı havuz: karo piksel dönüşümü (BGRA→RGBA, premultiply), saf Rust hit-test/geometri, oturum serileştirme.
- Kuyruk önceliği: görünür karo → hit-test/komut → önizleme → thumbnail → arama/analiz. Uzun işler (arama, derleme) **dilimlenir** (sayfa başına bir iş) ki araya görünür karo girebilsin; dışa aktarım sırasında bile kaydırma keskinleşmeye devam eder.
- `flutter_rust_bridge` çağrıları Dart tarafında `Future`/`Stream`; **senkron** çağrı yalnızca mikrosaniyelik saf işlemlerde (ör. koordinat dönüşümü) kullanılır. Hit-test `pointerdown`'da senkron olabilir (hedef < 1 ms; ölçümle doğrulanır).
- İptal: her karo/derleme isteği bir belirteç taşır; viewport'tan çıkan veya ölçeği eskiyen istekler Rust tarafında başlamadan düşürülür.
- Belge yerel dosyadan açılır (bellek haritalı/akış okuma) → mobilde belge baytlarının RAM'de ikinci kopyası olmaz. Yüklü sayfa nesneleri küçük bir LRU'da (≈ 6–8 sayfa) tutulur.
- M0 prototipi tek thread'li rasterin 256 px karolarla hedef kare süresini tuttuğunu doğrular; tutmazsa önlem: daha düşük ölçekli ara karo + ilerlemeli keskinleştirme (paralel PDFium seçenek değildir).

### 4.4 Yüksek Performanslı PDF/Canvas Katmanı
- **Karo yolu (varsayılan):** Rust, karoyu premultiplied RGBA tampon olarak üretir → sıfır kopya ile Dart'a → `ui.ImmutableBuffer` + `ImageDescriptor.raw` → `ui.Image` → `canvas.drawImageRect`. Karo 256×256 mantıksal px (mobilde daha küçük karo, daha hızlı ilk boyama); ölçek kovaları 01 §6.2 ile aynı.
- **Üç katmanlı gösterim** (iskelet → önizleme → keskin karo) ve öncelik sırası web ile aynı tasarım (01 §6).
- **Pinch:** jest boyunca mevcut `ui.Image`'ler `canvas.transform` ile ölçeklenir; bırakınca yeni kova karoları gelir, çapraz solma ile değişir.
- **Overlay'ler** (elemanlar, tutamaçlar, kılavuzlar, arama vurguları, metin seçimi) ayrı `CustomPainter` katmanlarında, kendi `RepaintBoundary`'lerinde → eleman sürüklemek karo katmanını yeniden boyatmaz.
- **Düzenleme sırasında eleman önizlemesi:** Metin elemanları Flutter `Paragraph` ile, çekirdekten gelen font baytları ve ölçümlerle çizilir; "Önizle" ve dışa aktarım çekirdek rasteriyle doğrulanır (02 §4.4).
- **Bellek:** `TileCache` bayt bütçeli LRU (varsayılan 96–160 MB, cihaz RAM'ine göre); `ui.Image.dispose()` zorunlu. `didHaveMemoryPressure` / `onTrimMemory` → çekirdek `trim()` + önbellek boşaltma.
- **Yedek yol (ölçüm gerektirirse):** Rust'ın doğrudan GPU dokusuna yazdığı dış `Texture` (Android `SurfaceTexture`/`HardwareBuffer`, iOS `CVPixelBuffer`) — yalnızca M0 prototipi yetersiz kalırsa.

### 4.5 Metin Girişi ve Seçimi
- Yerinde metin düzenleme: görünmez/hizalı `EditableText` + çekirdek ölçümleriyle çizim; IME, otomatik düzeltme, Türkçe klavye ve donanım klavyesi desteği Flutter metin girişinden gelir.
- PDF metin seçimi: çekirdek span geometrisi üzerine özel tutamaçlar + büyüteç (`RawMagnifier`); sistem bağlam menüsü (`AdaptiveTextSelectionToolbar`) ile *Kopyala · Vurgula · Ara · Paylaş*.

### 4.6 Erişilebilirlik ve Yerelleştirme
- Viewport için `SemanticsNode` ağacı: sayfa başına okunabilir metin (TalkBack/VoiceOver), sayfa gezinme eylemleri.
- `flutter_localizations` + ARB; web ile **ortak çeviri anahtarları** (tek sözlük kaynağından üretim). Varsayılan dil **İngilizce**, **Türkçe** seçilebilir; cihaz dili Türkçe ise ilk açılışta Türkçe (K8). Uygulama adı **gullacpdf**. Dinamik yazı boyutu desteklenir (kâğıt içeriği hariç).

### 4.7 Derleme ve Dağıtım
- Rust hedefleri: Android `arm64-v8a`, `armeabi-v7a`, `x86_64` (emülatör) — `cargo-ndk`; iOS `aarch64-apple-ios`, `aarch64-apple-ios-sim` — statik kütüphane/XCFramework. Derleme, Flutter derlemesine entegre (cargokit).
- CI: çekirdek birim/eşdeğerlik testleri → Flutter widget + golden testleri → cihaz çiftliğinde entegrasyon (jest ve performans izleri) → imzalı AAB / IPA. Android 15+ için 16 KB sayfa boyutu uyumu doğrulanır.
- **Minimum sürümler (K9, kesin): Android 8.0 (API 26), iOS / iPadOS 16.** Gerekçe: Android 8.0 güncel cihazların ezici çoğunluğunu kapsar ve SAF/Scoped Storage davranışı tutarlıdır; iOS 16, `UTType`, modern belge seçici ve sheet kademelerinin (detent) tamamını sağlar. Hedef SDK her zaman mağazanın güncel zorunlu düzeyi.
- **Tablet ilk sürüme dahildir (K9):** 03 §2.2'deki üç yerleşim sınıfı (kompakt / orta / geniş) baştan uygulanır; iPad'de çoklu pencere (Split View / Slide Over) ve Android'de çoklu pencere + katlanabilir duruş değişimi desteklenir, yön kilidi yoktur. Kalem (Apple Pencil / S Pen) girdisi çizim ve imzada basınç duyarlı çalışır (03 §5.8). Donanım klavyesi kısayolları tablet için etkin.
- PDFium ikilileri: Android `arm64-v8a` / `armeabi-v7a` / `x86_64` paylaşımlı kütüphaneleri ve iOS XCFramework, sürümü sabitlenmiş hazır derlemelerden; sağlama toplamı (checksum) CI'da doğrulanır.
- Kilitlenme/performans telemetrisi: varsayılan **kapalı**, kurumsal sürümde tamamen çıkarılabilir (gizlilik vaadiyle uyum); belge içeriği hiçbir koşulda cihaz dışına çıkmaz.

---

## 5. "Birlikte Aç" / Varsayılan PDF Uygulaması Entegrasyonu

Ortak akış: **OS → yerel şim → `FileBridge` → Dart `OpenRequest` → çalışma kopyası → Viewer modu.** Her durumda belge **Viewer modunda** açılır; "Düzenle" tek dokunuş uzaktadır (02 §4).

```
OpenRequest { kaynakKimliği, görünenAd, boyut?, yazılabilirMi, köken: view|send|picker|share }
   └▶ Akış halinde uygulama özel dizinine kopya (çalışma kopyası) → core.open(path)
        └▶ İlk sayfa iskeleti hemen, karolar ardından
```

Çalışma kopyası zorunludur: gelen erişim izni geçicidir, kaynak başka süreçte değişebilir ve bellek haritalı (mmap) açılış için yerel dosya gerekir. Kopya **akış halinde** yapılır (tüm dosya RAM'e alınmaz).

### 5.1 Android

**`AndroidManifest.xml` (MainActivity) — tanımlanacak filtreler:**

| Amaç | action | category | data |
|---|---|---|---|
| Dosya yöneticisi, e-posta eki, WhatsApp, tarayıcı indirmesi | `ACTION_VIEW` | `DEFAULT`, `BROWSABLE` | `mimeType="application/pdf"`, `scheme="content"` ve `scheme="file"` |
| MIME'ı yanlış bildiren kaynaklar (`application/octet-stream`) | `ACTION_VIEW` | `DEFAULT` | `scheme="content"`, `mimeType="*/*"`, `pathPattern=".*\\.pdf"` (ayrı filtre; aşırı geniş eşleşmeyi sınırlamak için) |
| "Paylaş → uygulama" | `ACTION_SEND` | `DEFAULT` | `mimeType="application/pdf"` |
| Çoklu paylaşım (birleştirme akışı) | `ACTION_SEND_MULTIPLE` | `DEFAULT` | `mimeType="application/pdf"` |

- Activity: `exported="true"`, `launchMode="singleTask"` (veya `singleTop`); çalışırken gelen dosyalar için `onNewIntent` işlenir. Açık ve kaydedilmemiş belge varsa önce 02 §4.4 diyaloğu.
- Kullanıcı "Her zaman" seçerse uygulama **varsayılan PDF açıcı** olur; ayrıca ayarlarda "Varsayılan yap" rehberi (sistem "Varsayılan olarak aç" ekranına yönlendirme).

**URI ve akış okuma:**
- `ACTION_VIEW` → `intent.data`; `ACTION_SEND` → `EXTRA_STREAM`. Tümü `content://` kabul edilir; `file://` yalnızca eski kaynaklar için.
- Okuma: `ContentResolver.openInputStream(uri)` (veya `openFileDescriptor(uri, "r")`), **arka plan thread'inde**, 64 KB tamponla uygulama `cacheDir/work/` altına. Ad ve boyut: `OpenableColumns.DISPLAY_NAME / SIZE` sorgusu.
- **Depolama izni istenmez.** `READ/WRITE_EXTERNAL_STORAGE`, `MANAGE_EXTERNAL_STORAGE` kullanılmaz; tüm erişim URI izinleri ve Storage Access Framework (SAF) ile (Scoped Storage uyumlu, Play politikası riski yok).
- **İzin ömrü:** `ACTION_VIEW/SEND` ile gelen izin geçicidir (alıcı görev yaşadığı sürece) ve genellikle **salt okunur**; kalıcılaştırılamaz. Yalnızca uygulama içi seçiciden (`ACTION_OPEN_DOCUMENT`) gelen URI'lerde `takePersistableUriPermission` çağrılır → "Son açılanlar" ve yerinde kaydetme bunlarla çalışır.
- **Yazılabilirlik tespiti:** `intent.flags & FLAG_GRANT_WRITE_URI_PERMISSION` + `DocumentsContract` `FLAG_SUPPORTS_WRITE` denetimi → `OpenRequest.yazılabilirMi`.
- Büyük dosya/bozuk akış/iptal: ilerleme göstergesi, iptal edilebilir kopyalama, anlamlı hata iletileri.
- Güvenlik: gelen URI yalnızca okunur; `file://` yolları uygulama özel dizinlerine işaret ediyorsa reddedilir (yol geçişi/intent yönlendirme koruması); görünen ad temizlenir.

**Flutter köprüsü:** `FileBridgePlugin.kt` — `MethodChannel` (`getInitialOpenRequest`, `copyToWorkFile`, `saveToUri`, `createDocument`, `share`) + `EventChannel` (çalışırken gelen niyetler, kopyalama ilerlemesi). Üçüncü taraf "sharing intent" paketleri yerine ince, sahiplenilen eklenti (bağımlılık ve bakım riski düşük).

### 5.2 iOS

**`Info.plist`:**

| Anahtar | Değer | Amaç |
|---|---|---|
| `CFBundleDocumentTypes` | `CFBundleTypeName: "PDF"`, `LSItemContentTypes: ["com.adobe.pdf"]`, `CFBundleTypeRole: Editor`, `LSHandlerRank: Alternate` | Dosyalar, Mail, WhatsApp vb. uygulamalarda "Birlikte Aç / Şurada aç" listesinde görünme |
| `LSSupportsOpeningDocumentsInPlace` | `YES` | Dosyayı kopyalamadan **yerinde** açma → özgün dosyanın üzerine kaydedebilme |
| `UIFileSharingEnabled` | `YES` | Uygulamanın Belgeler klasörünün Dosyalar'da görünmesi |
| `UISupportsDocumentBrowser` | `NO` (özel kütüphane ekranı kullanılacak) | — |

- **`UTImportedTypeDeclarations` hakkında düzeltme:** `com.adobe.pdf` **sistem tarafından tanımlı** bir UTI'dir; uygulamanın bunu yeniden içe aktarması gerekmez ve önerilmez. İçe aktarma bildirimi yalnızca sistemin tanımadığı türler içindir. İleride uygulamaya özgü bir **proje/oturum dosyası** (ör. `.gpdfproj`) eklenirse bunun için `UTExportedTypeDeclarations` kullanılır.
- `LSHandlerRank: Alternate` seçilir (`Owner` değil): uygulama PDF biçiminin sahibi değildir; liste görünürlüğü için yeterlidir.
- **iOS'ta sistem genelinde "varsayılan PDF uygulaması" ayarı yoktur.** Elde edilebilecek olan: paylaşım sayfası ve "Birlikte Aç" listesinde yer almak, uzun basma menüsünde görünmek. Bu beklenti ürün iletişiminde doğru kurulmalıdır.

**Açılış ve Security-Scoped erişim:**
- Giriş noktası: `scene(_:openURLContexts:)` (soğuk açılışta `scene(_:willConnectTo:options:)` içindeki `urlContexts`). `UIOpenURLContext.options.openInPlace` → yerinde mi, gelen kutusuna kopya mı (`Documents/Inbox`) anlaşılır.
- Yerinde açılan URL'lerde: `url.startAccessingSecurityScopedResource()` → **`NSFileCoordinator`** ile koordineli okuma → uygulama kapsayıcısına akış halinde çalışma kopyası → `stopAccessingSecurityScopedResource()` (`defer` ile, her yolda).
- Kalıcı erişim (Son açılanlar + üzerine kaydet): `url.bookmarkData(...)` ile **yer imi** saklanır; yeniden açarken çözülür, bayatsa (`isStale`) yenilenir, çözülemezse kullanıcıdan dosyayı yeniden seçmesi istenir.
- Yerinde kaydetme: yer iminden URL → security scope → `NSFileCoordinator` yazma koordinasyonu → **atomik değiştirme** (`replaceItemAt`). iCloud/üçüncü taraf sağlayıcılarda çakışma ve "dosya henüz indirilmedi" durumları ele alınır.
- Uygulama içi seçici: `UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: false)`.
- `Inbox`'a kopyalanan dosyalar işlendikten sonra temizlenir.

**Share Extension mimarisi:**
- Ayrı hedef (yerel Swift, **Flutter motoru yüklenmez** — uzantı bellek sınırı ~120 MB). Etkinleştirme kuralı: yalnızca `com.adobe.pdf` (ve PDF dosya URL'leri), en fazla N öğe.
- İşleyiş: `NSItemProvider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier)` → dosya **App Group** paylaşımlı kapsayıcısına (`group.<bundle>`) kopyalanır + küçük bir "bekleyen içe aktarma" kaydı yazılır → uzantı kapanır.
- Ana uygulama öne geldiğinde bekleyen kayıtları okur ve en yenisini Viewer'da açar.
- **Sınırlama (dürüst not):** Paylaşım uzantılarının kapsayıcı uygulamayı doğrudan açması Apple tarafından resmî olarak desteklenmez; yaygın geçici çözümler App Review riski taşır. Bu yüzden uzantının sözleşmesi "**uygulamaya kaydet**"tir (onay ekranında "gullacpdf'te aç" bağlantısı gösterilir). **Doğrudan açma senaryosunu asıl karşılayan mekanizma `CFBundleDocumentTypes`'tır** ("Birlikte Aç" → uygulama anında Viewer'da açılır). Share Extension bu nedenle ikinci öncelikli kalemdir (M3).

**Flutter köprüsü:** `FileBridge.swift` — Android ile **aynı kanal sözleşmesi**; Dart tarafı platform farkını görmez.

### 5.3 Açılış Deneyimi Hedefleri
- Soğuk açılış → ilk sayfa: < 1,2 sn (10 MB belge, orta sınıf cihaz); sıcak: < 500 ms.
- Açılışta açılış ekranından doğrudan Viewer'a (kütüphane ekranı araya girmez).
- Şifreli belge: Viewer iskeleti üzerinde parola sheet'i; yanlış parolada satır içi hata.
- Bozuk/desteklenmeyen dosya: anlaşılır hata + "Başka uygulamayla aç" seçeneği.

---

## 6. Çevrimdışı Çalışma ve Kaydetme Akışları

### 6.1 Offline-First
- Uygulama **hiçbir ağ çağrısı olmadan** tam işlevlidir: motor, fontlar, tüm araçlar pakete gömülü. Ağ izni yalnızca isteğe bağlı güncelleme/telemetri içindir; kurumsal sürümde tamamen kaldırılabilir (Android'de `INTERNET` izni olmadan derleme varyantı).
- **Oturum kurtarma:** Çekirdek `serialize_session()` çıktısı (komut günlüğü + eklenen varlıklar) her değişiklikten 2 sn sonra ve arka plana geçerken uygulama özel dizinine yazılır. Çökme/sonlandırma sonrası açılışta "Kaldığın yerden devam et".
- **Son açılanlar:** Kalıcı URI izni / yer imi + küçük önizleme + son konum (sayfa, zoom). Erişimi düşen kayıtlar "yeniden bağla" ister.
- Çalışma kopyaları ve önbellek için kota ve yaşlandırma (ör. 30 gün / 1 GB); "Önbelleği temizle" ayarı.
- Web (PWA) tarafı eşdeğeri: 03 §6.

### 6.2 Kaydetme Semantiği

| Eylem | Davranış | Android | iOS |
|---|---|---|---|
| **Kaydet** | Kaynak yazılabilirse özgün dosyanın **üzerine**; değilse otomatik olarak "Farklı kaydet"e düşer | `openOutputStream(uri, "wt")` / `openFileDescriptor(uri, "rwt")`; önce geçici dosyaya derle, doğrula, sonra yaz | Yer imi → security scope → `NSFileCoordinator` + atomik değiştirme |
| **Farklı kaydet / Kopya** | Kullanıcı konum ve ad seçer; varsayılan ad `<ad>-düzenlendi.pdf` | `ACTION_CREATE_DOCUMENT` | `UIDocumentPickerViewController(forExporting:)` |
| **Paylaş** | Derlenmiş PDF'i başka uygulamaya gönderir; kaynak dosya değişmez | `FileProvider` URI + `ACTION_SEND` (geçici okuma izni) | `UIActivityViewController` (dosya URL'si) |
| **Yazdır** | Sistem yazdırma | `PrintManager` | `UIPrintInteractionController` |

Kurallar:
1. **Veri kaybına karşı güvenli yazma:** Her kaydetme önce uygulama dizininde geçici dosyaya derlenir, yeniden açılıp doğrulanır (sayfa sayısı, açılabilirlik), ancak sonra hedefe yazılır. Hedefe yazma yarıda kalırsa özgün içerik geçici yedekten geri yüklenir.
2. **Varsayılan: kopya (K7, kesin).** Kaydet düğmesinin birincil eylemi **"Kopya olarak kaydet"**tir. "Özgün dosyanın üzerine yaz" ikincil seçenektir; ilk kullanımda "Özgün dosyanın üzerine yazılacak, bu işlem geri alınamaz" onayı + "Bir daha sorma" kutusu gösterilir. Kullanıcı kutuyu işaretlerse sonraki üzerine yazmalar onaysızdır; tercih ayarlardan sıfırlanabilir. Bu kural web (File System Access) için de aynıdır.
3. **Kaynak salt okunursa** (WhatsApp/e-posta eki gibi geçici, salt okunur URI'ler) "Kaydet" doğrudan "Farklı kaydet" akışını açar; kullanıcıya nedeni tek satırla açıklanır.
4. **Dış değişiklik tespiti:** Kaydetmeden önce kaynak dosyanın boyut/değişiklik zamanı açılıştakiyle karşılaştırılır; farklıysa "Üzerine yaz / Kopya kaydet" sorulur.
5. **Derleme seçenekleri** (Farklı kaydet sheet'inde, aşamalı): redaksiyonları kalıcı uygula (varsayılan açık), sayfa aralığı. **İlk sürümde yok:** parola ile koruma ve ileri optimizasyon — PDFium şifreli yazamaz; sonraki faz adayı `qpdf` (00 → D4).
6. Uzun derlemede iptal edilebilir ilerleme; uygulama arka plana alınırsa Android'de kısa süreli ön plan görevi, iOS'ta `beginBackgroundTask` ile tamamlanır.
7. Kaydedilmemiş değişiklikle çıkış: *Kaydet · Kopya kaydet · Vazgeç* (02 §4.4).

---

## 7. Mobil Uygulama Fazları (F4'ün kırılımı)

Ön koşul: M0–M1 (Viewer) için 01'deki **F1 + F2**; M2 ve sonrası (Editor) için **F3**. Aşağıdaki kilometre taşları göreli sıradır; süre tahmini çekirdek olgunlaştıktan sonra M0 ölçümleriyle verilir.

| Aşama | İçerik | Çıkış ölçütü |
|---|---|---|
| **M0 – Teknik prototip** | frb köprüsü + karo boyama + pinch/atalet; referans belgelerle ölçüm | Orta sınıf Android'de p95 kare ≤ 16,7 ms; bellek ≤ 300 MB (500 sayfa). **Flutter kararının doğrulama kapısı** |
| **M1 – Viewer + "Birlikte Aç"** | Viewer ekranı, arama, outline, thumbnail, temalar; Android intent-filter + iOS belge türleri; Paylaş/Farklı kaydet; **telefon + tablet yerleşimleri** | Dış uygulamadan PDF'e dokunup < 1,2 sn'de ilk sayfa; kapalı beta |
| **M2 – Editor temel** | Metin ekle/düzenle, imza, çizim, vurgu, görsel; undo/redo; oturum kurtarma; yerinde kaydet | Web editörüyle aynı referans belgelerde eşdeğer çıktı |
| **M3 – Editor ileri + entegrasyon** | Şekil/yol, kırpma/maske, sayfa düzenleme, birleştir/böl; iOS Share Extension; tablet çoklu pencere ve kalem ince ayarı | Özellik eşitliği tablosu tamam |
| **M4 – Sertleştirme** | Erişilebilirlik denetimi, düşük bellekli cihaz testleri, mağaza hazırlığı | Mağaza yayını |

## 8. Riskler ve Önlemler

| Risk | Etki | Önlem |
|---|---|---|
| Rust çekirdeğin gecikmesi | Mobil başlayamaz | F2'de saf crate'ler önce; M0 prototipi yalnızca render alt kümesiyle erken başlar |
| PDFium'da kısmi metin redaksiyonu (01 §5.5) | Editor'da özgün metin düzenleme gecikir | F3'ün ilk işi teknik doğrulama; yedek: Rust içerik akışı yeniden yazıcı. M0–M1 (Viewer) bundan etkilenmez |
| PDFium tek thread kısıtı | Ağır sayfalarda karo gecikmesi | Öncelik kuyruğu + dilimlenmiş uzun işler + ilerlemeli keskinleştirme; M0'da ölçüm |
| Geçiş döneminde AGPL (MuPDF henüz sökülmemişken) | Kapalı mağaza dağıtımı yapılamaz | Mobil uygulama **yalnızca PDFium** içerir; MuPDF hiçbir zaman mobil pakete girmez |
| Dart↔Rust karo kopya maliyeti | Kare düşmesi | Sıfır kopya tampon; küçük karo; gerekirse dış `Texture` yolu |
| iOS'ta yerinde kaydetme (iCloud/üçüncü taraf sağlayıcı) uç durumları | Veri kaybı algısı | Güvenli yazma protokolü (§6.2-1), varsayılan "kopya kaydet" |
| Share Extension'ın uygulamayı açamaması | Beklenti uyumsuzluğu | Sözleşme "uygulamaya kaydet"; asıl yol belge türleri |
| Flutter metin girişi + özel düzen uyumsuzluğu (font ölçümü) | Metin kayması | Ölçümler çekirdekten; "Önizle" çekirdek rasteriyle; golden testler |
| Web ile mobil arasında davranış sapması | Tutarsız ürün | İş mantığı yalnızca çekirdekte; ortak referans belge seti ve ortak senaryo listesi |
