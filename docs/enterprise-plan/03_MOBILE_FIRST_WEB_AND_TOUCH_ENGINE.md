# 03 — Mobile-First Web Arayüzü ve Dokunmatik Jest Motoru

> Kapsam: Mobil öncelikli düzen, bottom sheet sistemi, dokunma hedefleri, jest motoru.
> **Kesinleşen kararlar:** Mobil yerel uygulama çıkana kadar mobil kullanıcılar bu PWA ile karşılanır (K6); arayüz varsayılan İngilizce, Türkçe seçilebilir (K8). Tümü: [00](00_DECISION_LOG.md).
> Durum: **Sadece planlama.** Mod kurgusu için [02](02_VIEWER_AND_EDITOR_DUAL_MODE_UX.md), render altyapısı için [01](01_SYSTEM_AUDIT_AND_CORE_ARCHITECTURE.md).

---

## 1. Bugünkü Durum (Denetim Özeti)

| # | Bulgu | Kaynak |
|---|---|---|
| T1 | Mobil arayüz, masaüstü düzeninin **üzerine eklenmiş** katman: aynı `TopToolbar` daraltılıyor, aynı `RightInspector` sheet içine gömülüyor. Kırılma noktaları `md`/`lg` ile masaüstünden aşağı doğru tanımlı. | `App.tsx`, `MobileInspectorSheet.tsx` |
| T2 | Tutamaç dokunma alanı **36×36 px** (görsel 10 px); 44 px standardının altında. Komşu tutamaçların alanları küçük nesnelerde çakışır. | `index.css` `.touch-handle-target` |
| T3 | Pinch için **iki paralel yol** (Pointer Events + Touch Events yedeği) ve `window` düzeyinde dinleyiciler; durum hem `ref` hem Zustand'da (`isPinching`, `activeTouchCount`) → her pinch başlangıç/bitişinde tüm görünür sayfalar yeniden render. | `DocumentViewport.tsx` |
| T4 | `touch-action` jest **başladıktan sonra** değiştiriliyor (`pan-x pan-y` → `none`). Tarayıcı, `touch-action`'ı jest başlangıcında değerlendirir; sonradan değişiklik o jeste yansımaz. Bugün çalışmasının nedeni `touchmove` üzerindeki `preventDefault` yedeğidir. | aynı |
| T5 | Jestler arası koordinasyon özel bir `window` olayı (`gullac:multitouch-start`) ve dağınık `setTimeout` uzun-bas zamanlayıcıları ile yapılıyor; merkezi hakem yok. Her araç kendi `pointermove/up/cancel` dinleyicilerini `window`'a ekliyor (5+ ayrı kopya). | `PageCanvas.tsx` |
| T6 | Pinch sonrası **momentum yok**, zoom sınırlarında lastik etkisi yok; iki parmakla kaydırma yalnızca pinch'in yan etkisi olarak var. | `DocumentViewport.tsx` |
| T7 | Tek parmak yerel kaydırma ile nesne sürükleme arasında belirsizlik: seçili olmayan nesneye basıp kaydırınca hangisinin kazanacağı araca/duruma göre değişiyor. | `PageCanvas.tsx`, `SelectionOverlay.tsx` |
| T8 | Mobil sayfa sheet'i tüm sayfaları sanallaştırmadan çiziyor; thumbnail eylemleri hover'a bağlı. | `MobilePagesSheet.tsx`, `ThumbnailItem.tsx` |
| T9 | Sheet'lerde sürükleyerek kademe değiştirme yok; yalnızca aç/kapa ve denetçide iki sabit durum (`collapsed`/`half`). | `mobile/*` |
| T10 | Alt dock 4 sekme, etiketler 11 px, rozet 9 px. Viewer için fazla, editör için eksik (araçlar bir sheet arkasında). | `MobileBottomDock.tsx` |

Korunacaklar: pinch'in "jest sırasında GPU transform, bırakınca tek commit" modeli; `dvh` + safe-area kullanımı; çizim araçlarında `touch-action: none`; `visualViewport` ile klavye kaçınma yaklaşımı.

---

## 2. Mobile-First Arayüz Mimarisi

