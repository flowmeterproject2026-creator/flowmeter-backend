import fs from "fs";

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  const path = "/tmp/latest.json";

  if (req.method === "POST") {
    let raw = "";
    await new Promise((resolve) => {
      req.on("data", (c) => (raw += c));
      req.on("end", resolve);
    });

    try {
      const json = JSON.parse(raw);
      fs.writeFileSync(path, JSON.stringify(json, null, 2));
      return res.status(200).json({ success: true, saved: json });
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON", raw });
    }
  }

  if (req.method === "GET") {
    if (!fs.existsSync(path)) {
      return res.status(200).json({ status: "NO_DATA" });
    }
    const json = JSON.parse(fs.readFileSync(path));
    return res.status(200).json(json);
  }

  return res.status(405).json({ error: "Method Not Allowed" });
}
