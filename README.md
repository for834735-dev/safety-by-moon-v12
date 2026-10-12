# Deploy ke Railway

Repo ini siap di-deploy dengan **Dockerfile** (sudah memasang Node 22, ffmpeg, git, font, dan yt-dlp).

1. Susunan repo: boleh isi folder `server/` langsung di root repo, atau folder `server/` di dalam repo. Dockerfile menangani keduanya, asalkan `Dockerfile` dan `railway.json` ada di root repo.
2. Railway > New Project > Deploy from GitHub repo > pilih repo ini. Biarkan **Root Directory** kosong.
3. Tab **Variables**: isi `OWNER_NUMBER=62xxxxxxxxxx` dan `API_KEY=<kata sandi buatanmu>`. **Jangan isi `PORT`**; Railway mengisinya sendiri.
4. Tab **Settings > Networking > Generate Domain**, lalu buka domain `https://...up.railway.app`. Dashboard ada di alamat itu.
5. Agar login WhatsApp tidak hilang saat deploy ulang: tambahkan **Volume**, lalu **Mount Path** `/app/data`.
6. Cek `https://domain-kamu/api/health`. Harus muncul `"ok":true` dan `"baileys":"ok"`.

Bila `baileys` bertuliskan `gagal: ...`, server tetap hidup dan penyebabnya tampil di sana serta di dashboard.

# Safety Your WhatsApp — Backend

Backend Node.js untuk dashboard Safety Your WhatsApp.

## Pairing Code

Pairing dilakukan **hanya dari dashboard**. Masukkan nomor WhatsApp dalam format internasional tanpa `+`, contoh `62812xxxxxxx`.

Alur pairing:

1. Dashboard `POST /api/pair`.
2. Backend membuat satu socket pairing.
3. Backend menunggu WebSocket benar-benar terbuka dan memberi jeda agar Noise handshake selesai.
4. Pairing code diminta dan dikirim ke dashboard.
5. Setelah kode diterima WhatsApp, credential disimpan.
6. Jika WhatsApp mengirim `515 / restartRequired`, backend menunggu credential selesai ditulis lalu membuat socket baru menggunakan session tersebut.
7. Setelah `open`, bot berjalan normal.

`401` saat socket masih belum terdaftar tidak di-reconnect secara membabi buta. Dashboard bisa meminta pairing baru.

## Soal error "Connection Failure" / decodeFrame / Pairing ditolak (401)

Bila kamu menemukan log seperti ini:

```
[INFO] connection errored
  trace: "Error: Connection Failure ... at Object.decodeFrame (.../noise-handler.js:140:17)"
[WARN] Pairing ditolak WhatsApp (401). Kode/session percobaan sudah tidak valid.
```

