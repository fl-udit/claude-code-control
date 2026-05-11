FROM node:24-bookworm-slim

# Build tools required for node-pty native compilation (no Linux prebuilds)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Install Claude CLI
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app

# Install dependencies before copying source for better layer caching.
# node-pty compiles from source on Linux; postinstall chmod is a macOS-only
# no-op on this platform.
COPY package.json package-lock.json ./
RUN npm ci

COPY server/ ./server/
COPY client/ ./client/

EXPOSE 3000

CMD ["node", "server/index.js"]
