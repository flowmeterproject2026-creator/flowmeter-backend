import fs from "fs";

export default function handler(req, res) {
  const file = "/tmp/latest.json";

  if (!fs.existsSync(file)) {
    return res.status(200).json({ status: "NO_DATA" });
  }

  const json = JSON.parse(fs.readFileSync(file));
  return res.status(200).json(json);
}

