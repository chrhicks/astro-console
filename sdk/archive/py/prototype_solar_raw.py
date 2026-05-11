#!/usr/bin/env python3
"""Prototype several RAW solar stacking approaches side by side.

This script is intentionally pragmatic rather than final-quality. It gives us a
fast way to compare a few ideas on the same RAW AVI:

1. Best single frame
2. Mean stack of all frames
3. Mean stack of top-ranked frames
4. Top-ranked stack + Richardson-Lucy deconvolution

It keeps the Bayer mosaic as long as practical, then debayers the stacked result.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from skimage.restoration import richardson_lucy


@dataclass
class DiskDetection:
    center_x: int
    center_y: int
    radius: int


def read_raw_avi_frames(video_path: Path, limit: int | None = None) -> list[np.ndarray]:
    cap = cv2.VideoCapture(str(video_path))
    frames: list[np.ndarray] = []

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        # OpenCV exposes the RAW Bayer AVI as a 3-channel image with identical values.
        frames.append(frame[:, :, 0].copy())
        if limit is not None and len(frames) >= limit:
            break

    cap.release()
    if not frames:
        raise RuntimeError(f"No frames loaded from {video_path}")
    return frames


def detect_disk(raw_frame: np.ndarray) -> DiskDetection | None:
    blurred = cv2.GaussianBlur(raw_frame, (9, 9), 0)
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    (x, y), radius = cv2.minEnclosingCircle(largest)
    h, w = raw_frame.shape
    min_r = min(w, h) // 10
    max_r = min(w, h) // 2
    if not (min_r < radius < max_r):
        return None

    return DiskDetection(int(x), int(y), int(radius))


def center_align_crops(frames: list[np.ndarray]) -> tuple[list[np.ndarray], int]:
    detections = [detect_disk(frame) for frame in frames]
    valid = [d for d in detections if d is not None]
    if not valid:
        raise RuntimeError("Disk detection failed on all RAW frames")

    median_r = int(np.median([d.radius for d in valid]))
    height, width = frames[0].shape
    safe_crop_r = int(min(
        min(d.center_x, width - d.center_x, d.center_y, height - d.center_y)
        for d in valid
    )) - 2
    crop_r = min(int(median_r * 1.08), safe_crop_r)

    output: list[np.ndarray] = []
    for frame, detection in zip(frames, detections):
        if detection is None:
            continue

        y1 = detection.center_y - crop_r
        y2 = detection.center_y + crop_r
        x1 = detection.center_x - crop_r
        x2 = detection.center_x + crop_r

        if y1 < 0 or x1 < 0 or y2 > frame.shape[0] or x2 > frame.shape[1]:
            continue

        crop = frame[y1:y2, x1:x2]

        if crop.shape[0] != crop_r * 2 or crop.shape[1] != crop_r * 2:
            continue

        output.append(crop)

    if not output:
        raise RuntimeError("No aligned crops produced")

    return output, median_r


def debayer_grbg(raw: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(raw, cv2.COLOR_BAYER_GR2BGR)


def grayscale_for_scoring(raw: np.ndarray) -> np.ndarray:
    debayered = debayer_grbg(raw)
    gray = cv2.cvtColor(debayered, cv2.COLOR_BGR2GRAY)
    return cv2.GaussianBlur(gray, (0, 0), 1.0)


def refine_alignment_phase(raw_crops: list[np.ndarray]) -> list[np.ndarray]:
    ref = grayscale_for_scoring(raw_crops[0]).astype(np.float32)
    window = cv2.createHanningWindow((ref.shape[1], ref.shape[0]), cv2.CV_32F)
    refined: list[np.ndarray] = []

    for crop in raw_crops:
        current = grayscale_for_scoring(crop).astype(np.float32)
        (dx, dy), _ = cv2.phaseCorrelate(ref, current, window)
        matrix = np.float32([[1, 0, dx], [0, 1, dy]])
        warped = cv2.warpAffine(crop, matrix, (crop.shape[1], crop.shape[0]))
        refined.append(warped)

    return refined


def make_inner_solar_mask(shape: tuple[int, int], radius: int) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[:h, :w]
    cx = w // 2
    cy = h // 2
    mask = ((xx - cx) ** 2 + (yy - cy) ** 2) <= int(radius * 0.88) ** 2
    return mask.astype(np.uint8)


def frame_quality_score(raw_crop: np.ndarray, mask: np.ndarray) -> float:
    gray = grayscale_for_scoring(raw_crop)
    sobel_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    sobel_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    energy = sobel_x * sobel_x + sobel_y * sobel_y
    values = energy[mask > 0]
    return float(np.mean(values))


def rank_frames(raw_crops: list[np.ndarray], radius: int) -> list[tuple[int, float]]:
    mask = make_inner_solar_mask(raw_crops[0].shape, radius)
    scores = [(idx, frame_quality_score(crop, mask)) for idx, crop in enumerate(raw_crops)]
    return sorted(scores, key=lambda item: item[1], reverse=True)


def mean_stack(raw_crops: list[np.ndarray]) -> np.ndarray:
    stack = np.stack(raw_crops, axis=0).astype(np.float32)
    return np.mean(stack, axis=0).clip(0, 255).astype(np.uint8)


def normalize_percentile(gray: np.ndarray, low: float = 0.2, high: float = 99.8) -> np.ndarray:
    lo = np.percentile(gray, low)
    hi = np.percentile(gray, high)
    scaled = np.clip((gray.astype(np.float32) - lo) / max(hi - lo, 1e-6), 0, 1)
    return (scaled * 255).astype(np.uint8)


def mild_finish(debayered_bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(debayered_bgr, cv2.COLOR_BGR2GRAY)
    gray = normalize_percentile(gray)
    clahe = cv2.createCLAHE(clipLimit=1.5, tileGridSize=(8, 8))
    local = clahe.apply(gray)
    blurred = cv2.GaussianBlur(local, (0, 0), 1.2)
    sharpened = cv2.addWeighted(local, 1.25, blurred, -0.25, 0)
    return sharpened.clip(0, 255).astype(np.uint8)


def richardson_lucy_finish(gray: np.ndarray, iterations: int = 12) -> np.ndarray:
    psf_1d = cv2.getGaussianKernel(5, 1.0)
    psf = psf_1d @ psf_1d.T
    deconv = richardson_lucy(gray.astype(np.float32) / 255.0, psf, num_iter=iterations, clip=False)
    deconv = normalize_percentile((deconv * 255).clip(0, 255).astype(np.uint8), 0.2, 99.9)
    blurred = cv2.GaussianBlur(deconv, (0, 0), 0.8)
    return cv2.addWeighted(deconv, 1.15, blurred, -0.15, 0).clip(0, 255).astype(np.uint8)


def save_image(path: Path, image: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(path), image)


def make_contact_sheet(labeled_images: list[tuple[str, np.ndarray]], out_path: Path) -> None:
    pil_images = []
    for label, image in labeled_images:
        if image.ndim == 2:
            rgb = cv2.cvtColor(image, cv2.COLOR_GRAY2RGB)
        else:
            rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        pil = Image.fromarray(rgb)
        canvas = Image.new("RGB", (pil.width, pil.height + 40), "black")
        canvas.paste(pil, (0, 40))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), label, fill="white")
        pil_images.append(canvas)

    total_width = sum(img.width for img in pil_images)
    max_height = max(img.height for img in pil_images)
    sheet = Image.new("RGB", (total_width, max_height), "black")
    x = 0
    for img in pil_images:
        sheet.paste(img, (x, 0))
        x += img.width
    sheet.save(out_path)


def run(input_path: Path, out_dir: Path, top_fraction: float) -> None:
    raw_frames = read_raw_avi_frames(input_path)
    raw_crops, radius = center_align_crops(raw_frames)
    refined = refine_alignment_phase(raw_crops)
    ranking = rank_frames(refined, radius)

    best_index = ranking[0][0]
    best_raw = refined[best_index]
    best_single = mild_finish(debayer_grbg(best_raw))

    all_stack_raw = mean_stack(refined)
    all_stack = mild_finish(debayer_grbg(all_stack_raw))

    top_count = max(5, int(len(refined) * top_fraction))
    selected = [refined[idx] for idx, _ in ranking[:top_count]]
    top_stack_raw = mean_stack(selected)
    top_stack = mild_finish(debayer_grbg(top_stack_raw))
    top_stack_rl = richardson_lucy_finish(top_stack)

    save_image(out_dir / "01_best_single.png", best_single)
    save_image(out_dir / "02_stack_all_frames.png", all_stack)
    save_image(out_dir / "03_stack_top_ranked.png", top_stack)
    save_image(out_dir / "04_stack_top_ranked_rl.png", top_stack_rl)

    ranking_text = [f"rank,frame_index,score"] + [f"{rank+1},{idx},{score:.6f}" for rank, (idx, score) in enumerate(ranking)]
    (out_dir / "frame_ranking.csv").write_text("\n".join(ranking_text) + "\n", encoding="utf-8")

    make_contact_sheet(
        [
            ("Best single frame", best_single),
            ("All-frame mean", all_stack),
            (f"Top {top_count} mean", top_stack),
            (f"Top {top_count} + RL", top_stack_rl),
        ],
        out_dir / "comparison_sheet.png",
    )

    print(f"Loaded frames: {len(raw_frames)}")
    print(f"Aligned crops: {len(refined)}")
    print(f"Selected top frames: {top_count}")
    print(f"Outputs written to: {out_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Prototype RAW solar stacking options")
    parser.add_argument("input", help="Path to RAW AVI")
    parser.add_argument("--output-dir", "-o", default="./prototype_output", help="Output directory")
    parser.add_argument("--top-fraction", type=float, default=0.2, help="Top fraction of frames to keep")
    args = parser.parse_args()

    run(Path(args.input).resolve(), Path(args.output_dir).resolve(), args.top_fraction)


if __name__ == "__main__":
    main()
