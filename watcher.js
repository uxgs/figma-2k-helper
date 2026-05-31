/**
 * Figma Image Watcher
 * Usage: node watcher.js <path-to-folder>
 *
 * Watches an entire folder of images. The Figma plugin connects once
 * and can pick any file inside it from a dropdown.
 */

const fs   = require("fs");
const http = require("http");
const path = require("path");

const WATCH_DIR = path.resolve(process.argv[2] || ".");
const PORT      = 3333;
const IMAGE_EXT = /\.(png|jpg|jpeg|gif|webp)$/i;

if (!fs.existsSync(WATCH_DIR) || !fs.statSync(WATCH_DIR).isDirectory()) {
  console.error(`Not a directory: ${WATCH_DIR}`);
  console.error("Usage: node watcher.js <path-to-folder>");
  process.exit(1);
}

// version counter per relative path — incremented on every detected change
const versions = {};

// Recursively collect all image files, returning forward-slash relative paths
function scanDir(dir, base) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const rel = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        results.push(...scanDir(path.join(dir, entry.name), rel));
      } else if (IMAGE_EXT.test(entry.name)) {
        results.push(rel);
      }
    }
  } catch (e) { /* skip unreadable dirs */ }
  return results.sort();
}

// Seed initial versions
scanDir(WATCH_DIR, "").forEach(f => { if (!versions[f]) versions[f] = 1; });

// recursive:true works on Windows and macOS
fs.watch(WATCH_DIR, { recursive: true }, (eventType, filename) => {
  if (!filename || !IMAGE_EXT.test(filename)) return;
  const relPath = filename.replace(/\\/g, "/");
  setTimeout(() => {
    const filepath = path.join(WATCH_DIR, filename);
    if (fs.existsSync(filepath)) {
      versions[relPath] = (versions[relPath] || 0) + 1;
      const ts = new Date().toLocaleTimeString();
      console.log(`[${ts}] Changed: ${relPath} (v${versions[relPath]})`);
    }
  }, 100);
});

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/ping") {
    const files = scanDir(WATCH_DIR, "").map(name => ({ name, version: versions[name] || 1 }));
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ dir: path.basename(WATCH_DIR), files }));
    return;
  }

  if (url.pathname === "/image") {
    const name     = url.searchParams.get("name") || "";
    const filepath = path.resolve(WATCH_DIR, name);
    // Prevent path traversal
    if (!filepath.startsWith(WATCH_DIR) || !fs.existsSync(filepath)) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader("Content-Type", "image/png");
    res.end(fs.readFileSync(filepath));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Watching folder : ${WATCH_DIR}`);
  console.log(`Serving         : http://localhost:${PORT}`);
  console.log(`Images found    : ${scanDir(WATCH_DIR, "").length}`);
  console.log("\nOpen the Sync tab in the Figma plugin to pick a file.");
});
