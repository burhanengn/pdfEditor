# 01 — Sistem Denetimi ve Çekirdek Mimari

> Kapsam: Mevcut kod tabanının denetimi, ortak çekirdek (Core Engine) mimarisi, performans/bellek mimarisi.
> Durum: **Sadece planlama.** Bu dokümanda önerilen hiçbir değişiklik henüz uygulanmamıştır.
> **Kesinleşen kararlar:** Rust çekirdek yazılacak (K1), motor **PDFium** olacak (K2), tek motora inilecek (K3). Tüm kararlar: [00](00_DECISION_LOG.md).
> Denetlenen commit: `6515126` (main). İlgili dokümanlar: [02](02_VIEWER_AND_EDITOR_DUAL_MODE_UX.md), [03](03_MOBILE_FIRST_WEB_AND_TOUCH_ENGINE.md), [04](04_MOBILE_APP_STRATEGY_AND_OS_INTEGRATION.md).

---

## 0. Kritik Ön Bulgu: Repoda Rust Kodu Yok

Görev tanımı projeyi "Rust/Wasm çekirdekli" olarak tarif ediyor. Denetim sonucu:

- Repoda **hiç `Cargo.toml`, `.rs` dosyası veya Rust crate'i yok.**
- "Wasm" katmanı, npm'den gelen **`mupdf` paketidir** (Artifex MuPDF, **C** → Emscripten → Wasm, ~10,4 MB).
- İş mantığının tamamı (~9.500 satır `src/engine` + ~2.800 satır store) **TypeScript**'tir.
- PDF işleri **üç ayrı motor** arasında paylaşılmıştır:

| Motor | Lisans | Bugünkü görevi | Çalıştığı yer |
|---|---|---|---|
| `pdfjs-dist` | Apache-2.0 | Sayfa ve thumbnail rasterizasyonu, görsel/vektör/tablo çizgisi çıkarımı (`getOperatorList`) | Parse: pdf.js worker — **raster: ana thread** |
| `mupdf` (Wasm) | **AGPL-3.0** | Şifre çözme/inceleme, yapılandırılmış metin çıkarımı, içerik akışı redaksiyonu, "temiz sayfa" önizlemesi, son optimizasyon | `pdfWasm.worker.ts` (tek worker) |
| `pdf-lib` + `fontkit` | MIT | Dışa aktarımda eleman çizimi, font gömme, sayfa birleştirme/bölme, gömülü font çıkarımı | Worker (derleme) + **ana thread** (font çıkarımı) |

**Sonuç:** Mobil tarafta "hazır Rust çekirdeği yeniden kullanma" varsayımı bugün geçerli değil. Ortak çekirdek **önce inşa edilmelidir** (bkz. §5). Bu, 04 numaralı dokümandaki Native/Flutter kararını ve takvimi doğrudan etkiler. **K1 onaylandı:** çekirdek kademeli olarak yazılacak.

---

## 1. Mevcut Mimari Özeti

```
index.html → main.tsx → App.tsx
  ├─ TopToolbar (masaüstü+tablet araç çubuğu, 814 satır)
  ├─ ThumbnailSidebar (sanallaştırılmış)        ├─ MobileBottomDock + 4 sheet (md altı)
  ├─ DocumentViewport (react-virtual, pinch)    ├─ RightInspector (2.141 satır)
  │    └─ PageCanvas ×N (2.848 satır; canvas + tüm etkileşim + overlay'ler)
  └─ 6 modal + CanvasContextMenu

useEditorStore (Zustand, tek store, 2.839 satır)
  ├─ sourceDocs[id].bytes (PDF baytları store içinde)
  ├─ pages[], elements[], pageExtractions{}, past/future (60 snapshot)
  └─ tüm UI durumu (tool, zoom, sheet, modal, pinch...)

engine/
  ├─ documentController.ts  → aç / birleştir / dışa aktar / paylaş orkestrasyonu
  ├─ pdfjsService.ts        → render + görsel/şekil çıkarımı
  ├─ wasmWorkerClient.ts ⇄ workers/pdfWasm.worker.ts (RPC: inspect, extractPageText,
  │                          prepareCleanPage, compilePdf, splitPdfZip)
  ├─ pdfCompiler.ts         → MuPDF redaksiyon → pdf-lib çizim → MuPDF optimize
  ├─ textExtractor.ts, richText.ts, fonts.ts, embeddedFontExtractor.ts
  └─ coordinates.ts, vectorShapes.ts, imageMask.ts, pageRange.ts, pageNumbers.ts
```

