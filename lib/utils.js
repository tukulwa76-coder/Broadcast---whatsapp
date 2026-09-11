const config = require("../config");

function isOwner(senderJid) {
  const number = senderJid.split("@")[0].split(":")[0];
  return config.OWNER_NUMBERS.includes(number);
}

async function getAllGroupJids(sock) {
  const groups = await sock.groupFetchAllParticipating();
  return Object.keys(groups);
}

async function getAllGroupsWithNames(sock) {
  const groups = await sock.groupFetchAllParticipating();
  return Object.entries(groups).map(([id, meta]) => ({
    id,
    subject: meta.subject || "(tanpa nama)",
  }));
}

/**
 * Ambil konten broadcast dari pesan yang di-reply (quoted message), atau dari teks command langsung.
 * Mendukung: teks biasa, teks+media (foto/video+caption), dokumen, teks panjang berparagraf (\n aman).
 */
function extractBroadcastContent(msg, fallbackText) {
  const quoted =
    msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

  if (quoted) {
    if (quoted.conversation) {
      return { text: quoted.conversation };
    }
    if (quoted.extendedTextMessage) {
      return { text: quoted.extendedTextMessage.text };
    }
    if (quoted.imageMessage) {
      return {
        image: { url: undefined }, // diisi ulang oleh handler via downloadMediaMessage jika perlu
        caption: quoted.imageMessage.caption || "",
        __rawQuoted: quoted,
        __type: "image",
      };
    }
    if (quoted.videoMessage) {
      return {
        caption: quoted.videoMessage.caption || "",
        __rawQuoted: quoted,
        __type: "video",
      };
    }
    if (quoted.documentMessage) {
      return {
        caption: quoted.documentMessage.caption || "",
        fileName: quoted.documentMessage.fileName,
        __rawQuoted: quoted,
        __type: "document",
      };
    }
  }

  // fallback: teks langsung setelah command, mendukung multi-baris/paragraf
  if (fallbackText && fallbackText.trim().length > 0) {
    return { text: fallbackText };
  }

  return null;
}

module.exports = { isOwner, getAllGroupJids, getAllGroupsWithNames, extractBroadcastContent };
