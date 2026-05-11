#!/usr/bin/env python3
"""Create presentation renders from a finished grayscale solar image.

Outputs:
- natural monochrome
- warm white-light presentation render
- more artistic gold/orange render
- overview/detail comparison sheets
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def load_gray(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
    if img is None:
        raise RuntimeError(f"Could not load {path}")
    return img


def detect_disk(gray: np.ndarray) -> tuple[np.ndarray, tuple[float, float], float]:
    mask = (gray > 3).astype(np.uint8) * 255
    kernel = np.ones((5, 5), np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    mask = cv2.GaussianBlur(mask, (0, 0), 2.0)
    binary = (mask > 32).astype(np.uint8)

    ys, xs = np.where(binary > 0)
    if len(xs) == 0:
        raise RuntimeError("Could not detect solar disk mask")

    cx = float(xs.mean())
    cy = float(ys.mean())
    area = float(binary.sum())
    radius = float(np.sqrt(area / np.pi))
    return binary, (cx, cy), radius


def radial_map(shape: tuple[int, int], center: tuple[float, float], radius: float) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[:h, :w]
    rr = np.sqrt((xx - center[0]) ** 2 + (yy - center[1]) ** 2) / max(radius, 1e-6)
    return np.clip(rr, 0.0, 1.0)


def tone_map(gray: np.ndarray, low: float = 0.15, high: float = 99.85, gamma: float = 0.92) -> np.ndarray:
    lo = np.percentile(gray, low)
    hi = np.percentile(gray, high)
    scaled = np.clip((gray.astype(np.float32) - lo) / max(hi - lo, 1.0), 0, 1)
    return np.power(scaled, gamma)


def monochrome_natural(gray: np.ndarray, disk_mask: np.ndarray) -> np.ndarray:
    base = tone_map(gray, gamma=0.97)
    # Gentle local contrast only on-disk.
    clahe = cv2.createCLAHE(clipLimit=0.9, tileGridSize=(10, 10))
    local = clahe.apply((base * 255).astype(np.uint8)).astype(np.float32) / 255.0
    blended = base * 0.72 + local * 0.28
    out = (blended * 255).clip(0, 255).astype(np.uint8)
    out[disk_mask == 0] = 0
    return out


def warm_white_light(gray: np.ndarray, disk_mask: np.ndarray, radial: np.ndarray) -> np.ndarray:
    y = tone_map(gray, gamma=0.93)
    limb = np.power(radial, 1.7)
    # Subtle white-light warmth: warm the limb a little more than the center.
    r = np.clip(y * (1.00 + 0.08 * limb), 0, 1)
    g = np.clip(y * (0.965 + 0.015 * limb), 0, 1)
    b = np.clip(y * (0.89 - 0.05 * limb), 0, 1)
    rgb = np.dstack([r, g, b])
    rgb[disk_mask == 0] = 0
    return (rgb * 255).astype(np.uint8)


def artistic_gold(gray: np.ndarray, disk_mask: np.ndarray, radial: np.ndarray) -> np.ndarray:
    y = tone_map(gray, low=0.1, high=99.9, gamma=0.88)
    # Stronger artistic gradient map: pale center, orange limb.
    center = np.array([1.00, 0.95, 0.76], dtype=np.float32)
    limb = np.array([1.00, 0.48, 0.10], dtype=np.float32)
    mix = np.power(radial, 1.25)[..., None]
    color = center * (1.0 - mix) + limb * mix
    luminance = (0.23 + 0.77 * y)[..., None]
    rgb = np.clip(color * luminance, 0, 1)
    # Slightly deepen dark structures without making halos.
    rgb = np.power(rgb, np.array([0.98, 1.0, 1.03], dtype=np.float32))
    rgb[disk_mask == 0] = 0
    return (rgb * 255).astype(np.uint8)


def save(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


def make_sheet(images: list[tuple[str, Path]], out_path: Path, detail: bool = False) -> None:
    cards = []
    for label, path in images:
        img = Image.open(path).convert("RGB")
        if detail:
            w, h = img.size
            cx = int(w * 0.58)
            cy = int(h * 0.39)
            r = int(min(w, h) * 0.11)
            img = img.crop((cx - r, cy - r, cx + r, cy + r)).resize((560, 560), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (560, 600), "black")
        else:
            target_h = 920
            target_w = round(img.width * target_h / img.height)
            img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (target_w, target_h + 40), "black")
        canvas.paste(img, (0, 40))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), label, fill="white")
        cards.append(canvas)

    sheet = Image.new("RGB", (sum(card.width for card in cards), max(card.height for card in cards)), "black")
    x = 0
    for card in cards:
        sheet.paste(card, (x, 0))
        x += card.width
    sheet.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create presentation renders from a grayscale solar final")
    parser.add_argument("final", help="Path to final grayscale image")
    parser.add_argument("--output-dir", "-o", default="./prototype_output/presentation", help="Output directory")
    args = parser.parse_args()

    final_path = Path(args.final).resolve()
    out_dir = Path(args.output_dir).resolve()
    gray = load_gray(final_path)
    disk_mask, center, radius = detect_disk(gray)
    radial = radial_map(gray.shape, center, radius)

    mono = monochrome_natural(gray, disk_mask)
    warm = warm_white_light(gray, disk_mask, radial)
    art = artistic_gold(gray, disk_mask, radial)

    base = final_path.stem
    mono_path = out_dir / f"{base}_mono_natural.png"
    warm_path = out_dir / f"{base}_warm_presentation.png"
    art_path = out_dir / f"{base}_artistic_gold.png"

    save(mono_path, mono)
    save(warm_path, cv2.cvtColor(warm, cv2.COLOR_RGB2BGR))
    save(art_path, cv2.cvtColor(art, cv2.COLOR_RGB2BGR))

    make_sheet(
        [
            ("Monochrome natural", mono_path),
            ("Warm presentation", warm_path),
            ("Artistic gold", art_path),
        ],
        out_dir / "presentation_overview.png",
        detail=False,
    )
    make_sheet(
        [
            ("Monochrome natural", mono_path),
            ("Warm presentation", warm_path),
            ("Artistic gold", art_path),
        ],
        out_dir / "presentation_detail.png",
        detail=True,
    )

    print(f"Presentation outputs written to: {out_dir}")


if __name__ == "__main__":
    main()