Penting buat diketahui: **ini bukan bug yang cuma ada di kode project ini.** Trace error yang sama persis
juga dilaporkan banyak orang lain di issue tracker resmi Baileys — termasuk yang masih open sampai
sekarang (issue #2364, #2370, #1947, #2052, #806, dsb di github.com/WhiskeySockets/Baileys/issues) —
di berbagai versi library, dari v6 sampai v7. Jadi ini bukan kesalahan kode proyek ini saja; ini memang
titik lemah yang dikenal luas di ekosistem Baileys sendiri saat proses handshake pairing code.

Yang sudah diperbaiki di kode ini untuk mengurangi kemungkinan itu:

1. **Buang `fetchLatestBaileysVersion()`.** Banyak laporan (termasuk dari maintainer Baileys sendiri)
   bilang fungsi ini bisa narik nomor versi WA yang nggak sinkron sama protokol yang beneran
   diimplementasikan di versi library yang ke-install, dan itu salah satu pemicu paling umum dari
   error persis ini. Sekarang socket pakai versi default bawaan library.
2. **Bersihin folder session total** sebelum tiap kali minta pairing code baru — sisa file auth
   setengah-jadi dari percobaan gagal sebelumnya adalah penyebab umum lain dari 401 yang terus berulang.
3. **Cooldown 12 detik** antar permintaan pairing code — minta berkali-kali dalam waktu singkat
   kelihatannya malah bikin WhatsApp makin gampang nolak (rate-limit dari sisi WA).
4. Ganti fingerprint browser ke `Browsers.ubuntu('Chrome')` — beberapa laporan komunitas nemuin ini
   lebih stabil buat pairing code dibanding fingerprint macOS.
5. Memperbaiki race condition pada versi sebelumnya: status global tidak lagi dianggap
   `connecting` sebelum WebSocket benar-benar terbuka, dan penulisan kredensial ditunggu
   sebelum folder session dibersihkan.

Bila masih terjadi setelah ini (kemungkinan masih ada, karena ini isu upstream), coba:

- Ganti jaringan — dari WiFi ke data seluler atau sebaliknya. Beberapa orang lapor IP/jaringan
  tertentu lebih sering kena tolak.
- Pastikan aplikasi WhatsApp di HP udah versi terbaru.
- Coba lagi beberapa menit kemudian — sering kali ini kegagalan sementara di sisi server WhatsApp.
- Kalau nomornya baru banget didaftarin/pindah HP baru-baru ini, WhatsApp kadang lebih ketat ke nomor
  begitu buat sementara waktu.
- Jangan mengganti paket ini dengan `@whiskeysockets/baileys@latest` secara langsung. Rilis
  terbaru 7.x masih release-candidate dan memakai modul ESM, sedangkan backend ini memakai
  CommonJS; upgrade harus disertai migrasi kode dan pengujian ulang.

## Menjalankan

```bash
npm install
node server.js        # atau: python server.py
```

Server mendengarkan di `0.0.0.0:PORT` (bawaan 3000) dan menyajikan dashboard di alamat yang sama. Di Termux: `pkg install nodejs ffmpeg python` lebih dulu. Panduan lengkap (panel, VPS, downloader audio/video, 120 fitur) ada di `../README.md`.

## Session

Session berada di `data/session`. Jangan menghapus folder tersebut jika bot sudah berhasil terhubung; credential diperlukan agar bot tidak perlu pairing ulang.

Sejak revisi ini, setiap kali dashboard minta pairing code baru (`POST /api/pair`), folder session otomatis dibersihin duluan di sisi server — jadi tidak perlu menghapus manual lagi. Manual wipe di bawah ini cuma perlu kalau mau reset total di luar alur pairing normal (misal abis logout paksa):

```bash
rm -rf data/session
mkdir -p data/session
npm start
```

## Fitur

Source bot asli tetap dipertahankan: detector, auto-block, anti-link, welcome, `.menu`, `.sticker`, `.tiktok`, history, statistik, dan report.


### Pairing code

`POST /api/pair` selalu meminta pairing code baru dari socket WhatsApp yang aktif; endpoint tidak mengembalikan kode lama dari cache. Jika pairing belum berhasil, tekan **Buat kode baru** dari dashboard. Jangan gunakan kode lama setelah server mengeluarkan kode baru.


## Fitur

Daftar lengkap 120 fitur, cara memakai downloader (audio dulu, video opsional), dan pengaturan foto HD ada di `../README.md`.
Semua pengaturan server ada di `.env` (lihat `.env.example`). Data fitur tersimpan di `data/settings.json`.

Pemeriksaan cepat setelah `npm install`:

```bash
npm run check
```

## Pembaruan v11
- **Menu animasi**: `.menu` kini mengirim satu video GIF bertema bulan sabit emas dengan teks menu sebagai caption (satu pesan, tanpa stiker). Atur dengan `MENU_ANIM=on/off` di `.env`; ganti gambar dengan `assets/menu-art.png` lalu `python3 scripts/make-menu-anim.py`.
- **`.add`**: tambah member otomatis (`.add 0812xxxx, 62857xxxx`). Bila privasi target menolak, undangan grup dikirim ke chat pribadinya.
- **Grup Plus (kategori 15)**: add, tagall, tagadmin, poll, afk, linkgrup, setnama, undi, antiasing, ssweb, brat.
- **OSINT & Investigasi (kategori 16)**: whoisdom, ssl, subdomain, headers, techstack, username, exif, wayback, blacklist, ioc (khusus admin/owner).
