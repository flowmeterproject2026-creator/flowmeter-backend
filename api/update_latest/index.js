import fs from "fs";

const FILE_PATH = "/tmp/latest.json";
const ALERT_FLAG = "/tmp/alert_sent.flag";

// 🔔 OneSignal Config
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
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    // Save latest data
    fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2));

    // 🚨 DANGER notification logic
    if (data.status === "DANGER") {
      if (!fs.existsSync(ALERT_FLAG)) {
        await sendOneSignalAlert(data);
        fs.writeFileSync(ALERT_FLAG, "sent");
      }
    } else {
      // Reset alert when back to NORMAL
      if (fs.existsSync(ALERT_FLAG)) {
        fs.unlinkSync(ALERT_FLAG);
      }
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

    const json = JSON.parse(fs.readFileSync(FILE_PATH));
    return res.status(200).json(json);
  }

  // ======================
  return res.status(405).json({ error: "Method Not Allowed" });
}


// ======================
// 🔔 OneSignal Push
// ======================
async function sendOneSignalAlert(data) {
  const payload = {
    app_id: ONESIGNAL_APP_ID,
    included_segments: ["All"],
    headings: {
      en: "🚨 FLOW METER ALERT"
    },
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
