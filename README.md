# BLOCK OPS: TACTICAL DRIFT

5v5 rekabetçi, voxel (blok) estetiğinde, parçalanabilir çevreli taktiksel nişancı.
**Sunucu:** Node.js + Socket.io (otoriter, 30 Hz) · **İstemci:** saf WebGL2 mini motor (sıfır 3D bağımlılık, tüm modeller kodla üretilir) · **Mobil:** Capacitor (iOS/Android).

```
npm install
npm start              # http://localhost:3000
npm test               # 26 otomatik test (fizik, isabet, ekonomi, bomba, haritalar, bombalar, zorluk, her haritada tam bot maçı)
```

### v2.3 yenilikleri
- **Yerdeki silahlar (CS gibi):** ölünce silah düşer, **G** ile at, üstünden geç / **E** ile değiştir; yeni silah alınca eskisi yere düşer.
- **Arkadaş sistemi:** her cihazın kalıcı arkadaş kodu; ekleme bildirimi, çevrimiçi/maçta durumu, davet et, tek dokunuşla katıl (hesap/veritabanı gerekmez).
- **Sohbet:** **Y** herkese, **U** takıma yazılı sohbet; **V** bas-konuş veya açık mikrofonla **takım sesli sohbeti** (WebRTC, ses doğrudan oyuncular arasında akar).
- **Grafik seviyeleri:** Düşük / Orta / Yüksek / Ultra + *Otomatik*: ekran kartı, RAM ve çekirdek sayısından cihazı algılar, FPS düşerse kendini bir kademe indirir.
- **Görsel:** detaylı karakterler (yelek, çanta, telsiz, kask, dizlik...), ayak altı gölgeleri, renk düzenleme, parlayan lambalar ve pencereler, piksel kırpışmalarına (T-junction) düzeltme.
- **Hareket:** koşu hızı 7.4 m/sn, daha çevik ivmelenme.
- **Giriş ekranı:** sinematik kamera ve ajan vitrini, animasyonlu logo, canlı oyuncu sayısı, yenilikler kartı.
- **Mobil buton düzenleyici:** Ayarlar → Butonları Düzenle: sürükle, boyutla, saydamlık, kaydet/sıfırla.

### v2.0 yenilikleri
- **3 harita:** Dustgrid (çöl), Harbor (liman, kapalı depo B bölgesi), Frostbite (karlı köy, mağara geçidi). Her maç sonunda sıradaki haritaya geçilir.
- **Kolay / Orta / Zor:** Botların tepki süresi, nişan hatası, sprey kontrolü, görüş açısı + başlangıç parası, kayıp bonusu ve botların insana verdiği hasar değişir.
- **20 silah/bomba:** 4 tabanca, 3 SMG, 2 pompalı, 1 makineli tüfek, 4 tüfek, 2 keskin nişancı, bıçak, HE / flaş / sis bombası.
- **Daha hızlı ve akıcı hareket** (koşu 5.6 → 6.7 m/sn, daha çevik ivmelenme).
- **Performans:** FPS'e göre otomatik çözünürlük, zaman bütçeli chunk inşası, jitter'a göre ayarlanan interpolasyon, sunucuda gerçek zamanlı hareket bütçesi (yavaş sunucuda bile doğru hız), botlar 15 Hz düşünür, Render bölgesi Frankfurt.
- **Görsel:** gökyüzü gradyanı + güneş, voxel ışın izlemeli güneş gölgeleri, temaya göre sis/ışık, voxel sis bulutları, patlama/flaş efektleri.
- **Arayüz:** yeni menü (harita kartları, zorluk seçici, sekmeler), dönen radar, modelden üretilen silah ikonları (market, killfeed, HUD), maç sonu istatistik ekranı.
- **Botlar:** A* yol bulma (her haritada otomatik), flaş/sise tepki, HE atma, son görülen düşmanı avlama.

Tarayıcıda aç → **HIZLI OYNA**. "Bot Sayısı = 9" ile tek başına tam 5v5 oynayabilirsin. Oda kodunu arkadaşlarına ver, aynı odaya girsinler (botlar insanlara otomatik yer açar).

