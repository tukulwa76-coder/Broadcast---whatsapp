const config = require("../config");
const { readJSON, writeJSON } = require("./store");
const { isOwner, getAllGroupJids, getAllGroupsWithNames, extractBroadcastContent } = require("./utils");
const { runBroadcast, isRunning, requestStop } = require("./broadcast");
const { downloadMediaMessage } = require("@whiskeysockets/baileys");

const MENU_TEXT = `
╭───「 ✨ *WA BOT BROADCAST* ✨ 」
│
├─ 📢 *BROADCAST*
│  ◦ .bc <teks>
│  ◦ .bcg <teks>
│     _kirim ke semua grup_
│  ◦ (reply pesan) .bc
│     _broadcast isi pesan yg di-reply_
│  ◦ .bctarget <kategori> <teks>
│     _kirim ke grup dalam 1 kategori_
│  ◦ .stopbc
│     _hentikan broadcast berjalan_
│
├─ ⏰ *OTOMATIS*
│  ◦ .bcauto on / .bcauto off
│  ◦ .bcauto set <menit> <teks>
│
├─ ⚙️ *PENGATURAN*
│  ◦ .setdelay <min> <max>
│  ◦ .blacklist add/del <groupId>
│  ◦ .addtarget <kategori> <groupId>
│  ◦ .cekid
│  ◦ .listgc
│
├─ 📸 *STATUS GRUP*
│  ◦ .swgc [groupId] <teks/reply media>
│
╰─ 🔒 _Khusus Owner/Admin terdaftar_

Ketik *.help <command>* untuk contoh
penggunaan tiap fitur.
`.trim();

const HELP_TEXT = {
  bc: `📢 *.bc / .bcg*\nBroadcast teks/foto/video/dokumen ke *semua* grup.\n\nContoh:\n.bc Halo semua, ada promo hari ini!\n\nBisa juga *reply* foto/video/dokumen lalu ketik .bc (tanpa teks tambahan) — isi pesan yang di-reply akan ikut terkirim.`,
  bcg: `Sama seperti .bc — lihat *.help bc*`,
  bctarget: `🎯 *.bctarget*\nBroadcast hanya ke grup dalam 1 kategori (bukan semua grup).\n\nLangkah:\n1. Buat kategori dulu: .addtarget promo 1203xxxxxxxx@g.us\n2. Kirim: .bctarget promo Diskon 50% khusus hari ini!\n\nID grup bisa dicek pakai .cekid di grup itu.`,
  stopbc: `⛔ *.stopbc*\nMenghentikan broadcast yang lagi berjalan. Broadcast berhenti setelah pesan yang sedang dikirim selesai (tidak langsung putus di tengah).`,
  bcauto: `⏰ *.bcauto*\nBroadcast otomatis berulang tiap interval menit tertentu — sama seperti .bc manual (pakai jeda random per grup dari .setdelay), bedanya ini ngulang terus tiap X menit sekali tanpa perlu ketik ulang.\n\n1. Atur interval & pesan:\n.bcauto set 60 Jangan lupa cek promo hari ini!\n(artinya: broadcast ke semua grup, lalu ulang lagi tiap 60 menit)\n\n2. Aktifkan: .bcauto on\n3. Nonaktifkan: .bcauto off`,
  setdelay: `⏱️ *.setdelay*\nAtur jeda random antar pesan broadcast (biar tidak dianggap spam).\n\nContoh: .setdelay 3 7\n→ tiap pesan dikirim, bot jeda acak 3–7 menit sebelum lanjut ke grup berikutnya.`,
  blacklist: `🚫 *.blacklist*\nGrup yang di-blacklist otomatis di-skip tiap broadcast.\n\nTambah: .blacklist add 1203xxxxxxxx@g.us\nHapus: .blacklist del 1203xxxxxxxx@g.us`,
  addtarget: `➕ *.addtarget*\nMasukkan grup ke sebuah kategori, dipakai bareng .bctarget.\n\nContoh: .addtarget vip 1203xxxxxxxx@g.us`,
  cekid: `🆔 *.cekid*\nKirim command ini di grup mana pun untuk lihat ID grup tersebut (dibutuhkan untuk .blacklist / .addtarget).`,
  listgc: `📋 *.listgc*\nMenampilkan semua grup yang bot ikuti, lengkap dengan nama dan ID-nya. Kirim command ini dari chat mana pun (nggak harus di grupnya) — cocok dipakai buat cari ID grup sebelum pakai .swgc, .blacklist, atau .addtarget.`,
  swgc: `📸 *.swgc*\nPosting status WA yang ditandai/nyantol ke grup tertentu (bukan status publik biasa).\n\nDua cara pakai:\n1. Dari dalam grup targetnya: reply foto/video (atau ketik teks) lalu .swgc\n2. Dari chat mana pun (misal chat ke diri sendiri): .swgc <groupId> <teks>, atau reply media lalu .swgc <groupId>\n\nContoh: .swgc 1203xxxxxxxx@g.us Promo hari ini!\n\nID grup bisa dicari pakai .listgc dulu.`,
};

