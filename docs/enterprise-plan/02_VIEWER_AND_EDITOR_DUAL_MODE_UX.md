# 02 — Viewer / Editor Çift Mod UX ve Tasarım Sistemi

> Kapsam: Viewer-öncelikli açılış, Viewer yetenekleri, tek tuşla Edit geçişi, enterprise tasarım sistemi.
> Durum: **Sadece planlama.** Teknik altyapı için bkz. [01](01_SYSTEM_AUDIT_AND_CORE_ARCHITECTURE.md); mobil düzen için [03](03_MOBILE_FIRST_WEB_AND_TOUCH_ENGINE.md).

---

## 1. Bugünkü Durum (Denetim Özeti)

- Uygulama **doğrudan editör** olarak açılır; ayrı bir okuma modu yoktur. PDF açıldığı anda ~25 kontrollü araç çubuğu, sağ denetçi paneli ve thumbnail kenar çubuğu görünür.
- Her sayfa mount olduğunda düzenleme için metin/görsel/şekil analizi çalışır (01 → P3); okuyan kullanıcı da bu maliyeti öder.
- Sayfa üzerindeki tek dokunuş "akıllı hit-test" ile metni/görseli düzenlenebilir elemana dönüştürebilir → **okurken yanlışlıkla düzenleme** riski.
- Viewer'ın temel yetenekleri yok: metin seçimi/kopyalama, arama, outline, bağlantılar, sepya tema, sayfaya git.
- Okunabilirlik: arayüzde `text-[11px]` 139, `text-[10px]` 65, `text-[9px]` 7 kez kullanılıyor; `text-sm` yalnızca 14 kez. Gövde metni fiilen 11 px.
- Dil karışık: "Open PDF File", "Load Sample PDF", "Page 3", "Delete Page" ile "Boş Sayfa ile Başla", "Sayfalar", "Özellikler" aynı ekranlarda. `<html lang="en">`.
- Thumbnail hızlı eylemleri yalnızca hover'da görünür (dokunmatikte erişilemez), ikonlar 12 px.

---

## 2. Mod Modeli

### 2.1 Durum Makinesi

```
            dosya aç / "Birlikte Aç"
 [Boş] ───────────────────────────────▶ [VIEWER] ◀──────────────┐
                                           │  ▲                 │
                         "Düzenle" (E)     │  │ "Bitti/Önizle"  │
                                           ▼  │   (Esc)         │
                                        [EDITOR] ──────────────▶│
                                           │      Kaydet / Dışa aktar
                                           ▼
                                   [EDITOR · araç aktif]  (metin, çizim, imza…)
```

- **Varsayılan mod her zaman VIEWER.** İstisna: "Boş sayfa ile başla" → doğrudan EDITOR.
- Mod, `viewStore.mode: 'view' | 'edit'` olarak tek yerde tutulur; URL/derin bağlantı ve oturum kurtarmada saklanır.
- Mod geçişi **görünüm çapası** korur: `(pageId, sayfa içi normalize x/y, zoom, zoomMode)`. Geçişte kaydırma konumu ve zoom **değişmez**.

### 2.2 Modlara Göre Yetkinlik Matrisi

| Yetenek | Viewer | Editor |
|---|---|---|
| Kaydırma, zoom, sayfa gezinme, thumbnail, outline, arama | ✅ | ✅ |
| Metin seçimi + kopyalama | ✅ | ➖ (yalnızca "Seç" aracında boş alanda) |
| Bağlantılara tıklama | ✅ | ❌ (yanlış tetiklemeyi önlemek için) |
| Okuma temaları (Açık/Koyu/Sepya) | ✅ | Kâğıt daima gerçek renk; kabuk teması geçerli |
| Hızlı işaretleme (vurgula, not, imza at) | ✅ *hafif* — seçim menüsünden | ✅ tam |
| Özgün metin/görsel düzenleme, şekil, yol, kırpma, maske | ❌ | ✅ |
| Sayfa düzenleme (sırala, döndür, sil, birleştir, böl) | ❌ (yalnızca görüntüle) | ✅ |
| Sayfa analizi (metin blokları/görseller) | **Çalışmaz** | Tembel, görünür sayfalar için |
| Yüklenen kod | Viewer chunk'ı | + Editor chunk'ı (talep anında) |

