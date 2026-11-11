const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon"
};

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function allowedMediaHost(hostname) {
  const allowed = [
    "tiktok.com", "tiktokcdn.com", "tiktokv.com",
    "byteoversea.com", "ibytedtos.com", "muscdn.com", "tikwm.com"
  ];
  return allowed.some(domain => hostname === domain || hostname.endsWith("." + domain));
}

async function getTikTokVideo(tiktokUrl) {
  const apiUrl = new URL("https://www.tikwm.com/api/");
  apiUrl.searchParams.set("url", tiktokUrl);
  apiUrl.searchParams.set("hd", "1");

  const response = await fetch(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(25000)
  });

  if (!response.ok) throw new Error("Layanan pengambil video sedang tidak tersedia (HTTP " + response.status + ").");
  const payload = await response.json();
  if (payload.code !== 0 || !payload.data) {
    throw new Error(payload.msg || "TikTok tidak memberikan data video. Pastikan link publik dan coba lagi.");
  }

  const data = payload.data;
  const videoUrl = data.hdplay || data.play || data.wmplay;
  if (!videoUrl) throw new Error("Alamat video tidak ditemukan dari layanan.");
  return {
    videoUrl,
    title: data.title || "Video TikTok",
    cover: data.cover || data.origin_cover || ""
  };
}

async function proxyMedia(req, res, target) {
  let media;
  try {
    media = new URL(target);
  } catch {
    return sendJson(res, 400, { error: "URL video tidak valid." });
  }

  if (media.protocol !== "https:" || !allowedMediaHost(media.hostname)) {
    return sendJson(res, 403, { error: "Host video tidak diizinkan." });
  }

  try {
    const headers = {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
      "Referer": "https://www.tiktok.com/"
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetch(media, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(60000)
    });

    if (!upstream.ok && upstream.status !== 206) {
      return sendJson(res, 502, { error: "Gagal mengambil file video dari server sumber." });
    }

    const contentType = upstream.headers.get("content-type") || "video/mp4";
    const responseHeaders = {
      "Content-Type": contentType,
      "Accept-Ranges": upstream.headers.get("accept-ranges") || "bytes",
      "Cache-Control": "no-store",
      "Content-Disposition": "attachment; filename=\"snaptik-video.mp4\""
    };
    const contentLength = upstream.headers.get("content-length");
    const contentRange = upstream.headers.get("content-range");
    if (contentLength) responseHeaders["Content-Length"] = contentLength;
    if (contentRange) responseHeaders["Content-Range"] = contentRange;

    res.writeHead(upstream.status, responseHeaders);
    if (!upstream.body) return res.end();
    const reader = upstream.body.getReader();
    req.on("close", () => reader.cancel().catch(() => {}));
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!res.write(Buffer.from(value))) {
        await new Promise(resolve => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) sendJson(res, 502, { error: error.message || "Proxy video gagal." });
    else res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/video" && req.method === "GET") {
    const tiktokUrl = requestUrl.searchParams.get("url");
    if (!tiktokUrl) return sendJson(res, 400, { success: false, error: "Link TikTok belum diisi." });

    let parsed;
    try { parsed = new URL(tiktokUrl); } catch {
      return sendJson(res, 400, { success: false, error: "Format link tidak valid." });
    }
    if (!["http:", "https:"].includes(parsed.protocol) ||
        !(parsed.hostname === "tiktok.com" || parsed.hostname.endsWith(".tiktok.com"))) {
      return sendJson(res, 400, { success: false, error: "Link harus berasal dari TikTok." });
    }

    try {
      const video = await getTikTokVideo(tiktokUrl);
      return sendJson(res, 200, { success: true, ...video });
    } catch (error) {
      return sendJson(res, 502, { success: false, error: error.message || "Gagal mengambil video." });
    }
  }

  if (requestUrl.pathname === "/api/download" && req.method === "GET") {
    const target = requestUrl.searchParams.get("url");
    if (!target) return sendJson(res, 400, { error: "URL video tidak ditemukan." });
    return proxyMedia(req, res, target);
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Method Not Allowed");
  }

  const pathname = requestUrl.pathname === "/" ? "/index.html" : decodeURIComponent(requestUrl.pathname);
  const filePath = path.resolve(ROOT, "." + pathname);
  if (!filePath.startsWith(ROOT + path.sep)) {
    res.writeHead(403); return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("File tidak ditemukan.");
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    if (req.method === "HEAD") return res.end();
    res.end(content);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SnapTik berjalan di http://localhost:${PORT}`);
});
