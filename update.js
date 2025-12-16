import fs from "fs";

export const config = { api: { bodyParser: false } };

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

    if (!raw || raw.trim().length === 0) {
      return res.status(400).json({ error: "Empty body received" });
    }

    let json;
    try {
      json = JSON.parse(raw);
    } catch (err) {
      return res.status(400).json({ error: "Bad JSON", raw });
    }

    const { pulses, rotations, lat, lon, status } = json;

    if (
      pulses === undefined ||
      rotations === undefined ||
      lat === undefined ||
      lon === undefined ||
      status === undefined
    ) {
      return res
        .status(400)
        .json({ error: "Missing fields", received: json });
    }

    fs.writeFileSync("/tmp/latest.json", JSON.stringify(json, null, 2));

    return res.status(200).json({ success: true, saved: json });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "Server error", detail: err.toString() });
  }
}
