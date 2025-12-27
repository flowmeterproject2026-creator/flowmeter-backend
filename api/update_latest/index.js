import fs from "fs";
import path from "path";
import fetch from "node-fetch";

// ======================
// FILE PATHS
// ======================
const FILE_PATH = "/tmp/latest.json";
const HISTORY_PATH = "/tmp/history.json";

// ======================
// OneSignal Config
// ======================
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

export const config = {
  api: { bodyParser: false },
};

export default async function handler(req, res) {

  // ======================
  // POST → ESP32 sends data
  // ======================
  if (req.method === "POST") {

    let raw = "";
    await new Promise(resolve => {
      req.on("data", chunk => raw += chunk);
      req.on("end", resolve);
    });

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // 🔍 Load previous status
    let previousStatus = null;
    if (fs.existsSync(FILE_PATH)) {
      try {
        previousStatus = JSON.parse(fs.readFileSync(FILE_PATH)).status;
      } catch {}
    }

    // 💾 Save latest
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));

    // ⏱ Save history
    const entry = { ...data, timestamp: Date.now() };

    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH));
    }

    history.push(entry);

    if (history.length > 1000) {
      history = history.slice(-1000);
    }

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

    // 🚨 Notify only on SAFE → DANGER
    if (
      data.status?.toUpperCase() === "DANGER" &&
      previousStatus?.toUpperCase() !== "DANGER"
    ) {
      await sendOneSignalAlert(data);
    }

    return res.status(200).json({ success: true });
  }

  // ======================
  // GET → Dashboard (latest)
  // ======================
  if (req.method === "GET" && !req.query.date) {
    if (!fs.existsSync(FILE_PATH)) return res.json({});
    return res.json(JSON.parse(fs.readFileSync(FILE_PATH)));
  }

  // ======================
  // GET → History by date
  // ======================
  if (req.method === "GET" && req.query.date) {

    if (!fs.existsSync(HISTORY_PATH)) return res.json([]);

    const date = req.query.date;
    const start = new Date(date).setHours(0, 0, 0, 0);
    const end = new Date(date).setHours(23, 59, 59, 999);

    const history = JSON.parse(fs.readFileSync(HISTORY_PATH));

    const filtered = history.filter(
      h => h.timestamp >= start && h.timestamp <= end
    );

    return res.json(filtered);
  }

  res.status(405).end();
}

// ======================
// 🔔 OneSignal Push
// ======================
async function sendOneSignalAlert(data) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: { en: "🚨 FLOW METER ALERT" },
    contents: {
      en: `DANGER detected!\nPulses: ${data.pulses}\nRotations: ${data.rotations}`
    }
  };

  await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
}
