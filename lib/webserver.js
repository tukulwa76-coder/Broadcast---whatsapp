const express = require("express");
const config = require("../config");

let latestPairingCode = null;
let connectionStatus = "starting"; // starting | waiting_pairing | connected | disconnected

function setPairingCode(code) {
  latestPairingCode = code;
  connectionStatus = "waiting_pairing";
}

function setConnected() {
  connectionStatus = "connected";
  latestPairingCode = null;
}

function setDisconnected() {
  connectionStatus = "disconnected";
}

function startWebServer() {
  const app = express();

  app.get("/", (req, res) => {
    res.send(`
      <html>
        <head><title>WA Bot Status</title></head>
        <body style="font-family: sans-serif; padding: 2rem;">
          <h2>🤖 WA Bot Broadcast</h2>
          <p><b>Status:</b> ${connectionStatus}</p>
          ${
            latestPairingCode
              ? `<p><b>Kode Pairing:</b> <span style="font-size:2rem; letter-spacing:4px;">${latestPairingCode}</span></p>
                 <p>Buka WhatsApp → Perangkat Tertaut → Tautkan dengan nomor telepon → masukkan kode di atas (berlaku sekitar 1 menit, refresh halaman ini kalau expired).</p>`
              : "<p>Tidak ada kode pairing aktif (bot sudah terhubung atau belum meminta kode).</p>"
          }
        </body>
      </html>
    `);
  });

  // Health check endpoint buat Railway
  app.get("/health", (req, res) => res.json({ status: connectionStatus }));

  app.listen(config.PORT, () => {
    console.log(`🌐 Web server jalan di port ${config.PORT} (buka untuk lihat status/kode pairing)`);
  });
}

module.exports = { startWebServer, setPairingCode, setConnected, setDisconnected };
