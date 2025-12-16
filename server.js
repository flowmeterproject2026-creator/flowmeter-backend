import express from "express";
import fs from "fs";

const app = express();
app.use(express.text());

// POST endpoint
app.post("/api/update", (req, res) => {
  try {
    const json = JSON.parse(req.body);

    fs.writeFileSync("/tmp/latest.json", JSON.stringify(json, null, 2));
    res.json({ success: true, saved: json });
  } catch (err) {
    res.status(400).json({ error: "Bad JSON", detail: err.toString() });
  }
});

// GET endpoint
app.get("/api/latest", (req, res) => {
  if (!fs.existsSync("/tmp/latest.json")) {
    return res.json({ status: "NO_DATA" });
  }

  const data = JSON.parse(fs.readFileSync("/tmp/latest.json"));
  res.json(data);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));
