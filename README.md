# WA Bot Broadcast (Owner-Only)

Bot WhatsApp untuk broadcast ke banyak grup/kontak, dengan progress bar real-time,
jeda random antar pesan, laporan hasil, dan broadcast terjadwal. Login pakai
**pairing code** (bukan scan QR), jadi cocok dijalankan di Termux.

## 1. Install di Termux

```bash
pkg update && pkg upgrade -y
pkg install nodejs git -y
```

Pindahkan/extract folder proyek ini ke penyimpanan Termux, lalu masuk ke foldernya:

```bash
cd wa-bot
npm install
```

## 2. Atur nomor owner

Edit `config.js`, ganti `OWNER_NUMBERS` dengan nomor WhatsApp kamu (format `62xxxxxxxxxx`,
tanpa tanda `+`). Sudah diisi default: `6281957081712`.

## 3. Jalankan bot

```bash
npm start
```

Saat pertama kali jalan, bot akan minta nomor WhatsApp yang dipakai **sebagai bot**
(bukan nomor owner, kecuali kamu memang pakai nomor sendiri). Setelah itu akan muncul
**kode pairing** di terminal. Buka WhatsApp di HP →
**Perangkat Tertaut** → **Tautkan dengan nomor telepon** → masukkan kode tersebut.

Supaya tetap jalan meski Termux ditutup, pakai `termux-wake-lock` dan/atau `tmux`:

```bash
pkg install tmux -y
tmux new -s wabot
npm start
# tekan Ctrl+B lalu D untuk keluar dari sesi tmux tanpa mematikan bot
```

## 4. Daftar Command (khusus Owner)

| Command | Fungsi |
|---|---|
| `.menu` | Tampilkan menu |
| `.bc <teks>` / `.bcg <teks>` | Broadcast teks ke semua grup |
| *(reply pesan)* + `.bc` | Broadcast isi pesan yang di-reply (teks/foto/video/dokumen) |
| `.bctarget <kategori> <teks>` | Broadcast ke grup dalam kategori tertentu |
| `.stopbc` | Hentikan broadcast yang sedang berjalan |
| `.setdelay <min> <max>` | Atur jeda antar pesan (menit) |
| `.blacklist add/del <groupId>` | Kelola grup yang di-skip saat broadcast |
| `.addtarget <kategori> <groupId>` | Tambah grup ke kategori target |
| `.bcauto on/off` | Aktif/nonaktifkan broadcast terjadwal |
| `.bcauto set <menit> <teks>` | Atur interval broadcast otomatis dalam menit, contoh `.bcauto set 60 <teks>` = ulang tiap 60 menit |
| `.cekid` | Cek ID grup/chat saat ini |

## Deploy ke Railway (alternatif jalan 24 jam, bukan Termux)

1. **Push proyek ini ke GitHub** (folder `session/` otomatis di-skip berkat `.gitignore`).

2. **Buat project baru di [railway.app](https://railway.app)** → *Deploy from GitHub repo* → pilih repo ini.

3. **Set Environment Variables** di tab *Variables*:
   | Key | Value |
   |---|---|
   | `BOT_PHONE_NUMBER` | nomor WhatsApp bot, contoh `6285381195934` |
   | `OWNER_NUMBERS` | nomor owner, contoh `6281957081712` |

   (Railway tidak punya terminal interaktif, jadi `BOT_PHONE_NUMBER` **wajib** diisi — bot akan otomatis minta kode pairing pakai nomor ini tanpa perlu ada yang mengetik di terminal.)

4. **Tambah Volume** (penting!) supaya sesi login tidak hilang tiap kali Railway redeploy/restart:
   - Tab *Settings* → *Volumes* → *New Volume*
   - Mount path: `/app/session`

   Tanpa volume, folder `session/` akan hilang tiap deploy ulang dan kamu harus pairing dari nol tiap saat.

5. **Deploy**, lalu buka tab *Logs* untuk lihat kode pairing, ATAU buka domain publik Railway-nya (tab *Settings* → *Networking* → *Generate Domain*) — akan tampil halaman status dengan kode pairing yang besar dan jelas.

6. Buka WhatsApp di HP → **Perangkat Tertaut** → **Tautkan dengan nomor telepon** → masukkan kode dari langkah 5.

7. Setelah connect, cek tab *Logs* untuk memastikan muncul `✅ Bot WhatsApp terhubung!`.

Kalau nanti butuh pairing ulang (misal device diputus dari WhatsApp), tinggal hapus isi volume lewat Railway dashboard lalu redeploy.



- Semua command hanya bisa dipakai oleh nomor di `OWNER_NUMBERS`.
- Jeda default 3–7 menit random antar pesan, bisa diubah lewat `.setdelay`.
- Progress bar dikirim sebagai satu pesan yang terus di-edit (`[■■■□□] 60% — Mengirim ke Grup 12/20`).
- Data blacklist & target grup disimpan di folder `data/` (format JSON, bisa diedit manual juga).
- `.bcauto` memakai pengecekan interval internal (tanpa dependency `node-cron`) agar ringan
  dan sederhana untuk dijalankan di Termux — mendukung format cron menit,jam saja.