---

## 🆕 v3.0 — Hesaplar, mağaza, yeni modlar

**Hesap + profil:** İlk açılışta otomatik hesap (arkadaş kodu + cihazda saklanan gizli anahtar, e-posta yok). Seviye/XP, Blok Coin, rütbe (Bronz → Usta), istatistikler, son 10 maç. Hesap anahtarı ile başka cihaza taşıma, uygulama içinden hesap silme (mağaza şartı).

**Mağaza (adil):** 16 silah kaplaması + 6 ajan rozeti. Tamamen görsel — hasar/isabet/hız/ses değişmez, takım renkleri hep okunur. Blok Coin şimdilik oynayarak kazanılır; gerçek para paketleri `server/store.js → grantCoins` kancasıyla, mağaza fatura doğrulamasından sonra bağlanacak.

**Modlar:** Rekabetçi · Dereceli (rütbe puanı, terk cezası) · Ölüm Maçı · Silah Oyunu · Sadece Bıçak · 1v1 Düello. Maç sonunda harita oylaması. 2 yeni harita: Citadel, Neon District.

**Oynanış:** Molotof (sis söndürür), duvar delen C4 kırıcı şarj, leş kamerası (killcam), silah inceleme (F), kask fırlaması + ragdoll ölüm, telefon titreşimi, raunt vurgu anları (clutch / ACE), harita ortam sesleri, oyuncu engelle/bildir, parti sistemi.

### Supabase kurulumu (kalıcı hesaplar)
1. Supabase → **SQL Editor** → `scripts/supabase.sql` içeriğini yapıştır → **Run**.
2. Render → servis → **Environment**: `SUPABASE_URL` ve `SUPABASE_SERVICE_KEY` (service_role anahtarı). Anahtarı kimseyle paylaşma, koda yazma.
3. `/health` çıktısında `"db":"supabase"` görmelisin. Değişkenler yoksa sunucu yerel dosyaya (`data/accounts.json`) yazar.

## Proje yapısı

```
shared/shared.js     Sunucu + istemcinin ORTAK deterministik çekirdeği
                     (config, voxel dünya + DDA raycast, oyuncu fiziği, silahlar,
                      sekme desenleri, saçılma, hitbox'lar, harita üreteci, bot rota grafı)
server/index.js      HTTP statik sunucu, Socket.io, lobi/oda yönetimi, rate-limit
server/Room.js       Otoriter oyun durumu: tick, input işleme, lag-compensation,
                     hasar/zırh, ekonomi, raunt döngüsü, bomba, devre arası
server/Bot.js        Sunucu tarafı yapay zekâ (insanla aynı input akışını üretir)
public/js/engine.js  WebGL2 motoru: mat4, shader'lar, instanced box renderer, sahne grafiği
public/js/world.js   Prosedürel piksel doku atlası + chunk mesher (yüz eleme + AO)
public/js/models.js  Kodla üretilen silah/karakter/bomba modelleri + karakter animasyonu
public/js/viewmodel.js  Birinci şahıs silah + kollar ve tüm animasyon katmanları
public/js/effects.js Mermi izi, parçacık, kovan, kurşun deliği, ışık patlaması, sarsıntı
public/js/audio.js   Tamamen sentezlenmiş 3D ses (dosya yok)
public/js/input.js   Klavye/fare (pointer lock) + çoklu dokunmatik joystick/butonlar
public/js/hud.js     Can/zırh/para/mermi, skor, killfeed, market, skor tablosu
public/js/net.js     Socket.io bağlantısı + saat senkronu
public/js/main.js    Tahmin/uzlaştırma, interpolasyon, ateş, izleyici, render döngüsü
scripts/             build-mobile, make-icons, smoke-test, devshim (yalnızca offline test)
```

---

## 1. Ağ ve Multiplayer Mimarisi

**Otoriter sunucu + istemci tahmini (Valve/Source modeli):**

