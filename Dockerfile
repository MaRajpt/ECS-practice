FROM node:20-alpine

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
