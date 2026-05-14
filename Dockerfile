# Use official Playwright image with all dependencies pre-installed
FROM mcr.microsoft.com/playwright:v1.60.0-jammy

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install pnpm
RUN npm install -g pnpm@10.26.2

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build TypeScript
RUN pnpm run build

# Set environment variables
ENV NODE_ENV=production
ENV HEADLESS=true

# Vercel sets PORT dynamically
EXPOSE $PORT

# Start the server (use PORT from environment)
CMD node dist/server.js
