const express = require("express");
const multer  = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const { spawn } = require("child_process");
const os   = require("os");
const path = require("path");
const fs   = require("fs");

const app  = express();
const PORT = process.env.PORT || 80;

// ── ENV ───────────────────────────────────────────────────────────────────────
const S3_BUCKET  = process.env.S3_BUCKET;
const AWS_REGION = process.env.AWS_REGION;

// ── S3 CLIENT (credentials auto-resolved from ECS Task IAM Role) ──────────────
const s3 = new S3Client({ region: AWS_REGION });

// ── MULTER (temp disk storage) ────────────────────────────────────────────────
const upload = multer({
  dest: "/tmp/uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files allowed"));
    }
    cb(null, true);
  },
});

// ── K6 STATE ──────────────────────────────────────────────────────────────────
let k6proc = null;
let k6log  = [];
const MAX_LOG = 80;

// ── CPU USAGE HELPER ──────────────────────────────────────────────────────────
function getCpuUsage() {
  return new Promise((resolve) => {
    const c1 = os.cpus();
    setTimeout(() => {
      const c2 = os.cpus();
      let idle = 0, total = 0;
      c1.forEach((cpu, i) => {
        const d = Object.fromEntries(
          Object.entries(c2[i].times).map(([k, v]) => [k, v - cpu.times[k]])
        );
        idle  += d.idle;
        total += Object.values(d).reduce((a, b) => a + b, 0);
      });
      resolve(total ? Math.round(100 - (100 * idle / total)) : 0);
    }, 500);
  });
}

// ── MIDDLEWARE ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

