FROM node:20-alpine

# Install k6
RUN apk add --no-cache curl tar && \
    curl -L https://github.com/grafana/k6/releases/download/v0.51.0/k6-v0.51.0-linux-amd64.tar.gz \
    | tar -xz --strip-components=1 -C /usr/local/bin k6-v0.51.0-linux-amd64/k6 && \
    apk del curl tar

# Set working directory
WORKDIR /app

# Install dependencies first (layer cache optimization)
COPY package.json ./
RUN npm install --production

# Copy project files
COPY . .

# Create temp upload dir
RUN mkdir -p /tmp/uploads

# Expose HTTP port
EXPOSE 80

CMD ["node", "server.js"]
