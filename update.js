import fs from "fs";
import path from "path";
import https from "https";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    let raw = "";
    await new Promise((resolve) => {
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", resolve);
    });

    let json = JSON.parse(raw);

    const filePath = "/tmp/latest.json";
    fs.writeFileSync(filePath, JSON.stringify(json, null, 2));

    // ---- Trigger OneSignal on DANGER ----
    if (json.status === "DANGER") {
      const body = JSON.stringify({
        app_id: process.env.86947b42-989c-49cc-80fc-7e50960b8b7f,
        included_segments: ["All"],
        contents: { en: "⚠️ DANGER detected in water flow meter!" }
      });

      const reqOptions = {
        hostname: "api.onesignal.com",
        path: "/v1/notifications",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Basic ${process.env.67fhahjaqemmfe4iqapre7lk6}`
        }
      };

      const request = https.request(reqOptions);
      request.write(body);
      request.end();
    }

    return res.status(200).json({ success: true, saved: json });

  } catch (e) {
    return res.status(500).json({ error: e.toString() });
  }
}