// ── INDEX PAGE ────────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const containerId = os.hostname();

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Project ECS | CloudFolks HUB</title>
  <link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Barlow+Condensed:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    :root{
      --bg:#080c10;--panel:#0d1520;--border:#1a2a3a;
      --accent:#00c8ff;--red:#ff4d6d;--green:#00ff88;
      --text:#cde4f5;--muted:#4a6a8a;
      --mono:'Share Tech Mono',monospace;
      --display:'Barlow Condensed',sans-serif;
    }
    body{
      background:var(--bg);color:var(--text);font-family:var(--mono);min-height:100vh;
      background-image:
        radial-gradient(ellipse 80% 50% at 50% -10%,rgba(0,200,255,.08),transparent),
        repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(0,200,255,.03) 40px),
        repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(0,200,255,.03) 40px);
    }

    /* ── TOPBAR ── */
    .topbar{
      border-bottom:1px solid var(--border);padding:14px 32px;
      display:flex;align-items:center;justify-content:space-between;
      background:rgba(13,21,32,.95);backdrop-filter:blur(10px);
      position:sticky;top:0;z-index:10;
    }
    .brand{font-family:var(--display);font-size:22px;font-weight:800;
      letter-spacing:2px;color:var(--accent);text-transform:uppercase;}
    .brand span{color:var(--text);font-weight:400;}
    .cid-tag{font-size:11px;color:var(--muted);letter-spacing:1px;}
    .cid-tag strong{color:var(--accent);}

    /* ── LAYOUT ── */
    .main{max-width:980px;margin:0 auto;padding:36px 24px;display:grid;gap:22px;}
    .panel{
      background:var(--panel);border:1px solid var(--border);
      border-radius:4px;padding:26px;position:relative;overflow:hidden;
    }
    .panel::before{
      content:'';position:absolute;top:0;left:0;right:0;height:2px;
      background:linear-gradient(90deg,transparent,var(--accent),transparent);
    }
    .ptitle{
      font-family:var(--display);font-size:12px;font-weight:600;
      letter-spacing:3px;text-transform:uppercase;color:var(--muted);margin-bottom:20px;
    }

    /* ── UPLOAD PANEL ── */
    .uform{display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
    .flabel{
      display:inline-flex;align-items:center;gap:8px;padding:10px 18px;
      border:1px solid var(--border);border-radius:3px;cursor:pointer;
      font-size:13px;color:var(--text);transition:border-color .2s,color .2s;
    }
    .flabel:hover{border-color:var(--accent);color:var(--accent);}
    #fi{display:none;}
    #fn{font-size:12px;color:var(--muted);}
    .btn-upload{
      padding:10px 22px;border:none;border-radius:3px;font-family:var(--mono);
      font-size:13px;font-weight:bold;cursor:pointer;letter-spacing:1px;
      background:var(--accent);color:var(--bg);transition:all .2s;
    }
    .btn-upload:hover{background:#33d4ff;transform:translateY(-1px);}

    /* ── STRESS TEST PANEL ── */
    .sgrid{
      display:grid;grid-template-columns:240px 1fr;gap:28px;align-items:start;
    }
    @media(max-width:660px){.sgrid{grid-template-columns:1fr;}}

    .controls{display:flex;flex-direction:column;gap:13px;}

    /* sliders */
    .cfg{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
    .cfg label{
      font-size:11px;color:var(--muted);letter-spacing:1px;
      display:flex;flex-direction:column;gap:5px;
    }
    .cfg input[type=range]{width:100%;accent-color:var(--accent);}
    .cfg .val{color:var(--accent);font-size:13px;}

    /* url input */
    .url-wrap{display:flex;flex-direction:column;gap:5px;}
    .url-wrap label{font-size:11px;color:var(--muted);letter-spacing:1px;}
    .url-input{
      background:#040810;border:1px solid var(--border);border-radius:3px;
      padding:8px 10px;color:var(--text);font-family:var(--mono);
      font-size:12px;width:100%;outline:none;transition:border-color .2s;
    }
    .url-input:focus{border-color:var(--accent);}

    /* buttons */
    .btn-k6{
      width:100%;padding:13px;font-size:13px;letter-spacing:2px;
      background:transparent;border-radius:3px;font-family:var(--mono);
      font-weight:bold;cursor:pointer;transition:all .2s;
    }
    .btn-start{border:2px solid var(--green);color:var(--green);}
    .btn-start:hover:not(:disabled){background:rgba(0,255,136,.1);transform:translateY(-1px);}
    .btn-stop {border:2px solid var(--red);color:var(--red);}
    .btn-stop:hover:not(:disabled){background:rgba(255,77,109,.1);transform:translateY(-1px);}
    .btn-k6:disabled{opacity:.3;cursor:not-allowed;transform:none;}

    /* status row */
    .srow{display:flex;align-items:center;gap:9px;font-size:11px;letter-spacing:1px;}
    .dot{
      width:8px;height:8px;border-radius:50%;background:var(--muted);
      flex-shrink:0;transition:background .4s,box-shadow .4s;
    }
    .dot.on{background:var(--green);box-shadow:0 0 8px var(--green);animation:blink 1.2s infinite;}
    .dot.off{background:var(--red);box-shadow:0 0 8px var(--red);}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.25}}

    /* ── RIGHT COLUMN ── */
    .right-col{display:flex;flex-direction:column;gap:16px;}

    /* gauge */
    .gauge-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;}
    .gauge-track{fill:none;stroke:var(--border);stroke-width:11;}
    .gauge-fill{
      fill:none;stroke-width:11;stroke-linecap:round;
      transition:stroke-dashoffset .7s ease,stroke .7s ease;
    }
    .gval{
      font-family:var(--display);font-size:52px;font-weight:800;
      fill:var(--text);dominant-baseline:middle;text-anchor:middle;transition:fill .7s;
    }
    .gunit{font-family:var(--mono);font-size:12px;fill:var(--muted);
      dominant-baseline:middle;text-anchor:middle;}
    .glabel{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--muted);}

    /* log box */
    .logbox{
      background:#040810;border:1px solid var(--border);border-radius:3px;
      height:170px;overflow-y:auto;padding:10px 14px;font-size:11px;
      line-height:1.8;color:#6a9abf;white-space:pre-wrap;word-break:break-all;
    }
    .logbox .hi  {color:var(--green);}
    .logbox .warn{color:#ffd700;}
    .logbox .err {color:var(--red);}

    /* footer */
    .footer{
      text-align:center;font-size:11px;color:var(--muted);
      padding:18px 0 36px;letter-spacing:1px;
    }
    .footer a{color:var(--accent);text-decoration:none;}
  </style>
</head>
<body>

<div class="topbar">
  <div class="brand">Project <span>ECS</span> &mdash; CloudFolks HUB</div>
  <div class="cid-tag">🆔 CONTAINER &nbsp;<strong>${containerId}</strong></div>
</div>

<div class="main">

  <!-- ── UPLOAD PANEL ── -->
  <div class="panel">
    <div class="ptitle">// 📤 Image Upload → S3</div>
    <form class="uform" action="/upload" method="post" enctype="multipart/form-data">
      <label class="flabel" for="fi">📁 Choose Image</label>
      <input type="file" id="fi" name="fileToUpload" accept="image/*" required
             onchange="document.getElementById('fn').textContent = this.files[0]?.name || ''">
      <span id="fn"></span>
      <button type="submit" class="btn-upload">Upload Now ↑</button>
    </form>
  </div>

  <!-- ── K6 STRESS TEST PANEL ── -->
  <div class="panel">
    <div class="ptitle">// 🔥 k6 Load Test — ALB + Autoscaling</div>
    <div class="sgrid">

      <!-- LEFT: controls -->
      <div class="controls">

        <div class="cfg">
          <label>
            VIRTUAL USERS
            <input type="range" id="vus" min="10" max="300" value="50" step="10"
                   oninput="document.getElementById('vusVal').textContent = this.value">
            <span class="val"><span id="vusVal">50</span> VUs</span>
          </label>
          <label>
            DURATION
            <input type="range" id="dur" min="1" max="30" value="10" step="1"
                   oninput="document.getElementById('durVal').textContent = this.value">
            <span class="val"><span id="durVal">10</span> min</span>
          </label>
        </div>

        <div class="url-wrap">
          <label>TARGET URL (ALB DNS name)</label>
          <input class="url-input" id="targetUrl" type="text"
                 placeholder="http://my-alb-123.us-east-1.elb.amazonaws.com">
        </div>

        <button class="btn-k6 btn-start" id="btnStart" onclick="startK6()">▶ START k6 TEST</button>
        <button class="btn-k6 btn-stop"  id="btnStop"  onclick="stopK6()" disabled>■ STOP k6 TEST</button>

        <div class="srow">
          <div class="dot" id="dot"></div>
          <span id="stxt" style="color:var(--muted)">IDLE</span>
        </div>

      </div>

      <!-- RIGHT: CPU gauge + live log -->
      <div class="right-col">

        <div class="gauge-wrap">
          <svg viewBox="0 0 180 155" width="165" height="145" style="overflow:visible">
            <path id="gtrack" class="gauge-track" d="M 22 138 A 68 68 0 1 1 158 138"/>
            <path id="gfill"  class="gauge-fill"  d="M 22 138 A 68 68 0 1 1 158 138" stroke="var(--accent)"/>
            <text id="gval" class="gval" x="90" y="104">0</text>
            <text class="gunit" x="90" y="126">% CPU</text>
          </svg>
          <div class="glabel">CONTAINER CPU — LIVE</div>
        </div>

        <div class="logbox" id="logbox"><span style="color:var(--muted)">k6 output will appear here once the test starts...</span></div>

      </div>
    </div>
  </div>

</div>

<div class="footer">
  🌐 <a href="https://www.cloudfolkshub.com" target="_blank">cloudfolkshub.com</a>
  &nbsp;—&nbsp; World leading cloud expert
</div>

<script>
  // ── Gauge ──────────────────────────────────────────────────────────────────
  const gfill  = document.getElementById('gfill');
  const gtrack = document.getElementById('gtrack');
  const gval   = document.getElementById('gval');
  let FL, TL;

  window.addEventListener('load', () => {
    FL = gfill.getTotalLength();
    TL = gtrack.getTotalLength();
    gfill.style.strokeDasharray   = FL;
    gfill.style.strokeDashoffset  = FL;
    gtrack.style.strokeDasharray  = TL;
    gtrack.style.strokeDashoffset = 0;
  });

  function setCpu(p) {
    p = Math.max(0, Math.min(100, p));
    if (!FL) return;
    gfill.style.strokeDashoffset = FL - (FL * p / 100);
    const c = p < 50 ? 'var(--accent)' : p < 80 ? '#ffd700' : 'var(--red)';
    gfill.style.stroke = c;
    gval.textContent   = Math.round(p);
    gval.style.fill    = c;
  }

  // Poll CPU every 1.5 s
  setInterval(async () => {
    try { const d = await (await fetch('/cpu')).json(); setCpu(d.cpu); } catch(_) {}
  }, 1500);

  // ── Live log ───────────────────────────────────────────────────────────────
  const logbox = document.getElementById('logbox');
  let logPoll = null, logOffset = 0;

  function appendLog(lines) {
    if (!lines.length) return;
    if (logbox.querySelector('span')) logbox.innerHTML = '';
    lines.forEach(l => {
      const d = document.createElement('div');
      d.textContent = l;
      if (/http_req_duration|default|✓/.test(l)) d.className = 'hi';
      else if (/WARN/.test(l))                    d.className = 'warn';
      else if (/error|ERRO|failed/i.test(l))      d.className = 'err';
      logbox.appendChild(d);
    });
    logbox.scrollTop = logbox.scrollHeight;
    while (logbox.children.length > 150) logbox.removeChild(logbox.firstChild);
  }

  function startLogPoll() {
    logOffset = 0; logbox.innerHTML = '';
    logPoll = setInterval(async () => {
      try {
        const d = await (await fetch('/k6/log?offset=' + logOffset)).json();
        if (d.lines.length) { appendLog(d.lines); logOffset = d.nextOffset; }
      } catch(_) {}
    }, 1000);
  }

  function stopLogPoll() { clearInterval(logPoll); logPoll = null; }

  // ── Controls ───────────────────────────────────────────────────────────────
  async function startK6() {
    const url = document.getElementById('targetUrl').value.trim();
    if (!url) { alert('Please enter your ALB Target URL first.'); return; }
    const vus = document.getElementById('vus').value;
    const dur = document.getElementById('dur').value + 'm';
    document.getElementById('btnStart').disabled = true;
    try {
      const r = await fetch('/k6/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, vus, duration: dur })
      });
      const d = await r.json();
      if (d.ok) {
        document.getElementById('btnStop').disabled = false;
        setStatus('on', 'RUNNING — ' + vus + ' VUs / ' + dur);
        startLogPoll();
      } else {
        document.getElementById('btnStart').disabled = false;
        appendLog(['ERROR: ' + (d.error || 'k6 failed to start')]);
      }
    } catch(e) {
      document.getElementById('btnStart').disabled = false;
      appendLog(['ERROR: ' + e.message]);
    }
  }

  async function stopK6() {
    document.getElementById('btnStop').disabled = true;
    setStatus('off', 'STOPPING...');
    try {
      await fetch('/k6/stop', { method: 'POST' });
      document.getElementById('btnStart').disabled = false;
      setStatus('', 'IDLE');
      stopLogPoll();
    } catch(e) { appendLog(['ERROR: ' + e.message]); }
  }

  function setStatus(cls, txt) {
    const dot = document.getElementById('dot');
    dot.className = 'dot' + (cls ? ' ' + cls : '');
    const s = document.getElementById('stxt');
    s.textContent = txt;
    s.style.color = cls === 'on' ? 'var(--green)' : cls === 'off' ? 'var(--red)' : 'var(--muted)';
  }

  // Sync button state if page is reloaded mid-test
  (async () => {
    try {
      const d = await (await fetch('/k6/status')).json();
      if (d.running) {
        document.getElementById('btnStart').disabled = true;
        document.getElementById('btnStop').disabled  = false;
        setStatus('on', 'RUNNING');
        startLogPoll();
      }
    } catch(_) {}
  })();