Build: Vite 6 + `vite-plugin-pwa` (Workbox precache, 16 MB dosya limiti), GitHub Pages deploy. Test: 9 Vitest dosyası + 3 Playwright spec (masaüstü, mobil-PWA, kabul).

---

## 2. Dosya Bazlı Teknik Analiz

| Dosya | Satır | Rol | Değerlendirme |
|---|---|---|---|
| `components/viewport/PageCanvas.tsx` | 2.848 | Sayfa rasteri, çıkarım tetikleme, tüm araçların pointer mantığı, tüm eleman overlay'leri | **En büyük teknik borç.** ~50 ayrı store aboneliği; `elements` dizisinin tamamına abone → herhangi bir eleman değişince görünür tüm sayfalar yeniden render olur. Render, çıkarım, jest ve çizim tek bileşende. |
| `store/useEditorStore.ts` | 2.839 | Tek global store | Doküman modeli + UI durumu + geçici jest durumu (`isPinching`, `activeTouchCount`) aynı store'da. PDF baytları da burada. |
| `components/inspector/RightInspector.tsx` | 2.141 | Özellik paneli | Tüm eleman türleri tek dosyada; mobil sheet aynı bileşeni yeniden kullanıyor (iyi), ancak yoğunluk mobil için fazla. |
| `engine/pdfCompiler.ts` | 1.772 | Dışa aktarım boru hattı | Değerli, testli iş mantığı. Aynı PDF **en az 3 kez** parse edilir (pdf-lib `load` ×2 + MuPDF). İlerleme/iptal yok. |
| `engine/textExtractor.ts` | 1.412 | MuPDF satırlarından paragraf/tablo-hücresi bloğu kurma | Saf algoritma, testli → çekirdeğe taşınmaya çok uygun. |
| `engine/pdfjsService.ts` | 1.220 | Render + operatör listesi analizi | Her render'da geçici ikinci canvas (çift bellek). Karo yok; tam sayfa raster, 12,58 MP tavan, DPR ≤ 2. |
| `engine/coordinates.ts` | 912 | Koordinat dönüşümleri, döndürülmüş resize, akıllı hit-test, viewport metrikleri | Saf matematik, testli → çekirdeğe birebir taşınır. |
| `engine/fonts.ts`, `richText.ts`, `embeddedFontExtractor.ts` | 898 / 601 / 854 | Font eşleme, zengin metin, gömülü font çıkarımı | `embeddedFontExtractor` açılışta **ana thread'de** `PDFDocument.load` çağırır → büyük dosyada UI donar. |
| `components/viewport/DocumentViewport.tsx` | 756 | Sanal kaydırma + pinch | Pinch sırasında GPU transform, bırakınca tek commit: doğru yaklaşım. Hem Pointer hem Touch dinleyicileri (çift yol). |
| `workers/pdfWasm.worker.ts` | 157 | MuPDF RPC | Tek worker, sıralı. 6 dokümanlık LRU var; ancak **her çağrıda PDF baytları yeniden kopyalanır** (bkz. P2). |
| `components/mobile/*` | ~1.200 | Alt dock + 4 sheet | Çalışır; fakat masaüstü düzeninin üzerine eklenmiş katman (bkz. 03). `MobilePagesSheet` sanallaştırılmamış. |
| `store/history.ts` | — | Snapshot tabanlı undo (60 derinlik) | Her adımda tüm `elements` derin kopyalanır. |
| `utils/blobRegistry.ts` | — | Object URL takibi + GC | İyi tasarlanmış; korunmalı. |

---

## 3. Güçlü Yönler ve Yeniden Kullanılabilir Varlıklar

