# 🚀 Node.js S3 Upload App – CloudFolks HUB

A professional, containerized Node.js application that allows image uploads to S3 using AWS SDK for JavaScript v3. Built for ECS Fargate deployment. Mirrors the PHP version 1:1.

## 🌐 Live Demo UI Features
- CloudFolks branding
- Uploads images to S3
- Displays container ID (for load balancing tests)
- Fully Dockerized and ECS-ready

## 🛠 How to Build and Run Locally

```bash
npm install
docker build -t cloudfolks-node-app .
docker run -d -p 8080:80 \
  -e S3_BUCKET=your-bucket \
  -e AWS_REGION=your-region \
  --name node-test cloudfolks-node-app
```

Visit: http://localhost:8080

## ☁️ ECS Fargate — Environment Variables (Task Definition)

| Variable | Required | Notes |
|---|---|---|
| `S3_BUCKET` | ✅ | Your S3 bucket name |
| `AWS_REGION` | ✅ | e.g. `us-east-1` |

> **Best practice on ECS:** Use an IAM Task Role with `s3:PutObject` permission instead of hardcoding access keys. The SDK auto-resolves credentials from the role — no keys needed.

## 🔑 Minimum IAM Task Role Policy

```json
{
  "Effect": "Allow",
  "Action": ["s3:PutObject"],
  "Resource": "arn:aws:s3:::your-bucket-name/uploads/*"
}
```

## 🏥 Health Check
ALB target group path: `GET /health` → `{ "status": "ok" }`

## 🧠 Learn More
Visit [https://www.cloudfolkshub.com](https://www.cloudfolkshub.com) to learn cloud the right way.
