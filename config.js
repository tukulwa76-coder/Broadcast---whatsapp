require("dotenv").config();

module.exports = {
  // Nomor owner (format internasional tanpa +, tanpa spasi)
  OWNER_NUMBERS: process.env.OWNER_NUMBERS
    ? process.env.OWNER_NUMBERS.split(",").map((n) => n.trim())
    : ["6281957081712"],

  // Nomor WhatsApp yang dipakai SEBAGAI bot (dibutuhkan buat pairing tanpa input manual di Railway)
  BOT_PHONE_NUMBER: process.env.BOT_PHONE_NUMBER || null,

  // Prefix command
  PREFIX: process.env.PREFIX || ".",

  // Jeda default antar pesan broadcast (dalam menit)
  DELAY_MIN_MINUTES: Number(process.env.DELAY_MIN_MINUTES) || 3,
  DELAY_MAX_MINUTES: Number(process.env.DELAY_MAX_MINUTES) || 7,

  // Port untuk web server kecil (health check Railway + halaman lihat kode pairing)
  PORT: Number(process.env.PORT) || 3000,

  // File penyimpanan data
  BLACKLIST_FILE: "./data/blacklist.json",
  TARGETS_FILE: "./data/targets.json",
  AUTOBC_FILE: "./data/autobc.json",

  // Nama sesi
  SESSION_NAME: "wa-bot-session",
};