</script>
</body>
</html>`);
});

// ── UPLOAD ROUTE ──────────────────────────────────────────────────────────────
app.post("/upload", upload.single("fileToUpload"), async (req, res) => {
  if (!req.file) {
    return res.send(`<p>❌ File upload error.</p><a href="/">Go Back</a>`);
  }

  const fileName = req.file.originalname;
  const filePath = req.file.path;

  try {
    const fileStream = fs.createReadStream(filePath);

    await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key:    "uploads/" + fileName,
      Body:   fileStream,
      ContentType: req.file.mimetype,
      // ✅ No ACL setting required
    }));

    fs.unlink(filePath, () => {});
    res.send(`<p>✅ Image uploaded successfully to S3!</p><a href="/">Go Back</a>`);
  } catch (err) {
    fs.unlink(filePath, () => {});
    res.send(`<p>❌ Error uploading to S3: ${err.message}</p><a href="/">Go Back</a>`);
  }
});

// ── K6 ROUTES ─────────────────────────────────────────────────────────────────
app.post("/k6/start", (req, res) => {
  if (k6proc) return res.json({ ok: true, already: true });

  const { url, vus = "50", duration = "10m" } = req.body;
  if (!url) return res.status(400).json({ ok: false, error: "url required" });

  k6log = [];

  k6proc = spawn("k6", [
    "run",
    "--vus",      String(vus),
    "--duration", String(duration),
    "--env",      `TARGET_URL=${url}`,
    path.join(__dirname, "loadtest.js"),
  ]);

  const pushLine = (line) => {
    k6log.push(line);
    if (k6log.length > MAX_LOG) k6log.shift();
  };

  k6proc.stdout.on("data", d => d.toString().split("\n").filter(Boolean).forEach(pushLine));
  k6proc.stderr.on("data", d => d.toString().split("\n").filter(Boolean).forEach(pushLine));
  k6proc.on("exit", () => { k6proc = null; });

  res.json({ ok: true, vus, duration });
});

app.post("/k6/stop", (req, res) => {
  if (k6proc) { k6proc.kill("SIGINT"); k6proc = null; }
  res.json({ ok: true });
});

app.get("/k6/status", (req, res) => res.json({ running: k6proc !== null }));

app.get("/k6/log", (req, res) => {
  const offset = parseInt(req.query.offset || "0");
  res.json({ lines: k6log.slice(offset), nextOffset: k6log.length });
});

// ── CPU USAGE ROUTE ───────────────────────────────────────────────────────────
app.get("/cpu", async (req, res) => {
  res.json({ cpu: await getCpuUsage(), cores: os.cpus().length });
});

// ── HEALTH CHECK (for ALB) ────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`   ECS App running on port ${PORT}`);
  console.log(`   S3_BUCKET: ${S3_BUCKET || "(not set)"}`);
  console.log(`   AWS_REGION: ${AWS_REGION || "(not set)"}`);
});
