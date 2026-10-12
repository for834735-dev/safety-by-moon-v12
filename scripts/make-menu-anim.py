#!/usr/bin/env python3
"""Bikin animasi menu: assets/menu.mp4 (satu video GIF, teks menu dikirim sebagai caption).
Visual diambil dari assets/menu-art.png: langit malam biru tua, bulan sabit emas bercahaya,
bintang berkilau, awan dengan tepi emas, dan cincin emas tipis.
Animasi: napas zoom halus, denyut cahaya (bloom), bintang berkedip & berputar, debu emas naik,
kilau emas berjalan di cincin. Semua periodik sehingga loop mulus.
Jalankan ulang:  python3 scripts/make-menu-anim.py   (butuh Pillow, numpy, ffmpeg)"""
import math, os, subprocess, shutil, tempfile
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ASSETS = os.path.join(ROOT, "assets")
SRC = os.path.join(ASSETS, "menu-art.png")
S = int(os.environ.get("MENU_SIZE", "576"))     # sisi video (px, genap)
FPS = 15
N = 60                                           # 4 detik per loop
K = S / 1254.0                                   # skala dari gambar asli

def pt(x, y): return (x * K, y * K)

base = Image.open(SRC).convert("RGB").resize((S, S), Image.LANCZOS)
arr = np.asarray(base).astype(np.float32) / 255.0

# --- bloom: bagian terang (bulan, bintang, cincin) di-blur lalu ditambahkan berdenyut
lum = arr.max(axis=2)
mask = np.clip((lum - 0.55) / 0.45, 0, 1)[..., None]
bright = Image.fromarray((arr * mask * 255).astype(np.uint8))
bloom_a = np.asarray(bright.filter(ImageFilter.GaussianBlur(S * 0.018))).astype(np.float32) / 255.0
bloom_b = np.asarray(bright.filter(ImageFilter.GaussianBlur(S * 0.05))).astype(np.float32) / 255.0
tint = np.array([1.0, 0.86, 0.48], dtype=np.float32)

# --- bintang berkilau (koordinat dari gambar asli 1254px): x, y, ukuran, fase, putaran
STARS = [(750, 457, 150, 0.00, 1), (922, 337, 62, 0.25, 0), (1065, 598, 52, 0.55, 0),
         (860, 610, 34, 0.80, 0), (197, 530, 56, 0.40, 0), (627, 86, 60, 0.10, 0), (627, 1045, 60, 0.65, 0),
         (1105, 180, 20, 0.30, 0), (190, 188, 18, 0.70, 0), (215, 975, 20, 0.15, 0), (512, 1130, 18, 0.50, 0)]

def sparkle(layer, cx, cy, size, a, rot=0.0, diag=False):
    """Bintang 4 sudut (opsional 8) dengan kilau lembut."""
    d = ImageDraw.Draw(layer)
    L = size * K * a; w = max(1.2, L * 0.07)
    col = (255, 238, 170, int(255 * min(1, a)))
    for k in range(4 if not diag else 8):
        ang = rot + k * (math.pi / 2 if not diag else math.pi / 4)
        ln = L if (not diag or k % 2 == 0) else L * 0.55
        ex, ey = cx + math.cos(ang) * ln, cy + math.sin(ang) * ln
        nx, ny = -math.sin(ang) * w, math.cos(ang) * w
        d.polygon([(cx + nx, cy + ny), (ex, ey), (cx - nx, cy - ny)], fill=col)
    r = max(2, L * 0.10)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 250, 215, int(255 * min(1, a))))

# --- debu emas
rng = np.random.default_rng(7)
DUST = [(rng.random(), rng.random(), 0.4 + rng.random() * 0.8, rng.random(), 1.2 + rng.random() * 2.2) for _ in range(34)]

RING_C = pt(627, 588); RING_R = 496 * K

def frame(i):
    t = i / N; ph = t * 2 * math.pi
    # 1) napas zoom sangat halus
    z = 1.0 + 0.022 * (math.sin(ph - math.pi / 2) + 1) / 2
    w = S / z; o = (S - w) / 2
    img = base.resize((S, S), Image.BICUBIC, box=(o, o, o + w, o + w))
    a = np.asarray(img).astype(np.float32) / 255.0
    # 2) denyut cahaya
    p1 = 0.5 + 0.5 * math.sin(ph)
    p2 = 0.5 + 0.5 * math.sin(ph + 1.4)
    a = a + bloom_a * tint * (0.08 + 0.18 * p1) + bloom_b * tint * (0.12 + 0.22 * p2)
    out = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8)).convert("RGBA")

    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sharp = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # 3) kilau berjalan di cincin emas
    ang0 = ph - math.pi / 2
    for seg, (span, wd, al) in enumerate(((0.9, 5, 70), (0.45, 4, 130), (0.16, 3, 255))):
        box = [RING_C[0] - RING_R, RING_C[1] - RING_R, RING_C[0] + RING_R, RING_C[1] + RING_R]
        ImageDraw.Draw(glow).arc(box, math.degrees(ang0 - span), math.degrees(ang0), fill=(255, 224, 130, al), width=int(wd))
    # lengkung cincin sebelah (arah berlawanan, lebih redup)
    ImageDraw.Draw(glow).arc([RING_C[0] - RING_R, RING_C[1] - RING_R, RING_C[0] + RING_R, RING_C[1] + RING_R],
                             math.degrees(-ang0 + math.pi - 0.25), math.degrees(-ang0 + math.pi), fill=(255, 224, 130, 110), width=3)

    # 4) bintang berkedip dan berputar pelan
    for (x, y, sz, off, big) in STARS:
        tw = 0.5 + 0.5 * math.sin(ph + off * 2 * math.pi)
        amp = 0.55 + 0.75 * tw ** 1.5
        cx, cy = pt(x, y)
        sparkle(sharp, cx, cy, sz, amp, rot=(math.sin(ph + off * 6) * 0.10) + (math.pi / 4 if False else 0), diag=bool(big))
        if big:
            r = sz * K * (0.35 + 0.25 * tw)
            ImageDraw.Draw(glow).ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 225, 140, int(70 + 70 * tw)))

    # 5) debu emas naik pelan
    for (dx, dy, sp, off, rr) in DUST:
        yy = (1 - ((t * sp * 0.6 + dy) % 1.0)) * S
        xx = (dx * S + math.sin(ph * 2 + off * 6.28) * S * 0.012)
        tw = 0.5 + 0.5 * math.sin(ph * 3 + off * 9)
        r = rr * K * 1.4 + 0.6
        sharp_d = ImageDraw.Draw(sharp)
        sharp_d.ellipse([xx - r, yy - r, xx + r, yy + r], fill=(255, 232, 150, int(60 + 150 * tw)))

    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.006))
    halo = sharp.filter(ImageFilter.GaussianBlur(S * 0.012))
    out = Image.alpha_composite(out, halo)
    out = Image.alpha_composite(out, glow)
    out = Image.alpha_composite(out, sharp)
    return out.convert("RGB")

def build():
    tmp = tempfile.mkdtemp()
    try:
        for i in range(N):
            frame(i).save(f"{tmp}/f{i:03d}.png")
        dst = os.path.join(ASSETS, "menu.mp4")
        subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-framerate", str(FPS), "-i", f"{tmp}/f%03d.png",
                        "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-movflags", "+faststart", "-an", dst], check=True)
        if not os.environ.get("KEEP_FRAMES"):
            pass
        else:
            shutil.copytree(tmp, "/tmp/frames", dirs_exist_ok=True)
        print("menu.mp4", os.path.getsize(dst) // 1024, "KB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

if __name__ == "__main__":
    build()
