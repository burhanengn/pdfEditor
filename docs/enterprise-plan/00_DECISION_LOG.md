# 00 — Karar Kaydı ve Nihai Yol Haritası

> Bu dosya, planlama dokümanlarındaki (01–04) açık karar noktalarının **kesinleşmiş** hâlidir. Çelişki durumunda bu dosya geçerlidir.
> Karar tarihi: 2026-11-17. Durum: **Planlama tamamlandı; uygulama başlamadı.**

---

## 1. Ürün Sahibi Kararları (K1–K10)

| # | Konu | Karar | Etkilenen bölüm |
|---|---|---|---|
| **K1** | Rust çekirdek | **Onaylandı.** Kademeli (strangler) olarak yazılacak; mevcut Vitest testleri eşdeğerlik kapısı. | 01 §5, §7 |
| **K2** | PDF motoru / lisans | **PDFium'a geçilecek** (BSD-3/Apache-2.0). MuPDF tamamen sökülecek. | 01 §4.4, §5.2–5.5 |
| **K3** | Tek motor | **Onaylandı.** pdf.js, pdf-lib ve MuPDF kalkar; render, metin, arama, düzenleme, yazma tek motordan (PDFium). | 01 §5, §7 |
| **K4** | Viewer'da hafif işaretleme | **Kalacak.** Vurgula / altını çiz / not, Viewer seçim menüsünden. | 02 §2.2 |
| **K5** | Mobil çerçeve | **Flutter + `flutter_rust_bridge`.** Web React olarak kalır. | 04 §3–4 |
| **K6** | Capacitor geçici köprüsü | **Hayır.** Mobil yerel uygulama çıkana kadar PWA yeterli. | 04 §3 |
| **K7** | Kaydet varsayılanı | **Kopya olarak kaydet.** Özgün dosyanın üzerine yazma ilk seferde onaylı ("bir daha sorma" seçenekli). | 02 §4.4, 04 §6.2 |
| **K8** | Dil ve marka | Varsayılan **İngilizce**, **Türkçe** seçilebilir, altyapı yeni dillere açık. Ürün adı her yerde **gullacpdf**. | 02 §5.8, 04 §4.6 |
| **K9** | Minimum sürümler | **Android 8.0 (API 26)**, **iOS / iPadOS 16**. **Tablet ilk sürüme dahil.** | 04 §4.7, §7 |
| **K10** | Barındırma | **Cloudflare Pages** (kalıcı ücretsiz plan) önerilir; ayrıntı §3. | 01 §6.6 |

## 2. Planlama Sırasında Verilen Ek Kararlar

Ürün sahibinin "takıldığın yerde sen karar ver" yönergesiyle kesinleştirilenler:

| # | Konu | Karar | Gerekçe |
|---|---|---|---|
| **D1** | PDFium bağlama yöntemi | Rust tarafında `pdfium-render` crate'i (MIT/Apache); ikili dosyalar sürümü sabitlenmiş hazır PDFium derlemelerinden (Android `.so`, iOS XCFramework, web `pdfium.wasm`). | Üç platformda tek Rust API; PDFium'u kaynaktan derleme yükü yok. |
| **D2** | PDFium thread modeli | PDFium **thread-güvenli değildir**. Süreç başına **tek PDFium thread'i** + öncelikli/iptal edilebilir iş kuyruğu. Web'de paralellik, her biri kendi Wasm örneğine sahip worker'larla. | Kütüphane kısıtı; 01 §6.6 ve 04 §4.3 buna göre yazıldı. |
| **D3** | Metin redaksiyonu | Önce PDFium nesne düzeyi kaldırma (`FPDFPage_RemoveObject`); kısmi örtüşmede kalan glifler yeniden yazılır. Yetersiz kalırsa yedek: Rust'ta içerik akışı yeniden yazıcı (`lopdf` tabanlı). **F3'ün ilk işi bu konuda teknik doğrulama (spike).** | PDFium'da MuPDF'teki gibi dikdörtgen tabanlı redaksiyon API'si yok; en yüksek teknik risk. |
| **D4** | Parola ile koruma ve ileri optimizasyon | İlk sürümde **yok.** PDFium şifreli PDF **açar** ama şifreli **yazamaz**. Sonraki faz adayı: `qpdf` (Apache-2.0). | Kapsamı daraltır; mevcut editörde de çıktı şifreleme özelliği yok. |
| **D5** | Viewport kaydırma modeli (web) | Motor yönetimli kaydırma (`touch-action: none`) **prototip ölçümüne bağlı**; ölçüt tutmazsa tek parmak yerel kaydırma + motor pinch. | 03 §5.2'deki yedek plan. |
| **D6** | Oturum/proje dosya biçimi | İlk sürümde dışa açık proje dosyası yok; oturum yalnızca uygulama özel depolamasında. | Kapsam. |
| **D7** | OCR | Kapsam dışı. | Kapsam. |
| **D8** | Telemetri | Varsayılan kapalı; ilk sürümde hiç eklenmez. | "Belge cihazdan çıkmaz" vaadi. |
| **D9** | Geçiş dönemi lisansı | MuPDF, F3 bitene kadar mevcut web sürümünde kalır. Bu sürede yayınlanan site AGPL kapsamındadır: **kaynak kod herkese açık tutulmalı**; kapalı dağıtım (mağaza) ancak F3 sonrası. | AGPL yükümlülüğü. |
| **D10** | Mevcut kök dizin planları | `PROJECT_PLAN.md`, `MOBILE_AND_DEPLOY_PLAN.md`, `BUGFIX_AND_UPGRADE_PLAN.md`, `REFINEMENT_AND_FIX_MASTER_PLAN.md` tarihsel kayıt sayılır; güncel plan `docs/enterprise-plan/`. | Tek doğruluk kaynağı. |

