FROM node:20-bookworm-slim

# Install Chromium, Chromedriver, and Poppler (for pdftoppm OCR)
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    chromium-driver \
    poppler-utils \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/chromium /usr/bin/google-chrome \
    && ln -sf /usr/bin/chromium /usr/bin/chromium-browser \
    && ln -sf /usr/bin/chromedriver /usr/bin/chromium-driver

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
    PORT=3000 \
    CRAWL_MAX_PAGES=12 \
    TAVILY_API_KEY=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 \
    YOUTUBE_API_KEY=AIzaSyDKst8RQO8dxpRjxGDB19N1G50-pDq40iQ

EXPOSE 3000

# Start production server with capped V8 heap (safe for 512MB RAM containers)
CMD ["node", "--expose-gc", "--max-old-space-size=350", "dist/server.js"]