### 2.1 İlke
Tasarım **360×640** ekrandan başlar; tablet ve masaüstü, aynı bileşenlerin **yer kazandıkça genişleyen** yerleşimleridir (sheet → yan panel, alt şerit → yan/üst çubuk). Tersine küçültme yapılmaz. CSS'te varsayılan stiller mobil; `min-width` sorguları ile zenginleştirme.

### 2.2 Kırılma Noktaları ve Yerleşim Sınıfları

| Sınıf | Genişlik | Gezinme | Paneller |
|---|---|---|---|
| **Kompakt** (telefon dikey) | < 600 | Kompakt üst bar + alt şerit/FAB | Hepsi bottom sheet |
| **Orta** (telefon yatay, küçük tablet) | 600–1023 | Üst bar + yan araç rayı | Sheet'ler yan sheet'e (sağdan, 360 px) dönüşür |
| **Geniş** (tablet yatay, masaüstü) | ≥ 1024 | Tam üst bar | Kalıcı/daraltılabilir yan paneller |

Karar **yalnızca genişlikle** değil, `pointer: coarse` ve yükseklikle birlikte verilir (yatay telefonda yükseklik < 480 → sheet'ler yan panele döner, üst bar otomatik gizlenir).

### 2.3 Başparmak Bölgesi (Thumb-Zone) Haritası

```
┌──────────────────────────────┐
│  ZOR ERİŞİM  → pasif bilgi   │  Üst bar: geri, belge adı, ⋯ menü
│  (belge adı, durum, taşma)   │  (yıkıcı/sık eylem YOK)
├──────────────────────────────┤
│                              │
│  ORTA → içerik               │  Kâğıt; doğrudan manipülasyon
│                              │
├──────────────────────────────┤
│  KOLAY ERİŞİM → eylemler     │  Sayfa hapı · FAB "Düzenle" (Viewer)
│                              │  Araç şeridi + bağlamsal şerit (Editor)
└──────────────────────────────┘
```

- **Sık ve birincil eylemler alt üçte birde.** Arama mobilde üst barda ikon olarak durur ama açıldığında giriş alanı ve ileri/geri denetimleri klavyenin hemen üstündedir.
- Yıkıcı eylemler (sil) birincil eylemin bitişiğine konmaz; aralarında ≥ 16 px ve farklı görsel ağırlık.
- Tek elle kullanım: tüm Viewer akışı (aç → oku → ara → sayfaya git → düzenle) alt üçte birden tamamlanabilir.
- Sol el desteği: FAB ve hızlı kaydırma tutamacı ayarlardan sola alınabilir.

### 2.4 Ekran İskeletleri (Kompakt)

**Viewer**
- Üst bar 48 px (+ safe-area): `←` · belge adı · 🔍 · `⋯`. Kaydırınca gizlenir, yukarı kaydırınca/dokununca gelir.
- Sağ alt: FAB **Düzenle** (56 px; etiketli genişletilmiş hali 48 px yükseklik).
- Alt orta: sayfa hapı "12 / 148" (dokun → sayfaya git + thumbnail sheet).
- Sağ kenar: hızlı kaydırma tutamacı (kaydırma başlayınca belirir; 44×56 px dokunma alanı).

**Editor**
- Üst bar 48 px: `✓ Bitti` · durum · ↶ ↷ · 👁 · **Kaydet**.
- Alt **araç şeridi** 56 px (+ safe-area): 5 görünür araç + "Daha fazla"; yatay kaydırılabilir, etkin araç dolu.
- Seçim/araç etkinken araç şeridinin **üstünde** 48 px **bağlamsal şerit** (02 §5.5). İkisi birlikte ≤ 104 px; klavye açıkken yalnızca bağlamsal şerit klavyenin üstüne taşınır.

### 2.5 Kompakt Üst Bar Kuralları
- En fazla **4 etkileşimli öğe**; fazlası `⋯` menüsüne.
- Belge adı tek satır, ortadan kısaltma; dokununca belge bilgisi/yeniden adlandır.
- Yükseklik sabit 48 px (mod değişiminde layout kayması yok); içerik `env(safe-area-inset-top)` kadar aşağıda.
- Yatay telefonda bar 40 px ve otomatik gizlenen.

---

## 3. Bottom Sheet Sistemi

### 3.1 Tek Ortak Bileşen: `Sheet`
Bugünkü 4 ayrı sheet (Pages/Tools/Inspector/Export) tek bir **kademeli sheet ilkeline** dayandırılır.

| Kademe (detent) | Yükseklik | Kullanım |
|---|---|---|
| **Peek** | 64–96 px | Bağlamsal özet (seçili nesne adı + 3–4 hızlı eylem) |
| **Yarım** | Ekranın ~%45'i | Özellikler, araç seçenekleri, arama sonuçları |
| **Tam** | Üst safe-area'ya kadar (−8 px) | Thumbnail ızgarası, outline, tüm özellikler, imza oluşturma |

Davranış:
- **Tutamaç (grabber)** 36×4 px görsel, 44 px yüksekliğinde dokunma şeridi. Sürükleyerek kademe değiştirme; bırakınca **hız + konum** ile en yakın kademeye yaylı oturma.
- İçerik kaydırması ile sheet sürüklemesi **devir teslimi**: içerik en üstteyken aşağı çekmek sheet'i küçültür; Tam kademede içerik kaydırılır.
- **Modal olmayan** (Peek/Yarım, arkadaki kâğıt etkileşimli) ve **modal** (Tam veya karar gerektiren; karartma + dışına dokununca kapanır) türleri.
- Sheet açıkken kâğıt, seçili nesne görünür kalacak şekilde **otomatik kaydırılır** (sheet nesneyi kapatmaz).
- Klavye açıldığında sheet, `visualViewport` yüksekliğine göre yeniden konumlanır; giriş alanı klavye üstünde kalır.
- Sistem geri jesti / Android geri tuşu / `Esc`: önce bir alt kademeye, sonra kapat (History API girdisi ile).
- Erişilebilirlik: `role="dialog"`, modal türde odak tuzağı; kademeler için klavye/ekran okuyucu düğmeleri ("genişlet/daralt"); `prefers-reduced-motion`'da anında oturma.
- Uygulama: `transform: translateY` ile GPU'da; sürükleme sırasında React state güncellenmez (ref + rAF), bırakınca tek commit.

### 3.2 Masaüstü Paneli → Mobil Sheet Eşlemesi

| Masaüstü | Kompakt | Orta | Varsayılan kademe |
|---|---|---|---|
| Thumbnail kenar çubuğu | "Sayfalar" sheet'i (3 sütun sanal ızgara) | Sol yan sheet | Tam |
| Outline paneli | Aynı sheet'te ikinci sekme | Aynı | Tam |
| Sağ denetçi | "Özellikler" sheet'i; Peek'te bağlamsal özet | Sağ yan sheet 360 px | Peek → Yarım |
| Nesneler/katman paneli | Özellikler sheet'inde sekme | Sağ yan sheet sekmesi | Yarım |
| Arama sonuç listesi | Sonuç sheet'i | Sağ yan sheet | Yarım |
| Dışa aktar / paylaş menüsü | Eylem sheet'i (liste) | Popover | İçerik kadar |
| Bağlam (sağ tık) menüsü | Uzun bas → eylem sheet'i veya yüzen menü | Popover | İçerik kadar |
| İmza / sayfa numarası / böl modalleri | Tam sheet | Ortalanmış diyalog | Tam |

Aynı anda **en fazla bir** sheet açık olur; yenisi öncekinin yerini alır (yığın yok). İstisna: sheet üstünde onay diyaloğu.

### 3.3 Denetçinin Mobilde Yeniden Kurgusu
`RightInspector`'ı sheet'e gömmek yerine özellikler **gruplanmış kartlara** bölünür (Metin, Görünüm, Konum/Boyut, Düzen). Peek: 4 hızlı eylem. Yarım: ilk iki grup. Tam: tüm gruplar. Sayısal alanlar için adım düğmeleri (−/+ , 44 px) ve basılı tutunca hızlanan artış; kaydırıcılar 44 px dokunma yüksekliğinde.

---

## 4. Dokunma Hedefleri ve Ergonomi

- **Minimum 44×44 CSS px** tüm etkileşimli öğelerde (birincil eylemler 48 px). Görsel boyut küçük olabilir; dokunma alanı görünmez dolgu ile büyütülür.
- Hedefler arası **≥ 8 px** boşluk; dokunma alanları çakışmaz.
- **Seçim tutamaçları:** görsel 12 px (coarse pointer'da 14 px), dokunma alanı **44 px**. Nesne küçükken çakışmayı önleme:
  - Kenar < 88 px → kenar ortası tutamaçları gizlenir, yalnızca 4 köşe.
  - Kenar < 56 px → dokunma alanları nesnenin **dışına** doğru kaydırılır; gövde sürükleme alanı korunur.
  - Çok küçük nesnede (< 32 px) tek "boyutlandır" köşe tutamacı + gövde taşıma; hassas ayar Peek sheet'teki adım düğmelerinden.
- **Döndürme tutamacı:** nesnenin üstünde 32 px mesafede (ekran kenarına yakınsa altta); 44 px alan; aralarında ince bağlantı çizgisi.
- Ekran kenarı güvenli bölgesi: sistem geri jestiyle çakışmamak için sol/sağ 16 px içinde sürüklenebilir öğe başlatılmaz; alt `safe-area-inset-bottom` içinde kontrol yok.
- Metin girişleri ≥ 16 px (iOS otomatik zoom yok); `inputmode`/`enterkeyhint` doğru ayarlı.
- Dokunsal geri bildirim (destekleyen cihazlarda `navigator.vibrate` 8–10 ms): snap yakalama, uzun bas tanınması, kademe oturması.
- Otomatik test: Playwright'ta tüm `button, [role=button], a, input` öğeleri için 44 px denetimi (kompakt görünümde).

---

## 5. Dokunmatik Jest Motoru (Touch Gesture Engine)

### 5.1 Mimari

```
Tek kök dinleyici (viewport öğesi, Pointer Events, capture)
        │  ham pointer akışı (getCoalescedEvents ile)
        ▼
  PointerTracker ──▶ GestureArena (hakem)
                        ├─ PinchZoomRecognizer      (2 parmak)
                        ├─ PanRecognizer            (1 parmak, boş alan / Viewer)
                        ├─ ElementDragRecognizer    (1 parmak, seçili nesne)
                        ├─ HandleDragRecognizer     (boyut / döndürme tutamacı)
                        ├─ ToolStrokeRecognizer     (çizim, vurgu, şekil, yol)
                        ├─ TapRecognizer / DoubleTap / LongPress
                        └─ TextSelectionRecognizer  (Viewer)
                        ▼
              Kazanan jest → GestureSession (begin / update / end / cancel)
                        ▼
        ViewportController (transform)  |  EditorController (transaction)
```

İlkeler:
1. **Tek giriş kanalı:** Yalnızca Pointer Events. Touch Events yedeği kaldırılır (hedef tarayıcılar: iOS Safari 15+, Chrome/Android güncel). (T3)
2. **Tek kök dinleyici:** Araç başına `window` dinleyicileri kaldırılır; tanıyıcılar arena üzerinden beslenir. `setPointerCapture` kök öğede. (T5)
3. **Merkezi hakem:** Aynı anda tek jest oturumu "sahip" olur. Özel `window` olayları ve dağınık zamanlayıcılar kalkar.
4. **React dışı sıcak yol:** Jest durumu store'a girmez; kareler `requestAnimationFrame` içinde doğrudan transform/ref ile. Store'a yalnızca `end` anında tek commit (mevcut `beginTransaction/commitTransaction` modeli korunur).
5. **Hit-test çekirdekte:** `pointerdown` anında çekirdek `hit_test` çağrılır (01 §5.3); sonuç arenaya aday listesini verir.

### 5.2 `touch-action` Stratejisi (T4 düzeltmesi)
`touch-action` **statik** belirlenir, jest sırasında değiştirilmez:

| Yüzey | `touch-action` | Sonuç |
|---|---|---|
| Viewport (kâğıt alanı) | `none` | Kaydırma, pinch ve momentum **motor tarafından** yönetilir (tutarlı davranış, tarayıcı farkı yok) |
| Sheet içerikleri, listeler | `pan-y` | Yerel kaydırma |
| Araç şeritleri (yatay) | `pan-x` | Yerel yatay kaydırma |
| Tutamaçlar, sheet grabber | `none` | Motor/sheet sürüklemesi |

Viewport'ta yerel kaydırmadan vazgeçme kararı bilinçlidir: yerel kaydırma ile özel pinch'in aynı öğede karışması bugünkü çift-yol karmaşıklığının kaynağıdır. Bedeli, ataletin motor tarafından uygulanmasıdır (§5.5). Masaüstü fare tekerleği/trackpad kaydırması yerel `wheel` olayıyla aynı `ViewportController`'a beslenir. Bu karar bir prototiple (iOS Safari + düşük sınıf Android'de kare süresi ölçümü) doğrulanmadan kesinleştirilmez; başarısız olursa yedek plan: tek parmak kaydırma yerel (`pan-x pan-y`), pinch motor (bugünkü model, sadeleştirilmiş).

### 5.3 Hakemlik Kuralları (Öncelik Tablosu)

| Durum | Koşul | Kazanan |
|---|---|---|
| 2. parmak indi | Her zaman | **Pinch/iki parmak pan.** Süren tek parmak jesti **iptal** edilir (sürükleme başlangıç konumuna döner, çizim taslağı atılır) |
| 1 parmak, tutamaç üzerinde | — | HandleDrag (hemen, eşiksiz) |
| 1 parmak, **seçili** nesne üzerinde | Hareket > slop | ElementDrag |
| 1 parmak, seçili olmayan nesne üzerinde (Editor) | Hareket > slop | **Pan** (kaydırma). Nesne yalnızca `tap` ile seçilir; **"önce seç, sonra sürükle"** kuralı kaymaları önler (T7) |
| 1 parmak, seçili olmayan nesne, uzun bas (400 ms, hareket < slop) | — | Seç + ElementDrag'e geç (dokunsal geri bildirim) |
| 1 parmak, çizim/vurgu/şekil aracı etkin | — | ToolStroke (hemen). Kaydırma iki parmakla |
| 1 parmak, boş alan | Hareket > slop | Pan |
| 1 parmak, Viewer, metin üzerinde uzun bas | 400 ms | TextSelection |
| Hareket < slop, süre < 300 ms | — | Tap; 300 ms içinde aynı yerde ikinci → DoubleTap (akıllı zoom) |

Sabitler: **slop** = 10 px (dokunma), 4 px (fare), 6 px (kalem); uzun bas 400 ms; çift dokunuş aralığı 300 ms / 24 px.
`pointercancel` (sistem jesti, gelen arama, sekme değişimi) → etkin oturum `cancel` ile **geri alınır**, yarım durum kalmaz.

**Avuç içi/yanlış dokunuş koruması:** Kalem (`pointerType: 'pen'`) etkinken dokunma girdisi çizim başlatmaz (yalnızca pan/pinch). Pinch bittikten sonra 150 ms içinde kalan parmağın hareketi yeni jest başlatmaz (bırakma titremesi).

### 5.4 Pinch-to-Zoom
- **Odak korunumu:** İki parmağın orta noktasındaki belge noktası jest boyunca parmakların altında kalır; orta nokta hareketi eşzamanlı kaydırma olarak uygulanır (zoom + pan tek transform).
- **Canlı aşama:** Yüzey `transform: translate3d() scale()` ile GPU'da ölçeklenir (mevcut model). Mevcut karolar gerilir; arkada düşük çözünürlüklü önizleme boşlukları kapatır. React render yok.
- **Sınırlar:** %25–%500 (mobilde alt sınır = "sayfaya sığdır"). Sınır ötesinde **lastik direnç** (aşımın 1/3'ü), bırakınca 200 ms yaylı geri dönüş.
- **Yapışma:** "Genişliğe sığdır" değerinin ±%4'ünde hafif mıknatıs + dokunsal tık; zoom modu buna göre `fit-width` olur.
- **Commit:** Bırakınca tek zoom güncellemesi; yeni ölçek karoları öncelik sırasıyla istenir, gelene kadar gerilmiş karolar ekranda kalır (boş kare yok).
- **Parmak sayısı değişimi:** 3. parmak yok sayılır; bir parmak kalkarsa oturum pan olarak **kesintisiz devam eder** (yeniden çapalama ile sıçrama yok).
- Trackpad pinch (`wheel` + `ctrlKey`) ve Safari `gesture*` olayları aynı denetleyiciye bağlanır.

### 5.5 Ataletli Kaydırma (Inertial Pan)
- Hız kestirimi: son ~100 ms'lik örneklerden ağırlıklı ortalama (coalesced events ile); bırakmadan önce 40 ms duraksama varsa atalet yok.
- Yavaşlama: üstel sürtünme (zaman sabiti ~325 ms; platform hissine yakın), kare hızından bağımsız (delta-time ile).
- **Kenar davranışı:** Belge sınırında lastik aşım + geri yaylanma (iOS hissi); Android'de aşım mesafesi kısaltılır.
- **Eksen kilidi:** İlk 10 px'te baskın eksen > %80 ise diğer eksen kilitlenir (dikey okurken yatay kayma olmaz); sayfa genişlikten taşmıyorsa yatay eksen tamamen kilitli.
- Dokunuş, süren ataleti **anında durdurur**; bu dokunuş tap sayılmaz.
- Atalet sırasında karo istekleri hız eşiğinin üstünde ertelenir (01 §6.3).
- Sayfa-sayfa modunda: hız/konum eşiğiyle bir sonraki sayfaya yaylı oturma.

### 5.6 Nesne Sürükleme, Boyutlandırma, Döndürme
- **Sürükleme:** Parmak ile nesne arasındaki başlangıç ofseti korunur. Canlı aşamada yalnızca nesnenin overlay öğesi transform edilir. Akıllı kılavuzlar (mevcut `snapGuides`) 6 px ekran toleransı ile; yakalamada dokunsal tık. Hız yüksekken snap devre dışı (hızlı taşıma takılmaz).
- **Kenar otomatik kaydırma:** Parmak viewport kenarının 48 px içine girince, mesafeyle orantılı hızda otomatik kaydırma; sayfalar arası taşıma desteklenir.
- **Parmak örtmesi:** Küçük nesne sürüklerken nesne parmağın altında kaldığı için, parmağın üstünde konum/ölçü balonu (x, y veya G×Y) gösterilir.
- **Boyutlandırma:** Köşe tutamaçları varsayılan **oran korumalı** (görsel/imza); metin kutusunda kenar tutamaçları genişliği değiştirir. Döndürülmüş nesnede mevcut `computeRotatedResizeRect` matematiği çekirdekten.
- **Döndürme:** Tutamaç ile; 0/45/90… derecelerde ±3° mıknatıs + dokunsal tık; açı balonu. Ek olarak **seçili nesne üzerinde iki parmakla** döndür+ölçekle jesti (iki parmak da nesne sınırları içindeyse nesneye, değilse viewport'a gider).
- **Yanlış tetikleme önlemleri:** Sürükleme başlamadan önce slop; tutamaç dokunma alanı gövde alanına göre önceliklidir; jest sırasında bağlamsal şerit ve tutamaçlar gizlenir; bırakınca 100 ms içinde gelen tap yok sayılır.
- **İptal:** İkinci parmak veya `pointercancel` → transaction `abort`, nesne başlangıç durumuna animasyonla döner.

### 5.7 Metin Seçimi ve Metin Düzenleme (Dokunmatik)
- **Viewer seçimi:** Uzun bas → kelime seçimi; iki damla tutamaç (44 px alan) sürüklenerek genişletme; tutamaç sürüklenirken parmağın üstünde **büyüteç**; kenarda otomatik kaydırma. Seçim geometrisi çekirdek metin span'lerinden (satır/sütun sırasına duyarlı).
- **Editor'da metin düzenleme:** Metin kutusuna tap → seç; ikinci tap → düzenleme (klavye açılır). Klavye açıkken sayfa, imleç satırı klavye + bağlamsal şeridin üstünde kalacak şekilde kaydırılır (`visualViewport`). Düzenleme sırasında pinch serbest, tek parmak pan serbest; kutunun dışına tap düzenlemeyi bitirir.
- **İmza yerleştirme:** "Dokunarak yerleştir" yerine: imza seçilince viewport ortasına **hayalet** olarak gelir, sürüklenip boyutlandırılır, "Yerleştir" ile onaylanır (parmak altında kör yerleştirme sorunu kalkar).

### 5.8 Çizim Araçları
- `getCoalescedEvents()` ile tüm ara noktalar; `getPredictedEvents()` ile 1 kare öngörü (gecikme hissi azalır, öngörülen noktalar commit edilmez).
- Canlı çizim ayrı bir **taslak canvas**'ta (düşük gecikme: `desynchronized: true` denenir); bırakınca nokta sadeleştirme (mevcut yumuşatma) ve tek eleman olarak commit.
- Basınç (`pressure`) ve kalem eğimi destekleyen cihazlarda çizgi kalınlığına yansır; kalemin silgi ucu/düğmesi silgiye eşlenir.
- Çizim modunda kaydırma **iki parmakla**; ilk kullanımda tek seferlik ipucu.

---

## 6. PWA ve Mobil Web Entegrasyonu

- **Manifest `file_handlers`** (`application/pdf`) + `launchQueue`: Masaüstü Chrome/Edge ve ChromeOS'ta kurulu PWA "Birlikte aç" listesinde görünür. Android Chrome ve iOS Safari'de PWA dosya işleyicisi **desteklenmez** → mobilde gerçek "Birlikte Aç" için yerel uygulama şarttır (04).
- **`share_target`** (POST, dosya): Android'de kurulu PWA paylaşım sayfasında görünür; Service Worker gelen dosyayı alıp Viewer'da açar. iOS'ta desteklenmez.
- **File System Access API** (varsa): yerinde kaydet / farklı kaydet; yoksa indirme + Web Share.
- **Çevrimdışı:** Viewer kabuğu + motor Wasm precache; fontlar ve Editor chunk'ı ilk kullanımda çalışma zamanı önbelleğine (ilk yük küçülür). Güncelleme: "Yeni sürüm hazır — yenile" toast'ı (belge açıkken sessiz `skipWaiting` yapılmaz; bugünkü `autoUpdate + skipWaiting` açık belgede riskli).
- **Oturum kurtarma:** Otomatik kayıt OPFS/IndexedDB'ye; açılışta "Kaldığın yerden devam et".
- Sayfa düzeyinde tarayıcı zoom'u yalnızca viewport öğesinde engellenir; erişilebilirlik için global `user-scalable=no` **kullanılmaz**.

---

## 7. Test ve Kabul Ölçütleri

**Cihaz matrisi:** iPhone SE (375×667), iPhone 15 (393×852), orta sınıf Android (360×800, 4 GB RAM), düşük sınıf Android (2–3 GB), iPad (dikey/yatay, kalem), Android tablet. Tarayıcılar: Safari iOS, Chrome Android, Samsung Internet.

**Otomatik:** Playwright dokunma emülasyonu ile jest senaryoları (CDP `Input.dispatchTouchEvent` ile çok parmak); tanıyıcılar ve arena için saf birim testleri (zaman/olay dizisi beslemeli — DOM'suz); 44 px hedef denetimi; görsel regresyon (kompakt/orta/geniş).

**Ölçütler:**
- Pinch ve atalet boyunca kare süresi p95 ≤ 16,7 ms (orta sınıf Android), düşen kare < %1.
- Pinch odak noktası sapması ≤ 2 px; parmak sayısı değişiminde sıçrama yok.
- 50 denemelik "kaydırırken yanlışlıkla nesne taşıma" testinde 0 yanlış tetikleme; "nesne sürüklerken yanlışlıkla kaydırma" 0.
- İkinci parmak indiğinde süren sürükleme/çizim %100 geri alınır.
- Kompakt görünümde 44 px altında etkileşimli hedef yok; tüm Viewer akışı tek elle tamamlanır.
- Sheet sürükleme 60 fps; klavye açıkken hiçbir giriş alanı örtülmez.
