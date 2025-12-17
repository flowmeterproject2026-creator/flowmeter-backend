// api/update.js
import fs from "fs";
import path from "path";
import fetch from "node-fetch";

export const config = {
  api: {
    bodyParser: false, 
  },
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    // Read RAW Body
    let raw = "";
    await new Promise((resolve) => {
      req.on("data", chunk => raw += chunk);
      req.on("end", resolve);
    });

    console.log("RAW:", raw);

    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON", raw });
    }

    const { pulses, rotations, lat, lon, status } = json;

    // Save data to /tmp/latest.json
    const filePath = "/tmp/latest.json";
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2));

    // 🔔 If danger → Send push via OneSignal
    if (status === "DANGER") {
      await sendDangerNotification();
    }

    return res.status(200).json({ success: true, saved: json });

  } catch (err) {
    console.error("ERROR:", err);
    return res.status(500).json({ error: err.toString() });
  }
}

// -----------------------------------------------
// 🔔 OneSignal Notification Function
// -----------------------------------------------
async function sendDangerNotification() {
  const appId = "86947b42-989c-49cc-80fc-7e50960b8b7f";
  const apiKey = "67fhahjaqemmfe4iqapre7lk6";

  const body = {
    app_id: appId,
    included_segments: ["All"],
    headings: { "en": "🚨 DANGER ALERT" },
    contents: { "en": "Water flow sensor detected DANGER status!" }
  };

  await fetch("https://api.onesignal.com/notifications", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
}

