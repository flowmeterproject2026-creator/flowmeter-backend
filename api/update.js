import fs from "fs";

export const config = {
  api: { bodyParser: false }
};

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Only POST allowed" });
    }

    let raw = "";
    await new Promise(resolve => {
      req.on("data", chunk => raw += chunk);
      req.on("end", resolve);
    });

    let json = JSON.parse(raw);

    fs.writeFileSync("/tmp/latest.json", JSON.stringify(json, null, 2));
    console.log("💾 Saved to /tmp/latest.json");

    return res.status(200).json({ success: true, saved: json });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.toString() });
  }
}

