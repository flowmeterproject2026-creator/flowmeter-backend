import fs from "fs";

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
  res.setHeader("Access-Control-Allow-Origin", "*");
res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");

if (req.method === "OPTIONS") {
  return res.status(200).end();
}


  // ======================
  // POST → ESP32
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

    // Load previous status
    let previousStatus = null;
    if (fs.existsSync(FILE_PATH)) {
      try {
        previousStatus = JSON.parse(fs.readFileSync(FILE_PATH)).status;
      } catch {}
    }

    // Save latest
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));

    // ===== HISTORY (SAFE, SINGLE now) =====
    const now = new Date();

    const entry = {
      ...data,
      timestamp: now.getTime(),
      date: now.toLocaleDateString("en-CA", {
        timeZone: "Asia/Kolkata"
      })
    };

    let history = [];
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH));
    }

    history.push(entry);
    if (history.length > 1000) history = history.slice(-1000);

    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2));

    // 🚨 OneSignal (SAFE → DANGER only)
    if (
      data.status?.toUpperCase() === "DANGER" &&
      previousStatus?.toUpperCase() !== "DANGER"
    ) {
      await sendOneSignalAlert(data);
    }

    return res.status(200).json({ success: true });
  }

  // ======================
  // GET → Latest
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
    const history = JSON.parse(fs.readFileSync(HISTORY_PATH));
    return res.json(history.filter(h => h.date === req.query.date));
  }

  return res.status(405).end();
}

// ======================
// 🔔 OneSignal Push (NO IMPORTS)
// ======================
async function sendOneSignalAlert(data) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;

  await fetch("https://onesignal.com/api/v1/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      included_segments: ["All"],
      headings: { en: "🚨 FLOW METER ALERT" },
      contents: {
        en: `DANGER detected!\nPulses: ${data.pulses}\nRotations: ${data.rotations}`
      }
    })
  });
}

