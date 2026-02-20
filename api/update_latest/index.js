import { MongoClient } from "mongodb";

// ===== ENV =====
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.MONGODB_DB || "flowmeter";
const HISTORY_COL = process.env.MONGODB_COLLECTION || "history";
const LATEST_COL = "latest";
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_API_KEY = process.env.ONESIGNAL_API_KEY;

// ===== CONFIG =====
const MAX_HISTORY_DOCS = 5000;
const MAX_BODY_BYTES = 512;
const SAVE_INTERVAL_MS = 10000;
const SAFE_THRESHOLD = 120;
const SPIKE_LIMIT = 40;
const NOISE_THRESHOLD = 2;

let cachedClient = null;

// ======================
// DB CONNECT
// ======================
async function getClient() {
  if (cachedClient) return cachedClient;
  const client = new MongoClient(MONGODB_URI);
  await client.connect();
  cachedClient = client;
  return client;
}

// ======================
// STATUS LOGIC
// ======================
function computeStatus(currentFlow, previousFlow) {
  let flow = currentFlow;

  // ignore noise
  if (Math.abs(flow - previousFlow) < NOISE_THRESHOLD) {
    flow = previousFlow;
  }

  let status = "SAFE";

  // threshold check
  if (flow > SAFE_THRESHOLD) {
    status = "DANGER";
  }

  // spike check
  if (Math.abs(flow - previousFlow) > SPIKE_LIMIT) {
    status = "DANGER";
  }

  return { status, flow };
}
// ======================
// HELPERS
// ======================
function compressReading(input) {
  return {
    p: Number(input.pulses ?? input.p ?? 0),
    r: Number(input.rotations ?? input.r ?? 0),
    la: Number(input.lat ?? input.la ?? 0),
    lo: Number(input.lon ?? input.lo ?? 0),
  };
}

function todayIST() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });
}

function normalizeStatus(s) {
  return String(s).toUpperCase() === "DANGER" ? "DANGER" : "SAFE";
}

// ======================
// MAIN HANDLER
// ======================
export default async function handler(req, res) {
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
  // POST (ESP32)
  // ==========================
  if (req.method === "POST") {
    let raw = "";
    let size = 0;

    try {
      await new Promise((resolve, reject) => {
        req.on("data", (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) return reject();
          raw += chunk;
        });
        req.on("end", resolve);
        req.on("error", reject);
      });
    } catch {
      return res.status(413).json({ error: "Payload too large" });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(400).json({ error: "Invalid JSON" });
    }

    const compressed = compressReading(data);

    // ✅ previous data
    const prev = await latestCol.findOne({ _id: "latest" }) || {};
    const previousFlow = prev.r || 0;
    const lastAlertTime = prev.lastAlert || 0;

    // ✅ compute status
    const { status, flow } = computeStatus(compressed.r, previousFlow);
    const nowTime = Date.now();

    const entry = {
      p: compressed.p,
      r: flow,
      la: compressed.la,
      lo: compressed.lo,
      s: status,
      t: nowTime,
      d: todayIST(),
    };

    // ==========================
    // SAVE HISTORY
    // ==========================
 // ==========================
// SAVE HISTORY (FIXED)
// ==========================
// ✅ FAST HISTORY SAVE (NO QUERY)
if (nowTime - (prev.t || 0) > SAVE_INTERVAL_MS) {
  await historyCol.insertOne(entry);

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
      await historyCol.deleteMany({
        _id: { $in: oldest.map(x => x._id) }
      });
    }
  }
}

    // ==========================
    // ALERT LOGIC
    // ==========================
    const cooldownMs = 10000;
    let alertTime = lastAlertTime;

    if (status === "DANGER" && nowTime - lastAlertTime > cooldownMs) {
      alertTime = nowTime;
      sendOneSignalAlert(entry);
    }

    // ==========================
    // UPDATE LATEST (SAFE)
    // ==========================
    await latestCol.updateOne(
  { _id: "latest" },
  {
    $set: {
      p: entry.p,
      r: entry.r,
      la: entry.la,
      lo: entry.lo,
      s: entry.s,
      t: entry.t,
      d: entry.d,
      lastAlert: alertTime,
    },
  },
  { upsert: true }
);


    return res.status(200).json({ success: true, status });
  }

  // ==========================
  // GET LATEST
  // ==========================
  if (req.method === "GET" && !req.query.date && !req.query.csv) {
    const latest = await latestCol.findOne({ _id: "latest" });
    if (!latest) return res.status(200).json({});

    return res.status(200).json({
      pulses: latest.p,
      rotations: latest.r,
      lat: latest.la,
      lon: latest.lo,
      status: normalizeStatus(latest.s),
      timestamp: latest.t,
      date: latest.d,
    });
  }

  // ==========================
  // GET HISTORY
  // ==========================
  if (req.method === "GET" && req.query.date && !req.query.csv) {
    const list = await historyCol
      .find({ d: req.query.date })
      .sort({ t: -1 })
      .limit(2000)
      .toArray();

    return res.status(200).json(
      list.map((x) => ({
        pulses: x.p,
        rotations: x.r,
        lat: x.la,
        lon: x.lo,
        status: normalizeStatus(x.s),
        timestamp: x.t,
        date: x.d,
      }))
    );
  }

  // ==========================
  // CSV EXPORT
  // ==========================
  if (req.method === "GET" && req.query.csv) {
    try {
      const filter = req.query.date ? { d: String(req.query.date) } : {};

      const list = await historyCol
        .find(filter)
        .sort({ t: 1 })
        .limit(5000)
        .toArray();

      let csv =
        "datetime,timestamp,status,pulses,rotations,lat,lon\n";

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
        `attachment; filename="flowmeter_${req.query.date || "all"}.csv"`
      );

      return res.status(200).send(csv);
    } catch {
      return res.status(500).json({ error: "CSV Export Failed" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}

// ======================
// 🔔 ALERT
// ======================
async function sendOneSignalAlert(entry) {
  try {
    if (!ONESIGNAL_APP_ID || !ONESIGNAL_API_KEY) return;

    const mapUrl = `https://www.google.com/maps?q=${entry.la},${entry.lo}`;

    await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        Authorization: `Basic ${ONESIGNAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        app_id: ONESIGNAL_APP_ID,
        included_segments: ["All"],
        headings: { en: "🚨 FLOW ALERT" },
        contents: {
          en: `DANGER detected!\nRotations: ${entry.r}\n📍 Tap to view location`,
        },
        url: mapUrl,
        data: {
          type: "OPEN_MAP",
          lat: entry.la,
          lon: entry.lo,
        },
      }),
    });
  } catch (e) {
    console.error(e);
  }
}