| Katman | Nasıl çalışır |
|---|---|
| **Input** | İstemci 60 Hz sabit adımla `{seq, mx, mz, yaw, pitch, buttons}` üretir, ~30 Hz paketler halinde gönderir. |
| **Tahmin** | İstemci aynı `stepPlayer()` fonksiyonunu (shared.js) yerelde çalıştırır → sıfır gecikmeli hareket. |
| **Uzlaştırma** | Her snapshot'ta sunucunun son onayladığı `seq` gelir; istemci sunucu durumuna döner, onaylanmamış input'ları tekrar oynatır, kalan küçük hatayı 12/s üstel yumuşatmayla eritir. Testte ölçülen maksimum sapma: **~1 mm**. |
| **Hız hilesi koruması** | Her oyuncunun gerçek zamana bağlı bir "input bütçesi" var; bütçeden fazla gelen input işlenmez. |
| **Interpolasyon** | Diğer oyuncular 100 ms geriden, iki snapshot arasında doğrusal (açılar için en kısa yol) interpolasyonla çizilir. |
| **Vuruş algılama** | İstemci sadece *bakış açısı + sekme indeksi + render zamanı* yollar. Sunucu saçılmayı **aynı tohumla** (`shotSeed(oyuncu, seq)`) yeniden hesaplar, kurbanları istemcinin gördüğü ana geri sarar (en fazla 300 ms, 1 sn pozisyon geçmişi), DDA voxel raycast + baş/gövde/bacak AABB testleri yapar. |
| **Doğrulama** | Atış hızı, mermi, şarjör, silah çekme süresi, sekme indeksi toleransı, açı sınırları, mesaj başına rate-limit, isim/oda kodu temizleme. |
| **Delip geçme** | Kırılabilir bloklar (sandık, tahta, kum torbası) silahın `penetration` değeri kadar delinir, her blokta hasar %50 düşer ve bloğa hasar verir. Beton/metal mermiyi durdurur. |
| **Oda sistemi** | Oda kodu ile özel oda veya hızlı eşleşme (en dolu uygun oda). Son insan çıkınca 15 sn sonra oda kapanır. Takım dolarsa bot otomatik çıkarılır. |

Snapshot'lar `volatile` gönderilir (geç kalan paket bekletilmez — UDP benzeri davranış). Dünya değişiklikleri (`blocks`) ve olaylar (kill, bomba, raunt) güvenilir kanaldan gider; odaya sonradan katılan oyuncuya sadece temel haritadan farklar (diff) yollanır.

## 2. Motor, Voxel Grafik ve Animasyon

- **Dünya:** 64×16×64 voxel, 16³ chunk'lar. Sadece görünen yüzler üretilir, köşe başı **ambient occlusion** + güneş gölgelemesi vertex rengine pişirilir; doku atlası çalışma anında piksel piksel üretilir (tuğla, sandık, tahta, kum torbası, metal…). Frustum culling, blok kırılınca sadece etkilenen chunk'lar yeniden örülür.
- **Tek draw-call karakterler:** Tüm karakterler, silahlar, parçacıklar, mermi izleri ve kurşun delikleri **instanced kutu** olarak tek seferde çizilir. Tipik kare: ~20 draw call.
- **Dinamik ışık:** Namlu ateşi ve patlama, en yakın 4 ışık olarak hem dünyayı hem modelleri aydınlatır.
- **Viewmodel animasyon katmanları** (hepsi matematiksel): çekme (ease-out-back), yürüme sallanması (8 figürü), nefes, fare gecikmeli sallanma (yay fiziği), sekme tepmesi (sönümlü yaylar), zıplama/iniş, eğilme, **şarjör değiştirme keyframe'leri** (eğ → şarjör düşer → yeni şarjör takılır → tokat → kurma kolu), bıçak savurma, keskin nişancı mekanizma çekme, namlu alevi.
- **Karakter animasyonu:** Yürüme döngüsü hıza bağlı, eğilme, kafa/kol nişan açısı, şarjör değişimi, bomba kurma pozu, ölüm düşüşü.