"Hafif işaretleme" kararı: Viewer'da metin seçince çıkan menüde *Kopyala · Vurgula · Altını çiz · Not* bulunur; ilk işaretleme belgeyi "değişmiş" yapar ve Kaydet eylemini görünür kılar, ancak tam editör arayüzü açılmaz. (**K4 onaylandı:** hafif işaretleme Viewer'da kalır.)

---

## 3. Viewer Modu

### 3.1 Düzen
- **Üst bar (48–56 px):** Geri/Dosya · belge adı (tek satır, kısaltmalı) · Ara · **Düzenle** (birincil, dolu buton) · Taşma menüsü (⋯: Paylaş, Yazdır, Tema, Belge bilgisi, Farklı kaydet).
- **İçerik:** Kenardan kenara kâğıt; başka hiçbir kalıcı panel yok.
- **Alt/yan yüzen öğeler:** Sayfa göstergesi hapı ("12 / 148", dokununca "Sayfaya git") ve zoom hapı. 2,5 sn hareketsizlikte ve kaydırırken soluklaşır.
- **Sürükleyici okuma:** Kâğıda tek dokunuş/tık üst barı ve hapları gizler/gösterir (mobil); masaüstünde bar kalıcıdır.
- **Çekmece (Drawer):** *Sayfalar* (thumbnail) ve *İçindekiler* (outline) sekmeleri; masaüstünde sol panel (daraltılabilir, varsayılan kapalı), mobilde alt sheet (03).

### 3.2 Kaydırma Modları
- **Sürekli dikey** (varsayılan), **sayfa sayfa** (snap; yatay kaydırma ile, sunum/okuma için), masaüstünde isteğe bağlı **iki sayfa yan yana**.
- Klavye: `PgUp/PgDn`, `Space/Shift+Space`, `Home/End`, ok tuşları, `Ctrl+G` sayfaya git.
- Mobilde hızlı kaydırma tutamacı (scrubber): sağ kenarda sürüklenince sayfa numarası balonu.

### 3.3 Akıllı Zoom
- Önayarlar: **Genişliğe sığdır** (mobil varsayılan), **Sayfaya sığdır** (masaüstü varsayılan; yatay sayfada genişlik), **%50–%400** kademeleri, **Gerçek boyut (%100)**.
- Çift dokunuş/çift tık: dokunulan **metin sütununa/bloğuna sığdır** ↔ önceki zoom (metin katmanı geometrisinden; blok bulunamazsa 2×).
- `Ctrl/⌘ + tekerlek`, `Ctrl +/−/0`, trackpad pinch; odak noktası imleç/parmak ortası.
- Zoom modu yeniden boyutlandırma ve yön değişiminde korunur (fit modları yeniden hesaplanır, özel zoom aynen kalır).

### 3.4 Metin Seçimi ve Kopyalama
- Çekirdekten gelen `text_spans(page)` ile görünür sayfalara **saydam metin katmanı**. Katman yalnızca görünür ± 1 sayfa için kurulur.
- Masaüstü: yerel tarayıcı seçimi; `Ctrl+C`, `Ctrl+A` (sayfa/doküman seçeneği).
- Mobil: uzun bas → kelime seçimi → özel tutamaçlar + büyüteç; yüzen menü (*Kopyala · Vurgula · Ara · Paylaş*). (Jest ayrıntısı: 03.)
- Taranmış (metinsiz) sayfalarda: "Bu sayfada seçilebilir metin yok" ipucu; OCR kapsam dışı, ileri faz notu.
- Kopyalama izni kısıtlı (owner-password) belgelerde seçim/kopyalama devre dışı ve nedeni gösterilir.

