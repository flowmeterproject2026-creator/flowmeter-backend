import fs from "fs";

// ======================
// FILE PATH
// ======================
const FILE_PATH = "/tmp/latest.json";

// ======================
// OneSignal Config
// ======================
console.log("ONESIGNAL_APP_ID =", process.env.ONESIGNAL_APP_ID);

const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {

  // ======================
  // POST → ESP32 sends data
  // ======================
  if (req.method === "POST") {

    let raw = "";
    await new Promise((resolve) => {
      req.on("data", chunk => raw += chunk);
      req.on("end", resolve);
    });

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // 🔍 Load previous data (if exists)
    let previousStatus = null;
    if (fs.existsSync(FILE_PATH)) {
      try {
        const prev = JSON.parse(fs.readFileSync(FILE_PATH));
        previousStatus = prev.status;
      } catch {}
    }

    // 💾 Save latest data
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));

    // 🚨 SEND ALERT ONLY WHEN STATUS CHANGES TO DANGER
    if (
      data.status &&
      data.status.toUpperCase() === "DANGER" &&
      previousStatus?.toUpperCase() !== "DANGER"
    ) {
      console.log("🚨 DANGER detected — sending notification");
      await sendOneSignalAlert(data);
    }

    return res.status(200).json({
      success: true,
      saved: data
    });
  }

  // ======================
  // GET → Android fetches data
  // ======================
  if (req.method === "GET") {
    if (!fs.existsSync(FILE_PATH)) {
      return res.status(200).json({ status: "NO_DATA" });
    }
    return res.status(200).json(
      JSON.parse(fs.readFileSync(FILE_PATH))
    );
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}

// ======================
// 🔔 OneSignal Push
// ======================
async function sendOneSignalAlert(data) {

  if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) {
    console.error("❌ OneSignal env vars missing");
    return;
  }

  const payload = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: { en: "🚨 FLOW METER ALERT" },
    contents: {
      en: `DANGER detected!\nPulses: ${data.pulses}\nRotations: ${data.rotations}`
    }
  };

  const response = await fetch(
    "https://onesignal.com/api/v1/notifications",
    {
      method: "POST",
      headers: {
        "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    }
  );

  const result = await response.json();
  console.log("📤 OneSignal response:", result);
}