## 3. CS Tarzı Rekabetçi Döngü

- **Fazlar:** Isınma (16.000$, sınırsız yeniden doğma) → Hazırlık/Market (12 sn, hareket kilitli) → Raunt (1:55) → Raunt sonu (6 sn). **MR12**: 13 raunt alan kazanır, 12. raunttan sonra **devre arası** (taraf değişimi + ekonomi sıfırlanır), 12-12 berabere.
- **Ekonomi:** Başlangıç 800$, tavan 16.000$; kazanma 3250/3500$, art arda kaybetme bonusu 1400→3400$, bomba kurulduysa T'lere +800$, kurma/imha +300$, silaha göre öldürme ödülü (bıçak 1500$, SMG 600$, AWP benzeri 100$). Süre bittiğinde hayatta kalan T'ler kayıp bonusu alamaz.
- **Silahlar:** P-9 / P-12 (başlangıç tabancaları), HC-50, Viper SMG, Krait AR-7 (T), Sentinel M4 (CT), Longshot .338 (2 kademe dürbün), bıçak. Her birinin sabit **sekme deseni**, hareket/zıplama/eğilme saçılması, menzil düşüşü, zırh delme oranı vardır (Krait kasklıya tek kafa atar, Sentinel atmaz).
- **Ekipman:** Kevlar (650$), Kevlar+Kask (1000$ / zırh varsa 350$), İmha kiti (CT, süreyi 10→5 sn).
- **Bomba:** Raunt başında rastgele T'ye verilir; A/B bölgesinde E basılı tutularak 3.2 sn'de kurulur; 40 sn sayaç, hızlanan bip sesi; ölünce yere düşer ve T'ler üzerinden geçerek alır. Patlama yarıçap içindekileri öldürür ve kırılabilir blokları yok eder.
- **Kazanma koşulları:** Eliminasyon, bomba patlaması, imha, süre bitimi.
- **HUD:** Can/zırh/para, mermi, dinamik crosshair (saçılmayı gösterir), hitmarker (kafa vuruşu kırmızı), hasar yön oku, killfeed, takım canlı sayısı, bomba durumu, kurma/imha çubuğu, skor tablosu (Tab), market (B), takım/duraklat menüsü (M/Esc), sohbet (Y).

## 4. Performans ve Mağaza Yayını

