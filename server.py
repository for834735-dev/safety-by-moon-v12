#!/usr/bin/env python3
"""
Launcher backend Safety Your WhatsApp.  Jalankan:  python server.py   (atau python3 server.py)

Yang dilakukan:
  1. Mencari Node.js (>= 18) dan memeriksa ffmpeg / yt-dlp.
  2. Membuat .env dari .env.example bila belum ada.
  3. Menjalankan `npm install` otomatis bila node_modules belum ada.
  4. Menjalankan `node server.js` dan me-restart otomatis bila proses crash.

Opsi:
  --setup        pasang yt-dlp lewat pip (untuk download YouTube/TikTok/IG dsb) lalu keluar
  --no-restart   jangan restart otomatis saat crash
  --install      paksa npm install ulang
Hanya memakai pustaka standar Python (tanpa pip install apa pun).
"""
import os
import shutil
import signal
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)


def log(msg):
    print(f"[launcher] {msg}", flush=True)


def find_node():
    node = shutil.which("node") or shutil.which("nodejs")
    if not node:
        log("Node.js tidak ditemukan. Pasang Node.js 18+ (panel: pilih egg/image Node.js).")
        sys.exit(1)
    out = subprocess.run([node, "-v"], capture_output=True, text=True).stdout.strip()
    try:
        major = int(out.lstrip("v").split(".")[0])
    except ValueError:
        major = 0
    if major < 18:
        log(f"Node.js {out} terlalu lama. Dibutuhkan 18 atau lebih baru.")
        sys.exit(1)
    log(f"Node.js {out}")
    return node


def ensure_env():
    if not os.path.exists(".env") and os.path.exists(".env.example"):
        shutil.copy(".env.example", ".env")
        log("File .env dibuat dari .env.example. Isi OWNER_NUMBER di .env lalu jalankan ulang bila perlu.")


def ensure_deps(force=False):
    if os.path.isdir("node_modules") and not force:
        return
    npm = shutil.which("npm")
    if not npm:
        log("npm tidak ditemukan; pasang dependensi manual: npm install")
        sys.exit(1)
    log("Memasang dependensi (npm install), tunggu sebentar...")
    code = subprocess.call([npm, "install", "--omit=dev", "--no-audit", "--no-fund"])
    if code != 0:
        log("npm install gagal. Periksa koneksi internet / versi Node.js.")
        sys.exit(code)


def has_ytdlp():
    return bool(shutil.which("yt-dlp")) or os.path.exists(os.path.join(ROOT, "bin", "yt-dlp")) or \
        subprocess.run([sys.executable, "-m", "yt_dlp", "--version"], capture_output=True).returncode == 0


def check_tools():
    log("ffmpeg : " + ("ada" if shutil.which("ffmpeg") else "TIDAK ADA (fitur audio/video/stiker/HD butuh ffmpeg)"))
    log("yt-dlp : " + ("ada" if has_ytdlp() else "tidak ada (jalankan: python server.py --setup)"))


def setup_ytdlp():
    log("Memasang yt-dlp lewat pip...")
    code = subprocess.call([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"])
    if code != 0:
        code = subprocess.call([sys.executable, "-m", "pip", "install", "-U", "--break-system-packages", "yt-dlp"])
    log("yt-dlp terpasang." if code == 0 else "Gagal memasang yt-dlp. Coba manual: pip install -U yt-dlp")
    sys.exit(code)


def main():
    args = set(sys.argv[1:])
    if "--setup" in args:
        setup_ytdlp()
    node = find_node()
    ensure_env()
    ensure_deps(force="--install" in args)
    check_tools()

    proc = None

    def forward(signum, _frame):
        if proc and proc.poll() is None:
            proc.send_signal(signum)
        else:
            sys.exit(0)

    signal.signal(signal.SIGINT, forward)
    signal.signal(signal.SIGTERM, forward)

    fast_crashes = 0
    while True:
        started = time.time()
        proc = subprocess.Popen([node, "server.js"])
        code = proc.wait()
        if code == 0 or "--no-restart" in args or code in (130, 143, -2, -15):
            sys.exit(code if code > 0 else 0)
        fast_crashes = fast_crashes + 1 if time.time() - started < 20 else 0
        if fast_crashes >= 5:
            log("Server crash berulang kali. Hentikan restart otomatis; cek log di atas.")
            sys.exit(code)
        log(f"Server berhenti (kode {code}). Restart 3 detik lagi...")
        time.sleep(3)


if __name__ == "__main__":
    main()
