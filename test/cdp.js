// 极简 CDP 真机自测：xvfb 下启动 electron（--remote-debugging-port），连 WS，跑一段脚本。
// 用法: xvfb-run -a node test/cdp.js
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

const PORT = 9333;
const ROOT = path.join(__dirname, "..");

function get(url) {
  return new Promise((res, rej) => {
    http.get(url, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }).on("error", rej);
  });
}
async function waitTarget() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = JSON.parse(await get(`http://127.0.0.1:${PORT}/json/list`));
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("no CDP target");
}

// 迷你 WS 客户端（避免依赖）
const crypto = require("crypto");
const net = require("net");
function wsConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(+u.port, u.hostname, () => {
      sock.write(
        `GET ${u.pathname}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`
      );
    });
    let buf = Buffer.alloc(0), handshook = false;
    const listeners = {};
    let msgId = 0; const pending = {};
    function onFrame(payload) {
      const msg = JSON.parse(payload);
      if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    }
    function parse() {
      while (buf.length >= 2) {
        const len0 = buf[1] & 127; let off = 2, len = len0;
        if (len0 === 126) { len = buf.readUInt16BE(2); off = 4; }
        else if (len0 === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.slice(off, off + len).toString();
        buf = buf.slice(off + len);
        if (payload) onFrame(payload);
      }
    }
    sock.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!handshook) {
        const idx = buf.indexOf("\r\n\r\n");
        if (idx < 0) return;
        handshook = true; buf = buf.slice(idx + 4);
        resolve(api);
      }
      if (handshook) parse();
    });
    sock.on("error", reject);
    function send(obj) {
      const data = Buffer.from(JSON.stringify(obj));
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(data.length);
      for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
      let header;
      if (data.length < 126) header = Buffer.from([0x81, 0x80 | data.length]);
      else if (data.length < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(data.length, 2); }
      else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(data.length), 2); }
      sock.write(Buffer.concat([header, mask, masked]));
    }
    const api = {
      eval(expression) {
        return new Promise((res) => {
          const id = ++msgId;
          pending[id] = (m) => res(m.result && m.result.result ? m.result.result.value : undefined);
          send({ id, method: "Runtime.evaluate", params: { expression, returnByValue: true, awaitPromise: true } });
        });
      },
      close() { sock.end(); },
    };
  });
}

(async () => {
  const scriptPath = process.argv[2];
  const runner = scriptPath ? require(path.resolve(scriptPath)) : null;
  const proc = spawn(path.join(ROOT, "node_modules/.bin/electron"), [".", `--remote-debugging-port=${PORT}`, "--no-sandbox"], {
    cwd: ROOT, env: { ...process.env, NP_DEBUG: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout.on("data", (d) => process.stdout.write(`[e] ${d}`));
  proc.stderr.on("data", (d) => process.stderr.write(`[e!] ${d}`));
  try {
    const page = await waitTarget();
    const cdp = await wsConnect(page.webSocketDebuggerUrl);
    await new Promise((r) => setTimeout(r, 1200));
    const ok = runner ? await runner(cdp) : true;
    cdp.close();
    proc.kill("SIGKILL");
    process.exit(ok ? 0 : 1);
  } catch (e) {
    console.error("TEST ERROR", e);
    proc.kill("SIGKILL");
    process.exit(2);
  }
})();
