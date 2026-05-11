from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

from .review import make_sheet

SUPPORTED_STYLES = ("mono_natural", "artistic_gold")


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
    clahe = cv2.createCLAHE(clipLimit=0.9, tileGridSize=(10, 10))
    local = clahe.apply((base * 255).astype(np.uint8)).astype(np.float32) / 255.0
    blended = base * 0.72 + local * 0.28
    out = (blended * 255).clip(0, 255).astype(np.uint8)
    out[disk_mask == 0] = 0
    return out


def artistic_gold(gray: np.ndarray, disk_mask: np.ndarray, radial: np.ndarray) -> np.ndarray:
    y = tone_map(gray, low=0.1, high=99.9, gamma=0.88)
    center = np.array([1.00, 0.95, 0.76], dtype=np.float32)
    limb = np.array([1.00, 0.48, 0.10], dtype=np.float32)
    mix = np.power(radial, 1.25)[..., None]
    color = center * (1.0 - mix) + limb * mix
    luminance = (0.23 + 0.77 * y)[..., None]
    rgb = np.clip(color * luminance, 0, 1)
    rgb = np.power(rgb, np.array([0.98, 1.0, 1.03], dtype=np.float32))
    rgb[disk_mask == 0] = 0
    return (rgb * 255).astype(np.uint8)


def save(path: Path, image: np.ndarray, color: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if color:
        cv2.imwrite(str(path), cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    else:
        cv2.imwrite(str(path), image)


def main() -> None:
    parser = argparse.ArgumentParser(description="Create presentation renders from a grayscale solar final")
    parser.add_argument("final", help="Path to grayscale solar final")
    parser.add_argument("--output-dir", "-o", default="./output", help="Output directory for presentation renders")
    parser.add_argument("--review-dir", default=None, help="Optional directory for review sheets")
    parser.add_argument("--styles", default=",".join(SUPPORTED_STYLES), help="Comma-separated style names")
    args = parser.parse_args()

    styles = [style.strip() for style in args.styles.split(",") if style.strip()]
    unknown = [style for style in styles if style not in SUPPORTED_STYLES]
    if unknown:
        raise SystemExit(f"Unsupported styles: {', '.join(unknown)}")

    final_path = Path(args.final).resolve()
    output_dir = Path(args.output_dir).resolve()
    gray = load_gray(final_path)
    disk_mask, center, radius = detect_disk(gray)
    radial = radial_map(gray.shape, center, radius)

    rendered: list[tuple[str, Path]] = []
    base = final_path.stem
    if "mono_natural" in styles:
        mono = monochrome_natural(gray, disk_mask)
        mono_path = output_dir / f"{base}_mono_natural.png"
        save(mono_path, mono, color=False)
        rendered.append(("Monochrome natural", mono_path))
    if "artistic_gold" in styles:
        art = artistic_gold(gray, disk_mask, radial)
        art_path = output_dir / f"{base}_artistic_gold.png"
        save(art_path, art, color=True)
        rendered.append(("Artistic gold", art_path))

    if args.review_dir and rendered:
        review_dir = Path(args.review_dir).resolve()
        make_sheet(rendered, review_dir / "presentation_overview.png", detail=False)
        make_sheet(rendered, review_dir / "presentation_detail.png", detail=True)

    print(f"Presentation outputs written to: {output_dir}")


if __name__ == "__main__":
    main()