1. **Saf, testli algoritma modülleri:** `coordinates`, `textExtractor`, `vectorShapes`, `imageMask`, `richText`, `pageRange`, `snapGuides`, `signatureExtractor`. Bunlar DOM'a bağımlı değil; Rust'a port için **altın referans** ve testleri **eşdeğerlik (parity) testi** olarak kullanılabilir.
2. **Gerçek redaksiyon boru hattı:** Düzenlenen/silinen özgün metin ve görseller beyaz yama ile değil MuPDF içerik akışı redaksiyonu ile kaldırılıyor. Kurumsal açıdan (veri sızıntısı) çok değerli.
3. **Tipli worker RPC sözleşmesi** (`types/worker.ts`): Çekirdek API yüzeyinin taslağı zaten mevcut.
4. **Sıfır backend / tam istemci tarafı:** Gizlilik ve offline hikâyesi hazır.
5. **Sanal kaydırma + pinch commit modeli** ana viewport'ta mevcut; karo mimarisine evrilebilir.
6. **Test altyapısı:** Vitest + Playwright (mobil emülasyon dahil) regresyon ağı sağlar.
7. **PWA temeli:** Manifest, ikonlar, safe-area, `dvh`, Web Share kullanımı var.

---

## 4. Darboğaz ve Risk Raporu

Önem: 🔴 kritik · 🟠 yüksek · 🟡 orta.

### 4.1 Render ve Akıcılık
- **P1 🔴 Raster ana thread'de.** pdf.js sayfayı ana thread'de canvas'a çizer; ağır sayfalarda kaydırma/pinch sırasında kare düşer. Karo yok: her zoom değişiminde tüm sayfa yeniden rasterlenir (75 ms debounce).
- **P2 🔴 Worker çağrılarında bayt kopyası.** `wasmWorkerClient.call` transfer listesi kullanmıyor; `extractPageText` ve `prepareCleanPage` **her sayfa için tüm PDF baytlarını** structured-clone ile kopyalıyor. 50 MB / 200 sayfalık dosyada gezinmek GB'larca geçici kopya ve GC duraksaması demek.
- **P3 🔴 Görüntülemede gereksiz çıkarım.** Her `PageCanvas` mount olur olmaz `getOperatorList` + MuPDF metin çıkarımı çalışır (kullanıcı sadece okuyor olsa bile). Viewer modu için saf israf.
- **P4 🟠 Açılış MuPDF'e kilitli.** `openPdfBytes` önce 10,4 MB Wasm'ın yüklenmesini ve `inspectPdf`'i bekler; ardından ana thread'de font çıkarımı yapar. İlk sayfanın görünme süresi (TTFP) gereksiz uzun.
- **P5 🟠 Yüksek zoom'da bulanıklık.** 12,58 MP tavan + DPR ≤ 2 nedeniyle %300+ zoom'da tam sayfa raster düşük çözünürlükte kalır. Çözüm yalnızca karo ile mümkün.
- **P6 🟠 Geniş yeniden render.** `PageCanvas` tüm `elements` dizisine ve `isPinching`'e abone; sürükleme sırasında her `pointermove` → store güncellemesi → görünür tüm sayfalar render.
- **P7 🟡 Tek worker kuyruğu.** Dışa aktarım sürerken çıkarım/temiz önizleme bekler; iptal ve ilerleme bildirimi yok, yalnızca 120 sn zaman aşımı ve tam ekran bloklayan overlay.

### 4.2 Bellek
- **M1 🔴 Aynı PDF'in 3–4 kopyası:** Zustand store + pdf.js worker (`bytes.slice()`) + MuPDF worker + (dışa aktarımda) pdf-lib. 100 MB dosya mobil Safari'de sekme çökmesi riski.
- **M2 🟠 `pageExtractions` hiç boşaltılmıyor.** Gezilen her sayfanın metin blokları, görsel nesneleri ve vektör şekilleri store'da birikir.
- **M3 🟠 Sanallaştırılmamış thumbnail ızgaraları.** `MobilePagesSheet` ve `PageOrganizeModal` `pages.map` ile **tüm sayfalara canvas** açar; 300 sayfada 300 canvas + 300 eşzamanlı render.
- **M4 🟠 Thumbnail önbelleği yok.** Thumbnail her mount'ta yeniden rasterlenir; bitmap önbelleği/yeniden kullanım yok.
- **M5 🟡 Snapshot undo.** 60 × tüm eleman listesi; uzun çizim (stroke noktaları) içeren dokümanlarda büyür.
- **M6 🟡 Temiz önizleme dokümanları.** Düzenlenen her sayfa için pdf.js'te ayrı tek sayfalık doküman açılır; unmount'ta bırakılıyor (iyi) ama aktifken sayfa başına ek parse maliyeti var.