### 60 FPS için uygulananlar / ipuçları
1. **Draw call bütçesi:** Dünya chunk başına 1, tüm dinamik objeler instancing ile 3 batch. Yeni efekt eklerken `BoxBatch`'e push et, ayrı mesh oluşturma.
2. **Çözünürlük ölçekleme:** Menüdeki *Grafik Kalitesi*: Düşük = 0.85× piksel oranı + kısa sis, Orta = mobilde 1.25×, Yüksek = MSAA. Mobil GPU'da darboğaz neredeyse her zaman doluluk oranıdır (fill-rate) — önce piksel oranını düşür.
3. **Sis = görüş mesafesi:** Uzak chunk'lar sisle kaybolur ve frustum culling ile atlanır.
4. **Çöp toplayıcıdan kaçın:** Sıcak döngülerde (render, fizik) obje üretme; bu projedeki batch'ler sabit `Float32Array` kullanır.
5. **Chunk yeniden örme kare başına sınırlı** (mobilde 2, PC'de 4) → blok kırılınca takılma olmaz.
6. **Ağ:** 30 Hz snapshot, sayılar 2-3 ondalığa yuvarlanır, `perMessageDeflate` kapalı (CPU tasarrufu), sadece WebSocket transport.
7. **Sunucu ölçekleme:** Oda başına tek `setInterval`; bir Node süreci rahatça 50+ oda taşır. Daha fazlası için `@socket.io/redis-adapter` + sticky session ile yatay ölçekle, oyuncuları bölgeye yakın sunucuya yönlendir (ping < 60 ms hedefle).
8. **Ölçüm:** Oyunda **F3** → FPS, ping, draw call, instance, üçgen sayısı.

### Sunucuyu yayına alma
```
PORT=3000 CORS_ORIGIN="capacitor://localhost,https://localhost,https://oyun.alanadin.com" npm start
```
Önüne Nginx/Caddy ile **HTTPS + WSS** koy (iOS/Android sadece güvenli bağlantıya izin verir). `GET /health` izleme için hazır.

### Capacitor ile .apk / .aab / .ipa
```bash
npm install
npx cap add android            # bir kere
npx cap add ios                # bir kere (macOS + Xcode gerekir)
node scripts/build-mobile.js --server https://oyun.alanadin.com
npx cap sync
npx cap open android           # Android Studio → Build > Generate Signed Bundle (.aab)
npx cap open ios               # Xcode → Product > Archive → App Store Connect
```
Ek ayarlar:
- **Yatay ekran kilidi:** Android `AndroidManifest.xml` → activity'ye `android:screenOrientation="sensorLandscape"`; iOS `Info.plist` → `UISupportedInterfaceOrientations` sadece Landscape Left/Right.
- **Tam ekran / çentik:** CSS zaten `safe-area-inset` kullanıyor; iOS'ta `UIStatusBarHidden = YES`, `UIRequiresFullScreen = YES`.
- **İkonlar:** `python3 scripts/make-icons.py` (1024px dahil tüm boyutlar) → Android Studio *Image Asset* ve Xcode *AppIcon* içine aktar. İstersen `@capacitor/assets` ile otomatik üretebilirsin.
- **Google Play:** Hedef API seviyesi güncel olmalı, `.aab` yükle, *Data safety* formunda "oyuncu adı ve oyun içi sohbet" bildir, içerik derecelendirme anketinde *şiddet: gerçekçi olmayan / çizgi film tarzı* seç (genelde PEGI 12 / Teen).
- **App Store:** Çok oyunculu sohbet olduğu için Guideline 1.2 gereği **raporlama/engelleme** mekanizması ve kullanım şartları linki gerekir; yaş derecelendirmesinde "Sık/yoğun çizgi film şiddeti" işaretle. Sadece web sarmalayıcı gibi görünmemesi için (Guideline 4.2) yerel özellikler ekle: titreşim (`@capacitor/haptics` — vuruş/hasar), çevrimdışı botlu antrenman modu, push bildirimleri.

### ASO (Mağaza Optimizasyonu) stratejisi
- **İsim:** "BLOCK OPS: Taktik Nişancı 5v5" — ana anahtar kelime başlıkta. Alt başlık (iOS, 30 karakter): "Blok FPS · Bomba Kur & İmha Et".
- **Anahtar kelimeler (iOS 100 karakter):** `fps,nişancı,taktik,5v5,çok oyunculu,blok,voxel,online,silah,bomba,rekabet,shooter,pvp`
- **Açıklamanın ilk 3 satırı** (kesilmeden görünen kısım): değer önerisi + "telefonda 60 FPS" + "parçalanabilir dünya".
- **Görseller:** İlk 2 ekran görüntüsü aksiyon anı (namlu alevi, kırılan sandık), üzerinde 3-4 kelimelik başlık; 15-30 sn yatay **oynanış videosu** (ilk 3 saniye çatışma). Türkçe + İngilizce yerelleştir, en az TR/US/DE/BR mağazaları için ayrı görsel seti.
- **Dönüşüm:** Uygulama boyutu küçük olsun (bu proje motor dahil ~170 KB sıkıştırılmamış JS) — "küçük indirme" mobil FPS'te güçlü bir argüman, açıklamada belirt.
- **Puan:** Kazanılan maç sonrası (memnuniyet anında) `@capacitor-community/in-app-review` ile değerlendirme iste, kaybedince asla.
- **Ölçüm:** Play Console *Store listing experiments* ve App Store *Product Page Optimization* ile ikon/ilk görsel A/B testi; haftalık anahtar kelime sıralama takibi.

---

## 🎮 Arkadaşlarla oynama ve uygulama olarak kurma (hızlı rehber)

Oyun **gerçek multiplayer**: herkes aynı sunucuya bağlanır, aynı **oda kodunu** yazar ve aynı maçı oynar. Telefon ve PC aynı odada birlikte oynayabilir. Tek şart: herkesin o sunucuya ulaşabilmesi.

### Seçenek A — Aynı Wi-Fi (en hızlı deneme, 2 dakika)
1. Bilgisayarında `npm install` ve `npm start`.
2. Konsolda `Aynı Wi-Fi'deki arkadaşlar için: http://192.168.x.x:3000` satırı çıkar. Bu adresi arkadaşlarına ver.
3. Herkes **ODAYA GİR**'e basıp aynı oda kodunu yazar (ör. `EKIP1`).
> Not: Bu adres `http` olduğu için tarayıcıda oynanır ama ana ekrana "uygulama" olarak kurulamaz. Kurulum için B veya C.

### Seçenek B — Herkese açık HTTPS adresi (bu akşam göstermek için)
Bilgisayarın açıkken oyunu internete açar:
```
npm start
npx cloudflared tunnel --url http://localhost:3000
```
Çıkan `https://xxxx.trycloudflare.com` adresini arkadaşlarına at. Bu adres HTTPS olduğu için oyun **uygulama olarak kurulabilir**:
- **Android (Chrome):** Menüde **📲 UYGULAMA OLARAK YÜKLE** butonu çıkar → ana ekrana ikonlu, tam ekran, yatay uygulama olarak kurulur.
- **iPhone (Safari):** Paylaş (□↑) → **Ana Ekrana Ekle**. Menüde bu yönerge zaten gösteriliyor.
- **PC (Chrome/Edge):** Adres çubuğundaki "Yükle" ikonu veya menüdeki buton → ayrı pencerede masaüstü uygulaması.

### Seçenek C — Kalıcı sunucu (bilgisayarın kapalıyken de çalışır, ücretsiz)
1. Projeyi GitHub'a yükle.
2. [Render.com](https://render.com) → **New → Blueprint** → repoyu seç (`render.yaml` hazır). Birkaç dakikada `https://blockops-server.onrender.com` gibi bir adresin olur.
   (Alternatif: `Dockerfile` ile Railway, Fly.io veya herhangi bir VPS.)
3. Arkadaşların bu adresi açıp B'deki gibi uygulama olarak kurar.
> Ücretsiz Render planı 15 dk boşta kalınca uyur; ilk girişte ~30 sn uyanma süresi olabilir.

### Gerçek Android uygulaması (.apk) — Android Studio olmadan
1. Projeyi GitHub'a yükle (C'deki sunucuyu kurmuş ol).
2. GitHub → **Actions → Android APK → Run workflow** → sunucu adresini yaz.
3. ~5 dk sonra çıkan **BlockOps-apk** dosyasını indir, telefonlara at, kur ("bilinmeyen kaynaklara izin ver" demen gerekebilir).
Mağazaya çıkarmaya karar verirsen yukarıdaki **4. bölüm**deki imzalı `.aab` / Xcode adımlarını izle.

---

## Kontroller
**PC:** WASD · Fare nişan/ateş · Sağ tık dürbün · Space zıpla · C/Ctrl eğil · Shift sessiz yürü · R şarjör · 1-3 / Q / tekerlek silah · E kur/çöz · B market · Tab skor · M menü · Y sohbet · F3 performans.
**Mobil:** Sol yarı dinamik joystick (az itince sessiz yürür) · sağ yarı sürükle = bak · 🔥 basılı tutup sürükle = ateş ederken nişan al · ⤒ zıpla · ⤓ eğil (aç/kapa) · R · E (basılı tut) · ◎ dürbün · ⇄ silah · $ market · ☰ skor · ⏸ menü.

## Notlar
- `scripts/devshim/` sadece internet erişimi olmayan CI/test ortamları içindir (`BLOCKOPS_DEV_SHIM=1`); gerçek kurulumda Socket.io kullanılır.
- `BLOCKOPS_FAST=1` faz sürelerini kısaltır (test için).