async function handleCommand(sock, msg, chatId, senderJid, text) {
  if (!isOwner(senderJid)) return; // ownerOnly

  const body = text.trim();
  if (!body.startsWith(config.PREFIX)) return;

  const [rawCmd, ...args] = body.slice(config.PREFIX.length).split(" ");
  const cmd = rawCmd.toLowerCase();
  const argText = args.join(" ");

  switch (cmd) {
    case "menu": {
      await sock.sendMessage(chatId, { text: MENU_TEXT });
      break;
    }

    case "help": {
      const topic = args[0]?.toLowerCase();
      if (!topic || !HELP_TEXT[topic]) {
        await sock.sendMessage(chatId, {
          text: "❌ Format: .help <command>\nContoh: .help bc\n\nTopik tersedia: " + Object.keys(HELP_TEXT).join(", "),
        });
        break;
      }
      await sock.sendMessage(chatId, { text: HELP_TEXT[topic] });
      break;
    }

    case "bc":
    case "bcg": {
      if (isRunning()) {
        await sock.sendMessage(chatId, { text: "⚠️ Masih ada broadcast berjalan. Gunakan .stopbc dulu." });
        break;
      }
      const content = await resolveContent(sock, msg, argText);
      if (!content) {
        await sock.sendMessage(chatId, { text: "❌ Sertakan teks setelah command, atau reply pesan yang mau di-broadcast." });
        break;
      }
      const targets = await getAllGroupJids(sock);
      await sock.sendMessage(chatId, { text: `📤 Menyiapkan broadcast ke ${targets.length} grup...` });
      runBroadcast(sock, targets, content, { progressChatId: chatId }).catch((e) =>
        sock.sendMessage(chatId, { text: `❌ Broadcast gagal: ${e.message}` })
      );
      break;
    }

    case "bctarget": {
      const [kategori, ...rest] = args;
      if (!kategori) {
        await sock.sendMessage(chatId, { text: "❌ Format: .bctarget <kategori> <teks>" });
        break;
      }
      if (isRunning()) {
        await sock.sendMessage(chatId, { text: "⚠️ Masih ada broadcast berjalan. Gunakan .stopbc dulu." });
        break;
      }
      const targetsData = readJSON(config.TARGETS_FILE, {});
      const list = targetsData[kategori];
      if (!list || list.length === 0) {
        await sock.sendMessage(chatId, { text: `❌ Kategori "${kategori}" kosong/tidak ditemukan. Tambah dulu pakai .addtarget` });
        break;
      }
      const content = await resolveContent(sock, msg, rest.join(" "));
      if (!content) {
        await sock.sendMessage(chatId, { text: "❌ Sertakan teks, atau reply pesan yang mau di-broadcast." });
        break;
      }
      await sock.sendMessage(chatId, { text: `📤 Menyiapkan broadcast ke kategori "${kategori}" (${list.length} grup)...` });
      runBroadcast(sock, list, content, { progressChatId: chatId }).catch((e) =>
        sock.sendMessage(chatId, { text: `❌ Broadcast gagal: ${e.message}` })
      );
      break;
    }

    case "stopbc": {
      const stopped = requestStop();
      await sock.sendMessage(chatId, {
        text: stopped ? "⛔ Permintaan stop dikirim, broadcast akan berhenti setelah pesan saat ini." : "ℹ️ Tidak ada broadcast yang sedang berjalan.",
      });
      break;
    }

    case "setdelay": {
      const [min, max] = args.map(Number);
      if (!min || !max || min <= 0 || max < min) {
        await sock.sendMessage(chatId, { text: "❌ Format: .setdelay <menit_min> <menit_max> — contoh: .setdelay 3 7" });
        break;
      }
      config.DELAY_MIN_MINUTES = min;
      config.DELAY_MAX_MINUTES = max;
      await sock.sendMessage(chatId, { text: `✅ Jeda broadcast diatur: ${min}-${max} menit per pesan.` });
      break;
    }

    case "blacklist": {
      const [action, groupId] = args;
      const blacklist = readJSON(config.BLACKLIST_FILE, []);
      if (action === "add" && groupId) {
        if (!blacklist.includes(groupId)) blacklist.push(groupId);
        writeJSON(config.BLACKLIST_FILE, blacklist);
        await sock.sendMessage(chatId, { text: `✅ ${groupId} ditambahkan ke blacklist.` });
      } else if (action === "del" && groupId) {
        writeJSON(config.BLACKLIST_FILE, blacklist.filter((g) => g !== groupId));
        await sock.sendMessage(chatId, { text: `✅ ${groupId} dihapus dari blacklist.` });
      } else {
        await sock.sendMessage(chatId, { text: "❌ Format: .blacklist add/del <groupId>" });
      }
      break;
    }

    case "addtarget": {
      const [kategori, groupId] = args;
      if (!kategori || !groupId) {
        await sock.sendMessage(chatId, { text: "❌ Format: .addtarget <kategori> <groupId>" });
        break;
      }
      const targetsData = readJSON(config.TARGETS_FILE, {});
      if (!targetsData[kategori]) targetsData[kategori] = [];
      if (!targetsData[kategori].includes(groupId)) targetsData[kategori].push(groupId);
      writeJSON(config.TARGETS_FILE, targetsData);
      await sock.sendMessage(chatId, { text: `✅ ${groupId} ditambahkan ke kategori "${kategori}".` });
      break;
    }

    case "bcauto": {
      const [sub, ...rest2] = args;
      const autobc = readJSON(config.AUTOBC_FILE, {});
      if (sub === "on") {
        autobc.enabled = true;
        writeJSON(config.AUTOBC_FILE, autobc);
        await sock.sendMessage(chatId, { text: "✅ Broadcast otomatis diaktifkan." });
      } else if (sub === "off") {
        autobc.enabled = false;
        writeJSON(config.AUTOBC_FILE, autobc);
        await sock.sendMessage(chatId, { text: "✅ Broadcast otomatis dinonaktifkan." });
      } else if (sub === "set") {
        const intervalMinutes = Number(rest2[0]);
        const message = rest2.slice(1).join(" ");
        if (!intervalMinutes || intervalMinutes <= 0 || !message) {
          await sock.sendMessage(chatId, { text: "❌ Format: .bcauto set <interval_menit> <teks>\nContoh: .bcauto set 60 Jangan lupa cek promo hari ini!" });
          break;
        }
        autobc.intervalMinutes = intervalMinutes;
        autobc.message = message;
        writeJSON(config.AUTOBC_FILE, autobc);
        await sock.sendMessage(chatId, { text: `✅ Broadcast otomatis diatur tiap ${intervalMinutes} menit sekali.\nPesan: ${message}` });
      } else {
        await sock.sendMessage(chatId, { text: "❌ Format: .bcauto on / .bcauto off / .bcauto set <cron> <teks>" });
      }
      break;
    }

    case "cekid": {
      await sock.sendMessage(chatId, { text: `🆔 ID chat ini:\n${chatId}` });
      break;
    }

    case "listgc": {
      const groups = await getAllGroupsWithNames(sock);
      if (groups.length === 0) {
        await sock.sendMessage(chatId, { text: "ℹ️ Bot belum join grup manapun." });
        break;
      }
      // Kirim per-chunk kalau grupnya banyak, biar nggak kepotong pesan WA
      const chunkSize = 30;
      for (let i = 0; i < groups.length; i += chunkSize) {
        const chunk = groups.slice(i, i + chunkSize);
        const listText = chunk
          .map((g, idx) => `${i + idx + 1}. *${g.subject}*\n   ${g.id}`)
          .join("\n\n");
        await sock.sendMessage(chatId, {
          text: `📋 *Daftar Grup* (${i + 1}-${i + chunk.length} dari ${groups.length})\n\n${listText}`,
        });
      }
      break;
    }

    case "swgc": {
      // Format: .swgc [groupId] <teks/caption>, atau reply media + .swgc [groupId]
      let targetGroupId = null;
      let remainingArgs = args;

      if (args[0] && args[0].endsWith("@g.us")) {
        targetGroupId = args[0];
        remainingArgs = args.slice(1);
      } else if (chatId.endsWith("@g.us")) {
        // dijalankan langsung dari dalam grup targetnya
        targetGroupId = chatId;
      }

      if (!targetGroupId) {
        await sock.sendMessage(chatId, {
          text: "❌ Sertakan ID grup tujuan, atau jalankan command ini dari dalam grup targetnya.\nFormat: .swgc <groupId> <teks/reply media>\nCari ID grup pakai .listgc",
        });
        break;
      }

      const content = await resolveContent(sock, msg, remainingArgs.join(" "));
      if (!content) {
        await sock.sendMessage(chatId, { text: "❌ Sertakan teks, atau reply foto/video yang mau diposting ke status grup." });
        break;
      }

      try {
        await sendGroupStatus(sock, targetGroupId, content);
        await sock.sendMessage(chatId, { text: `✅ Status berhasil diposting ke grup:\n${targetGroupId}` });
      } catch (err) {
        await sock.sendMessage(chatId, { text: `❌ Gagal posting status grup: ${err.message}` });
      }
      break;
    }

    default:
      break;
  }
}

