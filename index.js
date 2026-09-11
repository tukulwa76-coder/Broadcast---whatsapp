const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const pino = require("pino");
const readline = require("readline");
const fs = require("fs");
const config = require("./config");
const { handleCommand } = require("./lib/commands");
const { readJSON } = require("./lib/store");
const { getAllGroupJids, isOwner } = require("./lib/utils");
const { runBroadcast } = require("./lib/broadcast");
const { startWebServer, setPairingCode, setConnected, setDisconnected } = require("./lib/webserver");

// Mode interaktif (Termux, ada terminal) vs non-interaktif (Railway, pakai env var)
const isInteractive = process.stdin.isTTY && !config.BOT_PHONE_NUMBER;

async function askPhoneNumber() {
  if (config.BOT_PHONE_NUMBER) return config.BOT_PHONE_NUMBER;
  if (!isInteractive) {
    throw new Error(
      "BOT_PHONE_NUMBER belum di-set di environment variable, dan tidak ada terminal interaktif untuk input manual."
    );
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (text) => new Promise((resolve) => rl.question(text, resolve));
  const phoneNumber = await question("📱 Masukkan nomor WhatsApp bot (format 62xxxxxxxxxx, tanpa +): ");
  rl.close();
  return phoneNumber.trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestPairingCodeWithRetry(sock, phoneNumber, maxAttempts = 5) {
  // Jeda awal 3 detik supaya websocket sempat konek dulu ke server WhatsApp
  await sleep(3000);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await sock.requestPairingCode(phoneNumber);
    } catch (err) {
      console.log(`⚠️ Gagal minta kode pairing (percobaan ${attempt}/${maxAttempts}): ${err.message}`);
      if (attempt === maxAttempts) throw err;
      await sleep(4000); // jeda sebelum coba lagi
    }
  }
}

async function startBot() {
  // Kalau RESET_SESSION=true di environment variable, hapus folder session
  // dulu sebelum connect. Dipakai buat "paksa" pairing ulang di Railway,
  // karena di sana tidak ada terminal untuk hapus folder manual.
  if (process.env.RESET_SESSION === "true") {
    const sessionPath = `./session/${config.SESSION_NAME}`;
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
      console.log("🗑️ Folder session dihapus (RESET_SESSION=true). Akan minta pairing baru.");
    }
  }

  const { state, saveCreds } = await useMultiFileAuthState(`./session/${config.SESSION_NAME}`);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: "silent" }),
  });

  // --- Login via pairing code (bukan QR) ---
  if (!sock.authState.creds.registered) {
    const phoneNumber = await askPhoneNumber();

    // requestPairingCode sering gagal "Connection Closed" kalau dipanggil
    // terlalu cepat, sebelum websocket ke server WA benar-benar siap.
    // Kasih jeda awal + retry beberapa kali.
    const code = await requestPairingCodeWithRetry(sock, phoneNumber);
    console.log(`\n🔗 Kode pairing kamu: ${code}\n`);
    console.log("Buka WhatsApp > Perangkat Tertaut > Tautkan dengan nomor telepon, lalu masukkan kode di atas.\n");
    setPairingCode(code);
  }

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("Koneksi terputus.", shouldReconnect ? "Menyambung ulang..." : "Logout, hapus folder session untuk login ulang.");
      setDisconnected();
      if (shouldReconnect) startBot();
    } else if (connection === "open") {
      console.log("✅ Bot WhatsApp terhubung!");
      setConnected();
    }
  });

  // --- Listener pesan masuk ---
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    const msg = messages[0];
    if (!msg.message) return;

    const chatId = msg.key.remoteJid;
    // Di chat "diri sendiri", WhatsApp menandai pesan sebagai fromMe walau itu
    // command owner. participant hanya ada di grup; untuk private/self chat,
    // pakai remoteJid sebagai sender saat fromMe true.
    const senderJid = msg.key.fromMe
      ? sock.user.id
      : msg.key.participant || msg.key.remoteJid;

    // Abaikan pesan fromMe KECUALI dari nomor owner sendiri (biar bot tidak
    // memproses pesan yang dikirim manual ke orang lain / grup lain).
    if (msg.key.fromMe && !isOwner(senderJid)) return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      "";

    if (!text.startsWith(config.PREFIX)) return;

    try {
      await handleCommand(sock, msg, chatId, senderJid, text);
    } catch (err) {
      console.error("Error handling command:", err);
      await sock.sendMessage(chatId, { text: `❌ Terjadi error: ${err.message}` });
    }
  });

  // --- Scheduler broadcast otomatis (.bcauto) ---
  startAutoBroadcastScheduler(sock);

  return sock;
}

function startAutoBroadcastScheduler(sock) {
  // .bcauto sekarang pakai interval MENIT (bukan jam tetap), sama seperti .bc
  // manual: sekali siklus broadcast selesai (dengan jeda random per grup dari
  // .setdelay), bot nunggu intervalMinutes lalu ulang lagi siklus berikutnya.
  let timer = null;

  async function cycle() {
    const autobc = readJSON(config.AUTOBC_FILE, {});
    if (!autobc.enabled || !autobc.intervalMinutes || !autobc.message) {
      timer = setTimeout(cycle, 30 * 1000); // cek ulang tiap 30 detik kalau belum aktif
      return;
    }

    try {
      const targets =
        autobc.target && autobc.target !== "all"
          ? readJSON(config.TARGETS_FILE, {})[autobc.target] || []
          : await getAllGroupJids(sock);

      console.log(`⏰ Broadcast otomatis mulai ke ${targets.length} target...`);
      await runBroadcast(sock, targets, { text: autobc.message }, {});
      console.log(`⏰ Broadcast otomatis selesai, siklus berikutnya dalam ${autobc.intervalMinutes} menit.`);
    } catch (e) {
      console.error("Gagal menjalankan broadcast otomatis:", e.message);
    }

    // baca ulang autobc (mungkin ada perubahan saat broadcast berjalan)
    const latest = readJSON(config.AUTOBC_FILE, {});
    const nextDelayMs = (latest.intervalMinutes || autobc.intervalMinutes) * 60 * 1000;
    timer = setTimeout(cycle, nextDelayMs);
  }

  timer = setTimeout(cycle, 5 * 1000); // start check pertama 5 detik setelah bot nyala
}

startWebServer();

async function bootWithRetry() {
  try {
    await startBot();
  } catch (err) {
    console.error("❌ Gagal start bot:", err.message);
    console.log("🔄 Coba ulang dalam 10 detik...");
    setTimeout(bootWithRetry, 10 * 1000);
  }
}

bootWithRetry();