### 3.5 Doküman İçi Arama
- `Ctrl/⌘+F` (masaüstü: sağ üstte satır içi arama çubuğu) · mobil: üst barı kaplayan arama çubuğu + klavye üstünde "önceki/sonraki" şeridi.
- Arama **worker'da ve akış halinde**: görünür sayfadan başlayıp dışa doğru; sonuç sayısı kademeli güncellenir ("37+ sonuç"). 250 ms debounce.
- Seçenekler: büyük/küçük harf, tam kelime; Türkçe'ye duyarlı katlama (`İ/i`, `I/ı`) ve aksan duyarsızlığı varsayılan.
- Tüm eşleşmeler sarı, etkin eşleşme turuncu; kaydırma çubuğunda eşleşme işaretleri (masaüstü); sonuç listesi paneli (sayfa + bağlam satırı).
- `Enter / Shift+Enter` ileri/geri; `Esc` kapatır ve konumu korur.

### 3.6 İçindekiler ve Thumbnail Çekmecesi
- **İçindekiler:** PDF outline ağacı; daraltılabilir düğümler, etkin bölüm vurgusu, dokununca hedefe git. Outline yoksa sekme gizlenir (boş durum göstermek yerine).
- **Sayfalar:** Sanal ızgara; etkin sayfa çerçevesi; Viewer'da yalnızca gezinme. Sayfa işlemleri (sil/döndür/sırala) yalnızca Editor'da görünür.
- Thumbnail'lar bayt bütçeli önbellekten; hızlı kaydırmada yer tutucu + sayfa numarası.

### 3.7 Okuma Temaları
| Tema | Kabuk | Kâğıt |
|---|---|---|
| Açık | Açık gri zemin | Özgün renkler |
| Koyu | Koyu zemin | Varsayılan: özgün kâğıt, kısık parlaklık. Seçenek: "Koyu kâğıt" (parlaklık tersleme; görseller korunur) |
| Sepya | Sıcak koyu-bej zemin | Sepya ton (çarpım harmanı); görseller hafif ısıtılır |

- Tema, karo anahtarının parçasıdır (01 §6.2) veya GPU filtresi ile uygulanır; karar performans ölçümüne bırakılır. **Dışa aktarımı asla etkilemez.**
- Sistem temasını izle (varsayılan) + elle seçim; tercih cihazda saklanır.

---

## 4. Edit Moduna Geçiş ve Dönüş

### 4.1 "Düzenle" Girişi
- **Masaüstü/tablet:** Üst barda sağda dolu birincil buton **"Düzenle"** (kalem ikonu + etiket). Kısayol: `E`.
- **Mobil:** Sağ altta başparmak bölgesinde **genişletilmiş FAB "Düzenle"**; kaydırırken yalnızca ikona küçülür, durunca etiket geri gelir.
- Salt okunur/şifre kısıtlı belgede buton "Düzenle (kopya üzerinde)" olur ve açıklama gösterir.

### 4.2 Geçiş Koreografisi (≤ 300 ms, kâğıt sabit)
1. `mode = 'edit'`; **kâğıt ve kaydırma konumu yerinden oynamaz.** Görünüm çapası alınır.
2. Üst bar, Editor üst barına çapraz geçiş yapar (aynı yükseklik → layout kayması yok). Mobilde FAB, alt araç şeridine morph olur.
3. Masaüstünde denetçi paneli içerikten yer çalmadan **kâğıdın üzerine kayan panel** olarak gelir; kullanıcı sabitlerse düzen yeniden akar ve çapa ile zoom/konum telafi edilir.
4. Editor chunk'ı ve görünür sayfaların analizi arka planda başlar; hazır olana dek sayfa köşesinde ince ilerleme göstergesi. Kullanıcı bu sırada kaydırabilir; ekleme araçları (metin, çizim, imza, şekil) analiz beklemeden kullanılabilir.
5. Analiz bitince özgün metin/görsel üzerine gelindiğinde düzenlenebilirlik ipucu (ince kesikli çerçeve) görünür.

İlk geçişte tek seferlik 1 cümlelik ipucu: "Metne dokunarak düzenleyin, araçlar aşağıda."

