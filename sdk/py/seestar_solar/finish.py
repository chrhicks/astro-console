from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np
from skimage.restoration import richardson_lucy

from .review import make_sheet


def load_luma(path: Path) -> np.ndarray:
    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError(f"Could not load {path}")
    if img.ndim == 3:
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    else:
        gray = img
    return gray.astype(np.float32)


def to_uint8(gray: np.ndarray, mask: np.ndarray | None = None, low: float = 0.2, high: float = 99.8) -> np.ndarray:
    values = gray[mask > 0] if mask is not None else gray.reshape(-1)
    lo = np.percentile(values, low)
    hi = np.percentile(values, high)
    scaled = np.clip((gray - lo) / max(hi - lo, 1e-6), 0, 1)
    return (scaled * 255).astype(np.uint8)


def detect_disk(gray: np.ndarray) -> tuple[np.ndarray, int]:
    img8 = to_uint8(gray)
    blurred = cv2.GaussianBlur(img8, (9, 9), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise RuntimeError("Could not detect solar disk")

    largest = max(contours, key=cv2.contourArea)
    mask = np.zeros_like(img8, dtype=np.uint8)
    cv2.drawContours(mask, [largest], -1, 255, thickness=-1)
    (_, _), radius = cv2.minEnclosingCircle(largest)
    return mask, int(radius)


def soft_mask(binary_mask: np.ndarray, feather_px: int = 8) -> np.ndarray:
    return cv2.GaussianBlur(binary_mask.astype(np.float32) / 255.0, (0, 0), feather_px)


def flatten_limb(gray_norm: np.ndarray, mask: np.ndarray) -> np.ndarray:
    smooth = cv2.GaussianBlur(gray_norm, (0, 0), 35)
    median_level = np.median(smooth[mask > 0])
    flattened = np.clip(gray_norm / np.maximum(smooth, 1e-5) * median_level, 0, 1)
    return gray_norm * 0.7 + flattened * 0.3


def deconvolve(gray_norm: np.ndarray) -> np.ndarray:
    psf_1d = cv2.getGaussianKernel(5, 0.9)
    psf = psf_1d @ psf_1d.T
    rl = richardson_lucy(gray_norm, psf, num_iter=10, clip=False)
    return np.clip(rl, 0, 1)


def finish(gray16: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    mask, _radius = detect_disk(gray16)
    mask_soft = soft_mask(mask, feather_px=10)

    gray_norm = to_uint8(gray16, mask).astype(np.float32) / 255.0
    flattened = flatten_limb(gray_norm, mask)
    deconv = deconvolve(flattened)

    deconv8 = to_uint8((deconv * 65535).astype(np.float32), mask, low=0.2, high=99.9)
    clahe = cv2.createCLAHE(clipLimit=1.05, tileGridSize=(10, 10)).apply(deconv8)
    blur = cv2.GaussianBlur(clahe, (0, 0), 0.9)
    sharpened = cv2.addWeighted(clahe, 1.12, blur, -0.12, 0)

    base8 = to_uint8(gray16, mask, low=0.2, high=99.8)
    final = (sharpened.astype(np.float32) * mask_soft).clip(0, 255).astype(np.uint8)
    natural = (base8.astype(np.float32) * mask_soft).clip(0, 255).astype(np.uint8)
    return natural, final


def save(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


def main() -> None:
    parser = argparse.ArgumentParser(description="Finish a PSS TIFF into evaluation-ready solar grayscale outputs")
    parser.add_argument("input", nargs="+", help="Input PSS TIFF(s)")
    parser.add_argument("--output-dir", "-o", default="./output", help="Output directory for PNGs")
    parser.add_argument("--review-dir", default=None, help="Optional directory for review sheets")
    args = parser.parse_args()

    output_dir = Path(args.output_dir).resolve()
    rendered: list[tuple[str, Path]] = []

    for input_name in args.input:
        path = Path(input_name).resolve()
        gray16 = load_luma(path)
        natural, final = finish(gray16)

        stem = path.stem
        natural_path = output_dir / f"{stem}_natural.png"
        final_path = output_dir / f"{stem}_final.png"
        save(natural_path, natural)
        save(final_path, final)

        label = stem.replace("_", " ")
        rendered.append((f"{label} natural", natural_path))
        rendered.append((f"{label} final", final_path))

    if args.review_dir and rendered:
        review_dir = Path(args.review_dir).resolve()
        make_sheet(rendered, review_dir / "finish_overview.png", detail=False)
        make_sheet(rendered, review_dir / "finish_detail.png", detail=True)

    print(f"Finish outputs written to: {output_dir}")


if __name__ == "__main__":
    main()
