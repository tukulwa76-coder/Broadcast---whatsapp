const config = require("../config");
const { readJSON } = require("./store");

// Status broadcast yang sedang berjalan (single-run, sesuai kebutuhan .stopbc)
let currentRun = {
  running: false,
  stopRequested: false,
};

function isRunning() {
  return currentRun.running;
}

function requestStop() {
  if (currentRun.running) {
    currentRun.stopRequested = true;
    return true;
  }
  return false;
}

function buildProgressBar(done, total, barLength = 15) {
  const ratio = total === 0 ? 0 : done / total;
  const filled = Math.round(ratio * barLength);
  const bar = "■".repeat(filled) + "□".repeat(barLength - filled);
  const pct = Math.round(ratio * 100);
  return `[${bar}] ${pct}% — Mengirim ke Grup ${done}/${total}`;
}

function randomDelayMs(minMinutes, maxMinutes) {
  const min = minMinutes * 60 * 1000;
  const max = maxMinutes * 60 * 1000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep yang bisa diputus lebih cepat kalau stopRequested jadi true —
// dicek tiap 1 detik, jadi .stopbc terasa hampir instan walau delay-nya lama.
async function interruptibleSleep(ms) {
  const checkInterval = 1000;
  let waited = 0;
  while (waited < ms) {
    if (currentRun.stopRequested) return;
    const chunk = Math.min(checkInterval, ms - waited);
    await sleep(chunk);
    waited += chunk;
  }
}

/**
 * Menjalankan broadcast ke daftar JID target.
 * @param {object} sock - koneksi Baileys
 * @param {string[]} targetJids - daftar JID grup/kontak tujuan
 * @param {object} content - { text } atau { image/video/document buffer, caption } (format sendMessage Baileys)
 * @param {object} opts - { progressChatId, progressMsgKey, delayMinMinutes, delayMaxMinutes }
 */
async function runBroadcast(sock, targetJids, content, opts = {}) {
  if (currentRun.running) {
    throw new Error("Ada broadcast lain yang sedang berjalan. Gunakan .stopbc dulu.");
  }

  const blacklist = readJSON(config.BLACKLIST_FILE, []);
  const filteredTargets = targetJids.filter((jid) => !blacklist.includes(jid));

  currentRun = { running: true, stopRequested: false };

  const delayMin = opts.delayMinMinutes ?? config.DELAY_MIN_MINUTES;
  const delayMax = opts.delayMaxMinutes ?? config.DELAY_MAX_MINUTES;

  const total = filteredTargets.length;
  let success = 0;
  let failed = 0;
  const failedList = [];
  const startTime = Date.now();

  // Kirim pesan progress awal (akan di-edit terus)
  let progressMsg = null;
  if (opts.progressChatId) {
    progressMsg = await sock.sendMessage(opts.progressChatId, {
      text: `🚀 Memulai broadcast...\n${buildProgressBar(0, total)}`,
    });
  }

  for (let i = 0; i < total; i++) {
    if (currentRun.stopRequested) {
      break;
    }

    const jid = filteredTargets[i];
    try {
      await sock.sendMessage(jid, content);
      success++;
    } catch (err) {
      failed++;
      failedList.push({ jid, reason: err?.message || "unknown error" });
    }

    // update progress bar (edit pesan)
    if (progressMsg && opts.progressChatId) {
      try {
        await sock.sendMessage(opts.progressChatId, {
          text: `🚀 Broadcast berjalan...\n${buildProgressBar(i + 1, total)}`,
          edit: progressMsg.key,
        });
      } catch (e) {
        // kalau edit gagal, abaikan (tidak menghentikan broadcast)
      }
    }

    // jeda random sebelum pesan berikutnya, kecuali sudah pesan terakhir / diminta stop
    if (i < total - 1 && !currentRun.stopRequested) {
      await interruptibleSleep(randomDelayMs(delayMin, delayMax));
    }
  }

  const durationMs = Date.now() - startTime;
  const durationMin = Math.floor(durationMs / 60000);
  const durationSec = Math.round((durationMs % 60000) / 1000);

  const stopped = currentRun.stopRequested;
  currentRun = { running: false, stopRequested: false };

  const report = {
    total,
    success,
    failed,
    failedList,
    stopped,
    durationText: `${durationMin}m ${durationSec}s`,
  };

  if (opts.progressChatId) {
    const statusLine = stopped ? "⛔ Broadcast dihentikan (.stopbc)" : "✅ Broadcast selesai";
    await sock.sendMessage(opts.progressChatId, {
      text:
        `${statusLine}\n\n` +
        `📊 *Laporan Broadcast*\n` +
        `• Total target: ${total}\n` +
        `• Sukses: ${success} ✅\n` +
        `• Gagal: ${failed} ❌\n` +
        `• Durasi: ${report.durationText}`,
    });
  }

  return report;
}

module.exports = {
  runBroadcast,
  isRunning,
  requestStop,
  buildProgressBar,
};
