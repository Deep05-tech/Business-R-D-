FROM node:20-bookworm-slim

# Install Chromium, Chromedriver, and Poppler (for pdftoppm OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    poppler-utils \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/bin/chromium /usr/bin/google-chrome \
    && ln -s /usr/bin/chromium-driver /usr/bin/chromedriver

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install npm dependencies
RUN npm ci

# Copy application source code
COPY . .

# Compile TypeScript
RUN npm run build

# Default environment variables
ENV NODE_ENV=production \
    PORT=3000

EXPOSE 3000

# Start production server
CMD ["node", "dist/server.js"]
