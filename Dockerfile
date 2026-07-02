# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Install dependencies required for Chromium and ChromeDriver
RUN apt-get update && apt-get install -y \
    wget \
    gnupg \
    ca-certificates \
    procps \
    libxss1 \
    libnss3 \
    libasound2 \
    fonts-liberation \
    libappindicator3-1 \
    xdg-utils \
    chromium \
    chromium-driver \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install app dependencies (ignoring devDependencies in production, though we need them for build)
RUN npm ci

# Copy the rest of the application
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port the app runs on
EXPOSE 3000

# Set environment variables
ENV PORT=3000
ENV NODE_ENV=production
# Tell Selenium where to find Chromium if necessary
ENV CHROME_BIN=/usr/bin/chromium

# Run the application
CMD ["npm", "start"]
