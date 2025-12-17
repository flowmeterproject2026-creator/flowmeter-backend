import fs from "fs";

export default function handler(req, res) {
  const filePath = "/tmp/latest.json";

  if (!fs.existsSync(filePath)) {
    return res.status(200).json({ status: "NO_DATA" });
  }

  const data = JSON.parse(fs.readFileSync(filePath));
  res.status(200).json(data);
}