## 3. Barındırma Önerisi (K10)

**Öneri: Cloudflare Pages (ücretsiz plan).**

- Süre sınırı olmayan ücretsiz plan; statik varlıklar için bant genişliği/istek kotası yok.
- Depodaki `_headers` dosyasıyla özel HTTP başlıkları: `Cross-Origin-Opener-Policy`, `Cross-Origin-Embedder-Policy` ve özetli (hash'li) varlıklar için uzun ömürlü `Cache-Control: immutable`.
- GitHub deposuna bağlanıp her push'ta otomatik derleme; PR önizleme adresleri.
- Bilinen sınırlar: dosya başına ~25 MB, aylık derleme sayısı kotası. Projenin en büyük dosyası (motor Wasm, ~5 MB) sınırın çok altında.

> Doğrulama notu: Ücretsiz plan koşulları zamanla değişebilir; geçişten hemen önce güncel sınırlar sağlayıcının sayfasından teyit edilmelidir.

**Aciliyet düşük.** D2 nedeniyle web'de paralellik ayrı Wasm örnekleriyle sağlanır; `SharedArrayBuffer` (dolayısıyla COOP/COEP) artık **zorunlu değil**. Geçişin asıl kazancı önbellek başlıkları ve PR önizlemeleridir. Bu yüzden: **F1 ile birlikte geçilir; o zamana kadar GitHub Pages kalır.** GitHub Pages yedek dağıtım olarak korunabilir.

## 4. Nihai Yol Haritası

| Faz | Kapsam | Motor durumu | Çıkış kapısı |
|---|---|---|---|
| **F0 — Hızlı kazanımlar** | Tek bayt kopyası + Transferable; analizi Edit moduna erteleme; thumbnail ızgaralarını sanallaştırma; font çıkarımını worker'a alma; otomatik kayıt; i18n altyapısı (EN varsayılan, TR) ve marka birliği; tasarım token'ları | pdf.js + MuPDF + pdf-lib (değişmez) | 01 §4'teki P2, P3, M1–M3, A3, A6 kapanır |
| **F1 — Viewer çekirdeği** | PDFium Wasm ile karo boru hattı ve render worker'ları; Viewer modu, metin katmanı, arama, outline, temalar; mobile-first kabuk + sheet sistemi + jest motoru; Cloudflare Pages | Görüntüleme: **PDFium**. Düzenleme/dışa aktarım: geçici olarak MuPDF + pdf-lib | 01 §6.1 bütçeleri Viewer'da; 02 ve 03 kabul ölçütleri |
| **F2 — Rust çekirdek A** | `gp-model`, `gp-geom`, `gp-text` portu; web'de `wasm-bindgen` ile devreye alma | Aynı | Mevcut Vitest senaryoları iki uygulamada aynı sonuç |
| **F3 — Rust çekirdek B** | D3 doğrulaması → `gp-pdf-pdfium`: analiz, redaksiyon, eleman yazma, kaydetme; pdf.js / pdf-lib / MuPDF'in sökülmesi | **Yalnızca PDFium** | Referans belge setinde görsel regresyon; AGPL bağımlılığı sıfır |
| **F4 — Mobil (Flutter)** | M0 prototip → M1 Viewer + "Birlikte Aç" (telefon + tablet) → M2 Editor temel → M3 Editor ileri + iOS Share Extension → M4 sertleştirme | Yalnızca PDFium | 04 §7 |

Bağımlılıklar: F4-M0 ve M1 (salt Viewer) yalnızca F1'deki PDFium render katmanına ve F2'ye ihtiyaç duyar; **F3 bitmeden başlayabilir**. M2 (Editor) için F3 şarttır.

## 5. Uygulamaya Geçiş İçin İlk Adımlar (F0 iş listesi)

1. Performans ölçüm tabanı: referans belge seti + mevcut durumun sayıları (TTFP, uzun görev sayısı, bellek tepesi).
2. `wasmWorkerClient`: bayt aktarımında Transferable; `extractPageText` / `prepareCleanPage` çağrılarından bayt yükünün çıkarılması (worker belgeyi kimlikle tanır).
3. PDF baytlarının Zustand store'dan çıkarılması.
4. Sayfa analizinin (`extractPageImagesAndRules` + `extractPageText`) yalnızca düzenleme niyetinde tetiklenmesi.
5. `MobilePagesSheet` ve `PageOrganizeModal` için sanal ızgara.
6. `embeddedFontExtractor`'ın worker'a taşınması.
7. Otomatik kayıt + oturum kurtarma + `beforeunload` uyarısı.
8. i18n sözlüğü (EN/TR), `<html lang>`; README / `package.json` / manifest'te ad birliği (**gullacpdf**).
9. Tasarım token'ları ve 12 px altı metinlerin kaldırılması.

Her madde ayrı, küçük ve geri alınabilir bir değişiklik olarak planlanmıştır.
