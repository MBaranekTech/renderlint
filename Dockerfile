FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

ENV NODE_ENV=production \
    RENDERLINT_DATA_DIR=/data \
    PORT=8787

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY public/ ./public/
COPY src/ ./src/

RUN mkdir -p /data/evidence

EXPOSE 8787

CMD ["node", "src/server.js"]
