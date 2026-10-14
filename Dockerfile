FROM node:22-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Pin npm rather than inheriting an untested version from a changing base image.
RUN npm install --global npm@10.9.2 --no-audit --no-fund \
    && test "$(npm --version)" = "10.9.2"

WORKDIR /app

COPY package.json package-lock.json ./
COPY scripts/prepare-production-lock.cjs scripts/verify-runtime.cjs ./scripts/

# Replit's package firewall URLs are not reachable from Railway.
# Versions and integrity hashes remain unchanged.
RUN node scripts/prepare-production-lock.cjs \
    && npm ci --omit=dev --no-audit --no-fund \
    && npm run verify:runtime

COPY . .

# COPY restores the workspace lockfile; make the final image portable too.
# Fail the image build even if npm itself incorrectly reports success.
RUN node scripts/prepare-production-lock.cjs \
    && npm run verify:runtime \
    && node --check server.js \
    && ffmpeg -version > /dev/null

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "server.js"]