### 4.3 Mimari ve Sürdürülebilirlik
- **A1 🔴 Üç PDF motoru.** Render (pdf.js) ile dışa aktarım (MuPDF+pdf-lib) farklı motorlar → "ekranda gördüğüm ≠ dışa aktarılan" riski, üçlü parse maliyeti, ~14 MB çalışma zamanı yükü.
- **A2 🟠 Dev bileşenler.** `PageCanvas`, `useEditorStore`, `RightInspector` 2.000+ satır; Viewer/Editor ayrımı için parçalanmaları şart.
- **A3 🟠 Kalıcılık yok.** Otomatik kayıt, oturum kurtarma, "kaydedilmemiş değişiklik" uyarısı (`beforeunload`) yok. Sekme kapanırsa tüm iş kaybolur.
- **A4 🟠 Dosya sistemi entegrasyonu yok.** `file_handlers`, `launchQueue`, `share_target`, File System Access (yerinde kaydet) kullanılmıyor; "kaydet" = `*-edited.pdf` indirme.
- **A5 🟡 Çok thread'li Wasm kapalı.** COOP/COEP başlıkları yalnızca dev/preview sunucusunda; GitHub Pages özel başlık veremez → `SharedArrayBuffer` üretimde yok.
- **A6 🟡 Marka/isim tutarsızlığı.** README "AetherPDF Studio", `package.json` "wasm-pdf-editor", arayüz "gullacpdf".

### 4.4 Lisans (Kurumsal Engelleyici)
- **L1 🔴 MuPDF AGPL-3.0.** Kapalı kaynak dağıtım (özellikle uygulama mağazaları ve kurumsal satış) için ya **Artifex ticari lisansı** ya tüm uygulamanın AGPL ile açılması ya da motor değişimi (PDFium, BSD/Apache) gerekir. **Karar (K2): PDFium'a geçilecek;** MuPDF F3 sonunda tamamen sökülür. O zamana kadar yayınlanan web sürümü AGPL kapsamındadır (kaynak açık kalmalı; bkz. 00 → D9).

### 4.5 Eksik Enterprise Viewer Yetenekleri
Metin seçimi/kopyalama katmanı, doküman içi arama, outline/yer imleri, bağlantı (link) tıklama, sepya tema, sayfa numarasına git, yazdırma, erişilebilir (ekran okuyucu) metin katmanı: **hiçbiri yok** (bkz. 02).

---

## 5. Hedef Çekirdek Mimari (Core Engine)

