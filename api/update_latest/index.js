import { MongoClient } from "mongodb";

// ===== ENV =====
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "flowmeter";
const HISTORY_COL = process.env.MONGODB_COLLECTION || "history";
const LATEST_COL = "latest";
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

const MAX_HISTORY_DOCS = 5000;
const MAX_BODY_BYTES = 512;
const SAVE_INTERVAL_MS = 10000;

// ===== Flow Analysis Config =====
const SAFE_THRESHOLD = 120;   // rotations above this = DANGER
const SPIKE_LIMIT = 40;       // sudden jump = DANGER
const NOISE_THRESHOLD = 2;    // ignore tiny changes

let cachedClient = null;
let lastSavedTime = 0;
let previousFlow = 0;         // ✅ server-side spike tracking

async function getClient() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

// ✅ Status computed on backend — single source of truth
function computeStatus(currentFlow) {
  let flow = currentFlow;

  // Ignore noise
  if (Math.abs(flow - previousFlow) < NOISE_THRESHOLD) {
    flow = previousFlow;
  }

  let status = "SAFE";

  if (flow > SAFE_THRESHOLD) {
    status = "DANGER";
  }

  if (Math.abs(flow - previousFlow) > SPIKE_LIMIT) {
    status = "DANGER";
  }

  previousFlow = flow;
  return status;
}

function compressReading(input) {
  return {
    p: Number(input.pulses ?? input.p ?? 0),
    r: Number(input.rotations ?? input.r ?? 0),
    la: Number(input.lat ?? input.la ?? 0),
    lo: Number(input.lon ?? input.lo ?? 0),
  };
}

function todayIST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

// ✅ Normalize status so Flutter always gets SAFE or DANGER, never NORMAL
function normalizeStatus(s) {
  if (!s) return "SAFE";
  const upper = String(s).toUpperCase();
  if (upper === "DANGER") return "DANGER";
  return "SAFE"; // NORMAL, SAFE, anything else → SAFE
}

export default async function handler(req, res) {
  // ✅ CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (!MONGODB_URI) {
    return res.status(500).json({ error: "MONGODB_URI missing" });
  }

  const client = await getClient();
  const db = client.db(DB_NAME);
  const historyCol = db.collection(HISTORY_COL);
  const latestCol = db.collection(LATEST_COL);

  // ==========================
  // ✅ POST — ESP32 sends data
  // ==========================
  if (req.method === "POST") {
    let raw = "";
    let size = 0;

    try {
      await new Promise((resolve, reject) => {
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return reject(new Error("Too large"));
          raw += chunk;
        });
        req.on("end", resolve);
        req.on("error", reject);
      });
    } catch (e) {
      return res.status(413).json({ error: "Payload too large" });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const compressed = compressReading(data);

    // ✅ Compute status server-side
    const status = computeStatus(compressed.r);

    const now = new Date();
    const entry = {
      ...compressed,
      s: status,
      t: now.getTime(),
      d: todayIST(),
    };

    // ✅ Get previous status for alert comparison
    const prev = await latestCol.findOne({ _id: "latest" });
    const previousStatus = normalizeStatus(prev?.s);

    // ✅ Update latest
    await latestCol.updateOne(
      { _id: "latest" },
      { $set: entry },
      { upsert: true }
    );

    // ✅ Save to history every 10 seconds
    if (Date.now() - lastSavedTime > SAVE_INTERVAL_MS) {
      await historyCol.insertOne({ ...entry });
      lastSavedTime = Date.now();

      // ✅ Trim old records
      const count = await historyCol.estimatedDocumentCount();
      if (count > MAX_HISTORY_DOCS) {
        const extra = count - MAX_HISTORY_DOCS;
        const oldest = await historyCol
          .find({})
          .sort({ t: 1 })
          .limit(extra)
          .project({ _id: 1 })
          .toArray();
        if (oldest.length > 0) {
          await historyCol.deleteMany({ _id: { $in: oldest.map((x) => x._id) } });
        }
      }
    }

    // ✅ OneSignal alert — only on DANGER transition
    if (status === "DANGER" && previousStatus !== "DANGER") {
      sendOneSignalAlert(entry);
    }

    return res.status(200).json({ success: true, status });
  }

  // ==========================
  // ✅ GET Latest
  // ==========================
  if (req.method === "GET" && !req.query.date && !req.query.csv) {
    const latest = await latestCol.findOne({ _id: "latest" });
    if (!latest) return res.status(200).json({});

    return res.status(200).json({
      pulses: latest.p,
      rotations: latest.r,
      lat: latest.la,
      lon: latest.lo,
      status: normalizeStatus(latest.s), // ✅ always SAFE or DANGER
      timestamp: latest.t,
      date: latest.d,
    });
  }

  // ==========================
  // ✅ GET History by date
  // ==========================
  if (req.method === "GET" && req.query.date && !req.query.csv) {
    const date = req.query.date;

    const list = await historyCol
      .find({ d: date })
      .sort({ t: -1 })
      .limit(2000)
      .toArray();

    return res.status(200).json(
      list.map((x) => ({
        pulses: x.p,
        rotations: x.r,
        lat: x.la,
        lon: x.lo,
        status: normalizeStatus(x.s), // ✅ normalized
        timestamp: x.t,
        date: x.d,
      }))
    );
  }

  // ==========================
  // ✅ CSV Export
  // ==========================
  if (req.method === "GET" && req.query.csv) {
    try {
      const filter = req.query.date ? { d: String(req.query.date) } : {};

      const list = await historyCol
        .find(filter)
        .sort({ t: 1 })
        .limit(5000)
        .toArray();

      let csv = "datetime,timestamp,status,pulses,rotations,lat,lon\n";

      for (const x of list) {
        const dt = new Date(Number(x.t)).toLocaleString("en-GB", {
          timeZone: "Asia/Kolkata",
          hour12: false,
        });
        csv += `"${dt}","${x.t}",${normalizeStatus(x.s)},${x.p},${x.r},${x.la},${x.lo}\n`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="flowmeter_history${
          req.query.date ? "_" + req.query.date : ""
        }.csv"`
      );

      return res.status(200).send(csv);
    } catch (e) {
      return res.status(500).json({ error: "CSV Export Failed", details: String(e) });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ======================
// 🔔 OneSignal Alert
// ======================
async function sendOneSignalAlert(entry) {
  try {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;

    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        included_segments: ["All"],
        headings: { en: "🚨 FLOW METER ALERT" },
        contents: {
          en: `⚠️ DANGER detected!\nPulses: ${entry.p} | Rotations: ${entry.r}\nLocation: ${entry.la}, ${entry.lo}`,
        },
        data: {
          pulses: entry.p,
          rotations: entry.r,
          lat: entry.la,
          lon: entry.lo,
          status: entry.s,
        },
      }),
    });
  } catch (e) {
    console.error("OneSignal error:", e);
  }
}



