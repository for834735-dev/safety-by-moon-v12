# Dockerfile untuk Railway (dan hosting Docker lain).
# Bekerja untuk dua susunan repo:  (a) isi folder server/ langsung di root repo,
#                                   (b) folder server/ berada di dalam repo.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ffmpeg (audio/video/stiker/HD), git (dependensi Baileys), python3 (server.py opsional),
# font (teks di kartu gambar), curl (unduh yt-dlp)
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg git ca-certificates curl python3 fonts-dejavu-core fonts-liberation \
 && rm -rf /var/lib/apt/lists/*

# yt-dlp untuk downloader YouTube/IG/FB/X. Gagal unduh tidak menggagalkan build.
RUN curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o /usr/local/bin/yt-dlp \
 && chmod a+rx /usr/local/bin/yt-dlp \
 || echo "yt-dlp dilewati (unduh gagal); downloader memakai penyedia cadangan"

WORKDIR /src
COPY . /src
RUN set -e; \
    if [ -f /src/server/package.json ]; then SRC=/src/server; else SRC=/src; fi; \
    mkdir -p /app && cp -a "$SRC"/. /app/ && rm -rf /src
WORKDIR /app

RUN npm install --omit=dev --no-audit --no-fund \
 && mkdir -p /app/data/session

# Port diberikan Railway lewat variabel PORT; server membacanya otomatis.
CMD ["node", "server.js"]