### 4.3 Editor Düzeni
- **Üst bar:** ✓ **Bitti** (sol/başta) · belge adı + durum rozeti ("Kaydedildi" / "Değişiklikler var") · Geri al / Yinele · **Önizle** (göz) · **Kaydet/Paylaş** (birincil).
- **Araç şeridi (tek seviye, 7 araç):** Seç · Metin · İmza · Çizim · Vurgula · Şekil · Görsel. "Daha fazla": Yol/Kalem, Sayfa numarası, Redaksiyon.
- **Bağlamsal araç çubuğu:** Yalnızca seçim veya aktif araç varken; seçilen nesnenin **en sık 4–6** özelliği (bkz. §5.5). Tüm özellikler "Tüm özellikler" ile denetçide.
- **Sayfa düzenleme** ayrı bir alt-mod: Sayfalar çekmecesi Editor'da sürükle-bırak sıralama, çoklu seçim, döndür/sil/çoğalt/boş sayfa ekle/birleştir/böl eylemleriyle açılır.

### 4.4 Çıkış: "Bitti" ve "Önizle"
- **Önizle (göz):** Geçici, basılı tut veya aç/kapa. Tüm düzenleme süsleri (tutamaç, çerçeve, kılavuz) gizlenir; sonuç, dışa aktarım boru hattıyla aynı motor üzerinden gösterilir (01 → A1 sayesinde "gördüğün = aldığın").
- **Bitti:** Viewer'a döner; değişiklikler **oturumda kalır** (otomatik kayıt). Viewer üst barında "Düzenlendi" rozeti ve **Kaydet** eylemi belirir. Kaydetmeden belge kapatılırsa: *Kaydet · Kopya olarak kaydet · Vazgeç* diyaloğu.
- `Esc` sırası: açık menü → aktif araç → seçim → Edit modundan çık.
- Kaydetme semantiği (**K7:** varsayılan "Kopya olarak kaydet"; üzerine yazma ilk seferde onaylı) için bkz. 04 §6.

---

## 5. Enterprise Tasarım Sistemi

### 5.1 Tasarım Token'ları
Tek kaynak: CSS değişkenleri (`--gp-*`) + Tailwind tema eşlemesi. Bileşenlerde ham renk/piksel sınıfı (`text-[11px]`, `bg-slate-900`) kullanımı lint kuralı ile yasaklanır. Aynı token dosyası mobil uygulamaya (Flutter `ThemeExtension`) dışa aktarılır.

Katmanlar: **ilkel** (renk skalası, 4 px aralık ızgarası) → **anlamsal** (`surface/raised/overlay`, `text/primary|secondary|disabled`, `border`, `accent`, `danger`, `success`, `focus-ring`) → **bileşen** (`toolbar-height`, `sheet-radius`, `handle-size`).

### 5.2 Tipografi Hiyerarşisi

| Rol | Boyut / Satır | Ağırlık | Kullanım |
|---|---|---|---|
| Başlık L | 20 / 28 | 600 | Diyalog başlığı, boş durum |
| Başlık M | 16 / 24 | 600 | Panel/sheet başlığı |
| Gövde | **14 / 20** (mobil **16 / 24**) | 400 | Varsayılan metin, menü öğeleri, giriş alanları |
| Etiket | 13 / 18 (mobil 14 / 20) | 500 | Buton, sekme, form etiketi |
| Açıklama | **12 / 16** — alt sınır | 400–500 | Yardımcı metin, rozet, kısayol |
| Sayısal | 13 / 18, `tabular-nums` | 500 | Sayfa no, zoom %, ölçüler |

