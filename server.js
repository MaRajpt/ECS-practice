const express = require("express");
const multer  = require("multer");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
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

// ── MULTER (temp disk storage, mirrors $_FILES["fileToUpload"]) ───────────────
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

// ── STATIC ASSETS ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, "public")));

// ── INDEX PAGE (mirrors index.php) ────────────────────────────────────────────
app.get("/", (req, res) => {
  const containerId = os.hostname(); // same as gethostname() in PHP

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Project ECS | CloudFolks HUB</title>
  <link rel="stylesheet" href="/css/style.css">
</head>
<body>
  <div class="hero-banner">
    <h1>🚀 Project ECS</h1>
    <p class="tagline">Cloud Deployment Simplified — Powered by <span class="brand">CloudFolks HUB</span></p>
    <p class="container-id">🆔 Container ID: <strong>${containerId}</strong></p>
  </div>

  <div class="upload-tile">
    <h2>📤 Upload Your Image to S3</h2>
    <form action="/upload" method="post" enctype="multipart/form-data">
      <input type="file" name="fileToUpload" accept="image/*" required>
      <button type="submit">Upload Now</button>
    </form>
  </div>

  <div class="footer-tile">
    <p>🌐 To learn Cloud from industry experts, visit:</p>
    <a href="https://www.cloudfolkshub.com" target="_blank" class="cta-button">CloudFolks HUB Official Website</a>
  </div>
</body>
</html>`);
});

// ── UPLOAD ROUTE (mirrors upload.php) ─────────────────────────────────────────
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
      // ✅ No ACL setting required (same comment as PHP version)
    }));

    // Clean up temp file
    fs.unlink(filePath, () => {});

    res.send(`<p>✅ Image uploaded successfully to S3!</p><a href="/">Go Back</a>`);
  } catch (err) {
    fs.unlink(filePath, () => {});
    res.send(`<p>❌ Error uploading to S3: ${err.message}</p><a href="/">Go Back</a>`);
  }
});

// ── HEALTH CHECK (for ALB) ────────────────────────────────────────────────────
app.get("/health", (req, res) => res.json({ status: "ok" }));

// ── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ CloudFolks ECS App running on port ${PORT}`);
  console.log(`   S3_BUCKET: ${S3_BUCKET || "(not set)"}`);
  console.log(`   AWS_REGION: ${AWS_REGION || "(not set)"}`);
});