### 5.1 İlkeler
1. **Tek doğruluk kaynağı çekirdekte.** Doküman modeli, komutlar, undo/redo, geometri, hit-test, metin bloğu kurma, dışa aktarım planı çekirdekte yaşar. UI katmanları yalnızca görünüm durumu tutar.
2. **Tek PDF motoru.** Render, metin, arama, redaksiyon ve yazma **aynı motor** üzerinden (A1'i kapatır).
3. **Platformdan bağımsız, UI'sız, I/O'suz çekirdek.** Dosya erişimi ve thread'leme platform kabuğunun işidir; çekirdek bayt/akış alır, bayt/karo verir.
4. **Kademeli göç (strangler).** Mevcut TS modülleri tek tek değiştirilir; mevcut Vitest testleri eşdeğerlik kapısıdır. "Büyük patlama" yeniden yazım yok.

### 5.2 Rust Workspace Yerleşimi (öneri)

```
core/
  crates/
    gp-model     # Saf Rust. Doküman modeli (Page, Element türleri), Command + ters komut,
                 # undo/redo günlüğü, seçim, serde ile oturum serileştirme.
    gp-geom      # Saf Rust. coordinates.ts, snapGuides, vectorShapes, imageMask,
                 # döndürülmüş resize, akıllı hit-test portu.
    gp-text      # Saf Rust. textExtractor blok kurma, richText sarma/ölçüm, font eşleme,
                 # pageRange, pageNumbers.
    gp-pdf       # `PdfBackend` trait'i + ortak tipler (PageInfo, TileRequest, TextSpan,
                 # SearchHit, OutlineNode, RedactionPlan, CompilePlan).
    gp-pdf-pdfium # Backend uygulaması: PDFium (`pdfium-render` crate'i üzerinden). Karo raster,
                 # metin/karakter kutuları, arama, outline, bağlantılar, sayfa nesnesi
                 # düzenleme (ekle/kaldır), sayfa içe aktarma, kaydetme.
    gp-redact    # Redaksiyon planlayıcı: nesne düzeyi kaldırma + kısmi metin yeniden yazma;
                 # gerekirse içerik akışı yeniden yazıcı (bkz. §5.5).
    gp-engine    # Cephe (facade): Session API. gp-model + gp-pdf'i birleştirir,
                 # karo zamanlayıcı ve bellek bütçesini yönetir.
  bindings/
    wasm         # wasm-bindgen (web). Worker içinde çalışır.
    frb          # flutter_rust_bridge (mobil) — bkz. 04.
```

`PdfBackend` soyutlaması korunur: motor PDFium olarak kesinleşti (K2), ancak üst katmanlar motora doğrudan bağlanmaz; testlerde sahte (mock) backend kullanılabilir ve ileride motor değişimi tek crate'i etkiler.

### 5.3 Çekirdek API Yüzeyi (Session cephesi — taslak)

| Grup | İşlemler |
|---|---|
| Yaşam döngüsü | `open(bytes|stream, password?) → SessionId`, `close`, `page_count`, `page_info(i)`, `needs_password` |
| Viewer | `render_tile(page, rect, scale, theme) → RGBA/bitmap`, `render_thumbnail(page, max_px)`, `text_spans(page)`, `search(query, opts) → akış halinde SearchHit`, `outline()`, `links(page)` |
| Editör (tembel) | `analyze_page(page) → metin blokları + görseller + şekiller`, `apply(Command) → Patch`, `undo/redo`, `hit_test(page, point, opts)`, `snap(...)` |
| Dışa aktarım | `compile(options, progress_cb, cancel_token) → bytes|stream`, `split(jobs)`, `save_incremental` |
| Oturum | `serialize_session() → bytes` (otomatik kayıt), `restore_session(bytes)` |
| Bellek | `set_memory_budget(bytes)`, `trim(level)` (OS bellek uyarısında) |

Notlar:
- `apply` tam durum değil **yama (patch)** döndürür → UI yalnızca değişen elemanı günceller (P6).
- Uzun işlemler **ilerleme + iptal** destekler (P7).
- Undo, snapshot yerine **komut günlüğü** ile (M5).

### 5.4 Web'de Çekirdeğin Konumu
- Çekirdek Wasm modülü **yalnızca Worker'larda** yüklenir; ana thread'de PDF kodu çalışmaz.
- Web'de iki Wasm modülü yan yana çalışır: **`pdfium.wasm`** (hazır, sürümü sabitlenmiş PDFium derlemesi, ~5 MB) ve **çekirdek Wasm** (Rust, `wasm-bindgen`). `pdfium-render` web hedefinde PDFium'a JS köprüsü üzerinden bağlanır; böylece C++ kodunu Rust ile birlikte Emscripten'de derleme zorunluluğu yoktur.
- Geçiş üç adımda:
  - **F1:** Görüntüleme yolu (karo, metin, arama, outline) doğrudan PDFium Wasm'a alınır; ince bir TS adaptörü yeterlidir. pdf.js render'dan çıkar.
  - **F2:** Saf Rust crate'leri (`gp-model/geom/text`) `wasm-bindgen` ile devreye girer.
  - **F3:** `gp-pdf-pdfium` + `gp-redact` düzenleme ve dışa aktarımı devralır; `pdfjs-dist`, `pdf-lib` ve `mupdf` bağımlılıkları kaldırılır.

### 5.5 PDFium Yetenek Eşlemesi ve Boşluklar

| İhtiyaç | Bugün | PDFium karşılığı | Durum |
|---|---|---|---|
| Karo/bölge raster | pdf.js (tam sayfa) | `FPDF_RenderPageBitmapWithMatrix` (dönüşüm + kırpma ile bölge) | ✅ Doğrudan |
| Metin, karakter kutuları, font/renk bilgisi | MuPDF structured text | `FPDFText_*` (karakter bazlı kutu, font, boyut, renk) | ✅ `gp-text` girdisi "nötr karakter akışı"na uyarlanır |
| Arama | yok | `FPDFText_FindStart/FindNext` + çekirdekte Türkçe katlama | ✅ |
| Outline, bağlantılar | yok | `FPDFBookmark_*`, `FPDFLink_*` | ✅ |
| Şifreli belge açma | MuPDF | `FPDF_LoadDocument` (parola) | ✅ |
| Görsel/şekil nesnelerini bulma | pdf.js operatör listesi | `FPDFPage_GetObject`, `FPDFPageObj_GetBounds/GetType`, `FPDFImageObj_*`, `FPDFPath_*` | ✅ Daha doğrudan (operatör yorumlama kalkar) |
| Görsel/şekil kaldırma, taşıma | MuPDF redaksiyon | `FPDFPage_RemoveObject`, `FPDFPageObj_Transform`, `FPDFPage_GenerateContent` | ✅ Nesne düzeyinde, yama gerektirmez |
| Yeni metin/görsel/yol ekleme, font gömme | pdf-lib + fontkit | `FPDFPageObj_CreateTextObj`, `FPDFText_LoadFont`, `FPDFImageObj_SetBitmap`, `FPDFPageObj_CreateNewPath` | ✅ |
| Sayfa birleştirme/bölme/sıralama/döndürme | pdf-lib | `FPDF_ImportPages`, `FPDFPage_Delete`, `FPDFPage_SetRotation` | ✅ |
| Kaydetme | pdf-lib + MuPDF | `FPDF_SaveAsCopy` (tam veya artımlı) | ✅ |
| Gömülü font verisi | pdf-lib ile elle | `FPDFFont_GetFontData` | ✅ |
| **Özgün metnin kısmi redaksiyonu** | MuPDF `applyRedactions` | Doğrudan karşılığı **yok** | ⚠️ **En yüksek risk** — aşağıya bakın |
| Çıktıyı parola ile şifreleme | yok | **Yok** (PDFium şifreli yazamaz) | ⏸ İlk sürümde kapsam dışı; aday: `qpdf` (00 → D4) |
| İleri optimizasyon / doğrusallaştırma | MuPDF `compress` | Sınırlı | ⏸ Aynı aday; ilk sürümde yalnızca PDFium'un standart yazımı |

**Metin redaksiyonu stratejisi (00 → D3):**
1. Düzenlenen blokla **tamamen** örtüşen metin nesneleri kaldırılır (PDFium'da her metin gösterme operatörü ayrı nesnedir; çoğu durumda bu yeterlidir).
2. **Kısmi** örtüşmede nesne kaldırılır; blok dışında kalan glifler aynı font tutamacıyla yeni metin nesnesi olarak yeniden yazılır.
3. (2) güvenilir çıkmazsa yedek: Rust'ta **içerik akışı yeniden yazıcı** (`lopdf` tabanlı) — metin operatörlerini dikdörtgene göre kırpar; PDFium yalnızca doğrulama ve render için kullanılır.
4. Her redaksiyon sonrası otomatik doğrulama: redakte edilen dikdörtgende `FPDFText_*` ile **metin kalmadığı** test edilir (kurumsal veri sızıntısı güvencesi). Doğrulama başarısızsa dışa aktarım hata verir; sessizce beyaz yama yapılmaz.

Bu konu F3'ün **ilk işi olarak** referans belge setinde denenir; sonuç F3 kapsamını belirler.

**Thread kısıtı (00 → D2):** PDFium thread-güvenli değildir; aynı süreçte tüm çağrılar tek thread'den yapılır. Bunun render mimarisine etkisi §6.6'dadır.

**Lisans:** PDFium BSD-3-Clause/Apache-2.0; bağımlılıkları (FreeType, libjpeg-turbo, OpenJPEG, zlib vb.) izin verici lisanslıdır. Uygulamaya "açık kaynak lisansları" ekranı eklenir.

---

## 6. Performans ve Hız Mimarisi

### 6.1 Hedef Bütçeler (kabul ölçütleri)

| Metrik | Hedef (orta sınıf Android / masaüstü) |
|---|---|
| İlk sayfanın görünmesi (10 MB PDF, sıcak önbellek) | < 800 ms / < 400 ms |
| Kaydırma ve pinch | 60 fps; uzun görev (>50 ms) **0** |
| Zoom sonrası keskinleşme | < 250 ms (görünür karolar) |
| 500 sayfalık dokümanda bellek | Mobil ≤ 300 MB, masaüstü ≤ 700 MB toplam |
| Viewer modunda ilk yük (JS, gzip) | ≤ 350 KB + motor Wasm (akış halinde derleme) |
| Edit moduna geçiş | < 300 ms (görünür sayfa analizi arka planda) |

### 6.2 Üç Katmanlı Sayfa Gösterimi
1. **İskelet:** Sayfa boyutları açılışta bilinir → doğru boyutlu boş kâğıt anında yerleşir (layout kayması yok).
2. **Düşük çözünürlüklü önizleme:** Sayfa başına ~%25–50 ölçekte tek bitmap; uzun süre önbellekte tutulur, hızlı kaydırmada ve pinch sırasında gösterilir.
3. **Keskin karolar:** Görünür alan için 512×512 CSS px karolar, o anki `zoom × DPR` ölçeğinde. Pinch sırasında mevcut karolar GPU ile ölçeklenir; jest bitince yeni ölçek karoları öncelik sırasıyla üretilir ve yumuşak geçişle değiştirilir.

Karo anahtarı: `(docRev, pageId, pageRev, scaleBucket, tx, ty, theme)`. `pageRev` yalnızca o sayfanın arka planı değiştiğinde (redaksiyon/temiz önizleme) artar → eleman sürüklemek karo geçersiz kılmaz, çünkü elemanlar ayrı overlay katmanındadır.

### 6.3 Sanallaştırma
- Sayfa ofsetleri için **önek toplam (prefix-sum) dizisi** + ikili arama (bugünkü her karede `reduce` yerine).
- DOM'da yalnızca görünür ± 1 sayfa kabuğu; karolar viewport dikdörtgeni ile kesişime göre.
- Thumbnail çekmecesi, mobil sayfa ızgarası ve sayfa düzenleme modali **aynı sanal ızgara bileşenini** kullanır (M3).
- Hızlı kaydırmada (hız eşiği üstü) karo istekleri ertelenir, yalnızca önizleme gösterilir; kaydırma durunca istekler başlar.

### 6.4 Zamanlayıcı ve Öncelik
İstek öncelikleri: (1) görünür karo → (2) görünür sayfa önizlemesi → (3) ±1 sayfa ön yükleme (kaydırma yönünde) → (4) thumbnail → (5) arka plan (arama indeksleme, analiz).
Her istek **iptal edilebilir**; viewport'tan çıkan sayfanın bekleyen işleri düşürülür. Eski ölçek kovalarının istekleri yeni zoom'da toplu iptal edilir.

### 6.5 Agresif Bellek Yönetimi
- **Bayt bütçeli LRU**, sayı bazlı değil. Karo maliyeti = `w × h × 4`. Varsayılan bütçe: mobil 128 MB, masaüstü 384 MB (`deviceMemory` ile ölçeklenir).
- Tahliye sırası: uzak sayfa karoları → eski ölçek kovaları → uzak önizlemeler → yüklü PDFium sayfa nesneleri (`FPDF_ClosePage`; en fazla ~8 sayfa açık tutulur) → analiz sonuçları.
- **En az bayt kopyası:** PDF baytları yalnızca worker'larda yaşar (Engine + Render = 2 kopya; nedeni §6.6); ana thread ve store'da **tutulmaz** (M1, P2). Worker'a aktarım `Transferable` ile; mobil web'de belge > 80 MB ise tek worker'a (Engine = Render) düşülür.
- `ImageBitmap.close()` ve canvas boyut sıfırlama (iOS Safari canvas bellek tavanı) zorunlu.
- `visibilitychange` (gizli) ve bellek baskısı sinyalinde `trim()` → yalnızca görünür sayfa önizlemesi kalır.
- `pageExtractions` karşılığı analiz sonuçları LRU'ya bağlanır; düzenlenmiş sayfalarınki sabitlenir (pin).

### 6.6 Worker / Thread Topolojisi

```
Ana thread (yalnızca UI + jest + overlay)
   │  mesaj: küçük JSON + Transferable (ImageBitmap / ArrayBuffer)
   ├─ Engine Worker (durumlu): Session, komutlar, hit-test, arama, analiz
   ├─ Render Worker (varsayılan 1; koşullu 2. — aşağıya bakın): karo/thumbnail raster
   │     → OffscreenCanvas / ImageBitmap olarak aktarım, ana thread'de sıfır kopya çizim
   └─ Export Worker (talep anında): compile / split / optimize; ilerleme + iptal
```

- Dışa aktarım ayrı worker'da olduğu için görüntüleme **hiç bloklanmaz**; tam ekran overlay yerine iptal edilebilir ilerleme çubuğu.
- **PDFium thread-güvenli olmadığı için** her worker kendi PDFium Wasm örneğini ve belgenin kendi kopyasını taşır. Bu yüzden havuz küçük tutulur: **Engine Worker + 1 Render Worker** varsayılan (toplam 2 bayt kopyası); ikinci render worker yalnızca masaüstünde ve belge < 50 MB ise açılır. Paralellik yerine **öncelik ve iptal** ana araçtır: görünür karo isteği her zaman kuyruğun başına geçer.
- Ayrı örnekler kullanıldığından `SharedArrayBuffer` ve COOP/COEP **zorunlu değildir**. Barındırma kararı (K10): F1 ile Cloudflare Pages; gerekçe önbellek başlıkları (00 §3).
- Gömülü font çıkarımı ve operatör analizi worker'a taşınır (P4); ana thread'de `PDFDocument.load` kalmaz.
- Wasm `compileStreaming` + Service Worker önbelleği; motor yüklenirken iskelet + dosya adı hemen görünür.

### 6.7 UI Tarafı Render Hijyeni
- Store bölünmesi: `documentStore` (çekirdek aynası, sayfa/eleman kimliğine göre normalize) · `viewStore` (zoom, mod, tema) · `gestureState` (store dışı, ref/sinyal tabanlı; saniyede 60 güncelleme React'e girmez).
- Sürükleme/yeniden boyutlandırma sırasında eleman konumu **CSS transform** ile güncellenir, store'a yalnızca jest sonunda tek commit.
- `PageCanvas` → `PageShell` (karo katmanı) + `TextLayer` (viewer) + `ElementLayer` + `ToolLayer` (yalnızca Edit modunda, tembel yüklenen chunk).

---

## 7. Göç Yol Haritası

| Faz | İçerik | Çıktı / Kapı |
|---|---|---|
| **F0 – Hızlı kazanımlar (mevcut TS üzerinde)** | Transferable/tek bayt kopyası, çıkarımı Edit moduna erteleme, thumbnail ızgaralarını sanallaştırma, font çıkarımını worker'a alma, store'dan `bytes` çıkarma, otomatik kayıt | P2, P3, M1–M3, A3 kapanır; ölçüm panosu (performans işaretleri) kurulur |
| **F1 – Viewer çekirdeği** | **PDFium Wasm** ile karo boru hattı + render worker + bellek bütçesi; metin katmanı, arama, outline. Düzenleme/dışa aktarım geçici olarak eski yolda kalır | 6.1 bütçeleri Viewer modunda sağlanır; pdf.js render'dan çıkar |
| **F2 – Rust çekirdek A** | `gp-model`, `gp-geom`, `gp-text` portu; eşdeğerlik testleri; web'de wasm-bindgen ile devreye alma | Mevcut Vitest senaryoları iki uygulamada aynı sonucu verir |
| **F3 – Rust çekirdek B** | Redaksiyon doğrulaması (§5.5) → `gp-pdf-pdfium` + `gp-redact`; analiz, yazma, kaydetme; pdf.js, pdf-lib ve MuPDF'in sökülmesi | Görsel regresyon (referans PDF seti) + tek motor + AGPL bağımlılığı sıfır |
| **F4 – Mobil** | Aynı çekirdek ile Flutter uygulaması (bkz. 04) | Mağaza yayını |

F0 ve F1 Rust gerektirmez ve kullanıcıya en hızlı değeri verir. Mobilin Viewer aşamaları (04 → M0, M1) F1 + F2'ye, Editor aşamaları F3'e bağlıdır. Ayrıntılı nihai yol haritası: [00 §4](00_DECISION_LOG.md).

**Geçiş dönemi notu:** F1–F3 arasında görüntüleme PDFium, dışa aktarım MuPDF + pdf-lib ile yapılır; "Önizle" (02 §4.4) bu dönemde dışa aktarım çıktısını PDFium'da yeniden açarak gösterir, böylece tutarsızlık kullanıcıya görünür olur.

## 8. Ölçüm ve Kalite Kapıları
- Referans doküman seti: 1 sayfa form, 120 sayfa metin, 300 sayfa taranmış (görsel ağırlıklı), 80 MB teknik çizim (vektör yoğun), şifreli, RTL/CJK.
- Otomatik: Playwright + performans izleri (uzun görev sayısı, kare süreleri), bellek tepe ölçümü, piksel karşılaştırmalı görsel regresyon.
- Her faz, 6.1 tablosundaki ilgili satırları CI'da doğrulamadan kapanmaz.