- **12 px altı metin yasak** (bugünkü 9–11 px kullanımlarının tamamı kaldırılır). Mobilde giriş alanları ≥ 16 px (iOS otomatik zoom'u önler).
- Font: sistem yığını (`system-ui`, Segoe UI, Roboto, SF) — ek font indirmesi yok, platforma doğal görünüm. Belge adı gibi uzun metinlerde tek satır + ortadan kısaltma.
- Yalnızca iki ağırlık (400/500) + başlıkta 600; tümü büyük harf etiket yok.

### 5.3 Renk ve Kontrast
- **Metin:** Gövde ≥ **7:1** (AAA), ikincil metin ≥ 4,5:1 (AA), devre dışı metin kontrast kuralından muaf ama ≥ 3:1 hedeflenir.
- **Metin dışı:** İkonlar, giriş kenarlıkları, seçim çerçevesi, odak halkası ≥ **3:1** (WCAG 1.4.11).
- Seçim/tutamaç rengi kâğıt içeriğinden bağımsız görünmeli: çift halka (beyaz dış + vurgu iç) korunur.
- Bilgi yalnızca renkle iletilmez (aktif araç: renk + dolgu + alt çizgi; hata: renk + ikon + metin).
- Tek vurgu rengi (mavi); başarı/uyarı/tehlike yalnızca anlamsal durumlarda. Bugünkü zümrüt/mavi/amber karışık birincil butonlar tek hiyerarşiye iner: **ekran başına tek birincil eylem.**
- Üç tema (Açık/Koyu/Sepya) için token setleri; kontrast CI'da otomatik denetlenir (axe + token çiftleri testi).

### 5.4 İkonografi
- Tek aile: **Lucide** (mevcut), tek çizgi kalınlığı (1,75), boyutlar yalnızca **20 px** (araç çubuğu) ve **24 px** (mobil dock/birincil). 12–14 px ikon yok.
- Her ikon-buton: `aria-label` + masaüstünde gecikmeli tooltip (ad + kısayol). İlk karşılaşmada anlamı belirsiz araçlarda (Yol, Maske, Redaksiyon) etiket kalıcıdır.
- Aynı kavram = aynı ikon sözlüğü (ör. "Paylaş" her yerde aynı; "Dışa aktar" ile karışmaz). Sözlük tasarım sistemi dokümanında tablo olarak tutulur.

### 5.5 Bağlamsal Araç Çubukları
Kural: **Kalıcı yüzeyde yalnızca her zaman geçerli eylemler; nesneye özgü her şey bağlamsal.**

| Seçim / araç | Bağlamsal çubuk (en fazla 6) | Taşma / denetçi |
|---|---|---|
| Metin | Font · Boyut · **K** / *İ* · Renk · Hizalama | Satır aralığı, opaklık, döndürme, konum |
| Görsel | Kırp · Değiştir · Opaklık · Öne/arkaya · Sil | Maske, çevir, döndürerek kopyala |
| İmza | Renk · Boyut · Tüm sayfalara uygula · Sil | Gerçekçi mürekkep, kilitle |
| Şekil | Dolgu · Kenar · Kalınlık · Köşe · Sil | Kesik çizgi, opaklık, düğüm düzenle |
| Çizim/Vurgula (araç aktif) | Renk · Kalınlık · Opaklık · Silgi | — |
| Çoklu seçim | Hizala · Dağıt · Grupla · Sil | — |

- Konum: masaüstünde seçimin üstünde yüzen (yer yoksa altında; kâğıt dışına taşmaz), mobilde alt şeritte sabit (03).
- Sürükleme/yeniden boyutlandırma sırasında çubuk gizlenir, jest bitince döner.
- Sağ tık / uzun bas menüsü yalnızca **eylemler** içerir (kopyala, çoğalt, sırala, kilitle, sil); özellik düzenleme içermez. Bugünkü 856 satırlık bağlam menüsü bu ayrıma göre sadeleşir.

### 5.6 Katman / Nesne Denetimi
- **Nesneler paneli** (Editor, etkin sayfa): eleman listesi — tür ikonu + ad + görünürlük + kilit; sürükleyerek z-sırası. Üç sabit grup: *Ön plan*, *İçerik*, *Arka plan* (mevcut `LayerTier` kavramıyla eşleşir).
- "Arka planı seç" bugün global bir kip düğmesi (`selectBackgroundMode`); yerine: arka plan nesneleri panelden seçilir veya üst üste binen nesnelerde **tekrarlı dokunuş/Alt+tık ile sıradakine geç** + "altındakini seç" bağlam eylemi.
- Üst üste binme durumunda seçim hapı: "Görsel · 2/3 ▸" (dokununca sıradaki).
- Kilitli nesne: seçilebilir, taşınamaz; kilit rozeti tutamaç yerine görünür.

### 5.7 Karmaşayı Azaltma Kuralları
1. Ekran başına **tek birincil eylem**; ikincil eylemler nötr.
2. Kalıcı krom ≤ 2 şerit (üst bar + mobilde alt şerit). Üçüncü şerit yalnızca bağlamsal ve geçici.
3. Aşamalı açığa çıkarma: varsayılan → "Daha fazla" → "Tüm özellikler".
4. Modal yalnızca geri alınamaz/kararlı işlerde (şifre, kaydetmeden çık, böl/dışa aktar seçenekleri). Diğer her şey sheet/popover.
5. Tam ekran bloklayan yükleme overlay'i kaldırılır; yerine iptal edilebilir ilerleme + iskelet.
6. Geri alınabilir işlemlerde onay diyaloğu yerine **"Geri al" içeren toast** (sayfa silme dahil).

### 5.8 Dil, Metin ve Erişilebilirlik
- **Ekranda tek dil, i18n altyapısı (K8):** Tüm metinler anahtar tabanlı sözlüğe. Varsayılan **`en`**, **`tr`** seçilebilir; yeni dil eklemek yalnızca sözlük dosyası eklemektir. İlk açılışta cihaz/tarayıcı dili `tr` ise Türkçe, aksi hâlde İngilizce; tercih ayarlardan değiştirilir ve saklanır. `<html lang>` dinamik. Bu dokümandaki Türkçe arayüz etiketleri (`Düzenle`, `Bitti`, `Önizle`…) Türkçe sözlüğün karşılıklarıdır; İngilizce karşılıkları `Edit`, `Done`, `Preview`… olur.
- **Ürün adı her yerde `gullacpdf`** (README, `package.json`, manifest, başlık, mağaza); "AetherPDF Studio" ve "wasm-pdf-editor" adları kaldırılır.
- Metin üslubu: fiil ile başlayan kısa etiketler ("Kaydet", "Sayfaya git"); teknik jargon ("Wasm Worker", "Compile") kullanıcı arayüzünden çıkar.
- Klavye: tüm işlevlere fare olmadan erişim; görünür odak halkası (2 px, ≥ 3:1); araç çubuklarında roving tabindex; `?` ile kısayol listesi.
- Ekran okuyucu: metin katmanı okunabilir sırada; sayfa değişimi `aria-live="polite"`; modal/sheet odak tuzağı ve kapanınca odağı geri verme.
- `prefers-reduced-motion`: geçişler çapraz solmaya iner; `prefers-contrast: more` için güçlendirilmiş kenarlık token'ları.
- Hedef: WCAG 2.2 **AA** tam uyum; metin kontrastında AAA.

---

## 6. Bileşen Kırılımı (hedef)

```
AppShell
 ├─ ViewerShell            (varsayılan chunk)
 │   ├─ ViewerTopBar, SearchBar, PageIndicator, ZoomPill
 │   ├─ DocumentViewport → PageShell(TileLayer, TextLayer, SearchHighlightLayer, LinkLayer)
 │   └─ NavigatorDrawer(ThumbnailGrid, OutlineTree)
 └─ EditorShell            (tembel chunk; ViewerShell'in viewport'unu paylaşır)
     ├─ EditorTopBar, ToolStrip, ContextualToolbar
     ├─ ElementLayer, ToolLayer, SelectionOverlay
     └─ InspectorPanel, ObjectsPanel, PageOrganizer
```

Kritik nokta: **Viewport tek ve ortaktır**; mod değişimi viewport'u yeniden mount etmez (konum/zoom korunumu ve anlık geçiş bunun sonucudur).

## 7. Kabul Ölçütleri
- PDF açıldığında hiçbir düzenleme kontrolü görünmez; ilk sayfa 01 §6.1 bütçesinde gelir.
- Viewer → Editor → Viewer turunda aynı sayfa noktası ekranda ± 2 px içinde kalır.
- 500 sayfalık belgede arama ilk sonucu < 300 ms, tam tarama arka planda UI'ı bloklamadan.
- Hiçbir metin < 12 px; tüm etkileşimli hedefler mobilde ≥ 44×44 px; axe taramasında 0 kritik ihlal.
- Seçili dilde (EN veya TR) arayüzün tamamı tek dil; karışık dilli ekran ve koda gömülü metin yok.