// Posting status WA yang ditandai/nyantol ke sebuah grup (fitur "group status").
// content: { text } atau { image/video: buffer, caption }
async function sendGroupStatus(sock, groupJid, content) {
  const groupMeta = await sock.groupMetadata(groupJid).catch(() => null);
  const groupSubject = groupMeta?.subject || "Group";

  const contextInfo = {
    groupMentions: [{ groupJid, groupSubject }],
    mentionedJid: [groupJid],
  };

  const payload = { ...content, contextInfo };

  return sock.sendMessage("status@broadcast", payload, {
    statusJidList: groupMeta?.participants?.map((p) => p.id) || [],
  });
}

// Mengubah hasil extractBroadcastContent (yang mungkin masih berisi __rawQuoted)
// menjadi payload siap kirim untuk sock.sendMessage, termasuk download media asli jika perlu.
async function resolveContent(sock, msg, fallbackText) {
  const extracted = extractBroadcastContent(msg, fallbackText);
  if (!extracted) return null;

  if (extracted.__type) {
    const buffer = await downloadMediaMessage(
      { message: { [`${extracted.__type}Message`]: extracted.__rawQuoted[`${extracted.__type}Message`] } },
      "buffer",
      {}
    );
    if (extracted.__type === "image") return { image: buffer, caption: extracted.caption };
    if (extracted.__type === "video") return { video: buffer, caption: extracted.caption };
    if (extracted.__type === "document")
      return { document: buffer, fileName: extracted.fileName, caption: extracted.caption };
  }

  return { text: extracted.text };
}

module.exports = { handleCommand, MENU_TEXT, HELP_TEXT };
