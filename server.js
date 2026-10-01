const http = require("http");
const fs = require("fs");
const path = require("path");
const { investigate, AGENT_IDS } = require("./agents");

const PORT = process.env.PORT || 3000;

/* Only these frontend files are served, so backend source is never exposed. */
const STATIC = {
  "/": ["index.html", "text/html; charset=utf-8"],
  "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/style.css": ["style.css", "text/css; charset=utf-8"],
  "/script.js": ["script.js", "text/javascript; charset=utf-8"]
};

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 20000) { reject(new Error("Request too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(JSON.parse(raw || "{}")); } catch { reject(new Error("Body must be valid JSON")); }
    });
  });
}

/* Check the input and return a clean copy, or throw a readable error. */
function cleanInput(body) {
  const complaint = typeof body.complaint === "string" ? body.complaint.trim() : "";
  if (!complaint) throw new Error("Please enter the complaint text.");
  if (complaint.length > 3000) throw new Error("Complaint is too long (max 3000 characters).");
  const str = v => (typeof v === "string" ? v.trim().toUpperCase().slice(0, 40) : "");
  return { complaint, customerId: str(body.customerId), orderId: str(body.orderId) };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (req.method === "GET" && STATIC[url.pathname]) {
    const [file, type] = STATIC[url.pathname];
    return fs.readFile(path.join(__dirname, file), (err, data) => {
      if (err) return sendJson(res, 500, { error: "Could not read " + file });
      res.writeHead(200, { "Content-Type": type });
      res.end(data);
    });
  }

  if (req.method === "POST" && url.pathname.startsWith("/api/")) {
    try {
      const input = cleanInput(await readJson(req));
      const results = investigate(input);

      // POST /api/investigate  -> every agent at once
      if (url.pathname === "/api/investigate") return sendJson(res, 200, results);

      // POST /api/agents/:id   -> one agent (the frontend calls these in order)
      const id = url.pathname.replace("/api/agents/", "");
      if (url.pathname.startsWith("/api/agents/") && AGENT_IDS.includes(id)) return sendJson(res, 200, results[id]);
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`Open http://localhost:${PORT}`));
