const fs = require("fs");

function readJSON(path, fallback) {
  try {
    if (!fs.existsSync(path)) return fallback;
    return JSON.parse(fs.readFileSync(path, "utf-8"));
  } catch (e) {
    return fallback;
  }
}

function writeJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

module.exports = { readJSON, writeJSON };
