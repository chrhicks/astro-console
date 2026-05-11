#!/usr/bin/env python3
"""
Solar image stacking and enhancement pipeline.

Usage:
    python process_solar.py <mp4_or_image_path> [--output-dir <dir>]

Steps:
  1. Extract frames from MP4 (if video) or load single image
  2. Detect solar disk and align all frames to a common center
  3. Stack (mean / median / sigma-clip mean) aligned frames
  4. Enhance: sharpen, CLAHE contrast, false-color mapping
  5. Save results
"""

import argparse
import sys
import os
import shutil
import subprocess
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def extract_frames(video_path: Path, out_dir: Path, fps: float | None = None) -> list[Path]:
    """Extract frames from MP4 using ffmpeg."""
    out_dir.mkdir(parents=True, exist_ok=True)
    fps_arg = ["-vf", f"fps={fps}"] if fps else []
    cmd = [
        "ffmpeg", "-y", "-i", str(video_path),
        *fps_arg,
        str(out_dir / "frame_%04d.png")
    ]
    print(f"Extracting frames: {' '.join(cmd)}")
    subprocess.run(cmd, check=True, capture_output=True)
    frames = sorted(out_dir.glob("frame_*.png"))
    print(f"  Extracted {len(frames)} frames")
    return frames


def detect_solar_disk(frame: np.ndarray) -> tuple[tuple[int, int], int] | None:
    """
    Detect the solar disk in a grayscale frame.
    Returns (center_x, center_y), radius or None if detection fails.
    """
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame

    # Blur to reduce noise
    blurred = cv2.GaussianBlur(gray, (9, 9), 0)

    # Threshold to get the bright disk
    # Solar disk should be the brightest thing; use Otsu or a high percentile
    _, thresh = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Find contours
    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    # Take the largest contour (should be the sun)
    largest = max(contours, key=cv2.contourArea)
    (x, y), radius = cv2.minEnclosingCircle(largest)
    center = (int(x), int(y))
    radius = int(radius)

    # Sanity check: radius should be reasonable fraction of image
    h, w = gray.shape
    min_r = min(w, h) // 10
    max_r = min(w, h) // 2
    if not (min_r < radius < max_r):
        # Try HoughCircles as fallback
        circles = cv2.HoughCircles(blurred, cv2.HOUGH_GRADIENT, dp=1.2, minDist=min(w,h)//2,
                                   param1=100, param2=30, minRadius=min_r, maxRadius=max_r)
        if circles is not None:
            c = circles[0][0]
            center = (int(c[0]), int(c[1]))
            radius = int(c[2])
        else:
            return None

    return center, radius


def align_frames(frames: list[np.ndarray], target_size: int = 1024) -> list[np.ndarray]:
    """
    Detect solar disk in each frame, crop to a square around it,
    and resize to target_size x target_size.
    Returns list of aligned grayscale frames.
    """
    aligned = []
    centers = []
    radii = []

    for i, frame in enumerate(frames):
        result = detect_solar_disk(frame)
        if result is None:
            print(f"  Warning: could not detect disk in frame {i}, skipping")
            continue
        (cx, cy), r = result
        centers.append((cx, cy))
        radii.append(r)
        aligned.append(frame)

    if not aligned:
        raise RuntimeError("No frames with detected solar disks")

    # Use median center and radius for consistency
    median_cx = int(np.median([c[0] for c in centers]))
    median_cy = int(np.median([c[1] for c in centers]))
    median_r = int(np.median(radii))

    # Crop margin: a bit larger than the disk
    crop_r = int(median_r * 1.15)

    output = []
    for i, frame in enumerate(aligned):
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY) if len(frame.shape) == 3 else frame
        cx, cy = centers[i]
        # Crop around the detected center
        x1 = max(0, cx - crop_r)
        y1 = max(0, cy - crop_r)
        x2 = min(gray.shape[1], cx + crop_r)
        y2 = min(gray.shape[0], cy + crop_r)
        cropped = gray[y1:y2, x1:x2]
        # Resize to standard size
        resized = cv2.resize(cropped, (target_size, target_size), interpolation=cv2.INTER_LANCZOS4)
        output.append(resized)

    print(f"  Aligned {len(output)} frames to {target_size}x{target_size}")
    return output


def stack_frames(frames: list[np.ndarray], method: str = "mean") -> np.ndarray:
    """Stack aligned frames using mean, median, or sigma-clipped mean."""
    stack = np.stack(frames, axis=0).astype(np.float32)

    if method == "mean":
        result = np.mean(stack, axis=0)
    elif method == "median":
        result = np.median(stack, axis=0)
    elif method == "sigma":
        # Sigma-clipped mean: clip at 2 sigma
        mean = np.mean(stack, axis=0)
        std = np.std(stack, axis=0)
        lower = mean - 2 * std
        upper = mean + 2 * std
        clipped = np.clip(stack, lower, upper)
        result = np.mean(clipped, axis=0)
    else:
        raise ValueError(f"Unknown stacking method: {method}")

    return np.clip(result, 0, 255).astype(np.uint8)


def normalize_brightness(img: np.ndarray) -> np.ndarray:
    """Normalize image to use full 0-255 range."""
    img = img.astype(np.float32)
    mn, mx = img.min(), img.max()
    if mx > mn:
        img = (img - mn) / (mx - mn) * 255
    return img.astype(np.uint8)


def enhance_surface(img: np.ndarray) -> np.ndarray:
    """Enhance solar surface detail using CLAHE and unsharp mask."""
    # CLAHE for local contrast
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(img)

    # Unsharp mask
    blurred = cv2.GaussianBlur(enhanced, (0, 0), 2)
    sharpened = cv2.addWeighted(enhanced, 1.5, blurred, -0.5, 0)

    return np.clip(sharpened, 0, 255).astype(np.uint8)


def apply_false_color(img: np.ndarray, style: str = "sdo") -> np.ndarray:
    """Apply false color mapping."""
    if style == "sdo":
        # SDO 171-style: gold/yellow surface
        colored = cv2.applyColorMap(img, cv2.COLORMAP_HOT)
        # Shift toward gold/orange
        b, g, r = cv2.split(colored)
        r = cv2.addWeighted(r, 1.0, g, 0.3, 0)
        colored = cv2.merge([b, g, r])
    elif style == "blue":
        colored = cv2.applyColorMap(img, cv2.COLORMAP_JET)
    elif style == "green":
        colored = cv2.applyColorMap(img, cv2.COLORMAP_VIRIDIS)
    elif style == "mono":
        colored = cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
    else:
        colored = cv2.applyColorMap(img, cv2.COLORMAP_INFERNO)

    return colored


def process(input_path: Path, output_dir: Path, fps: float | None = None):
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 1: Load or extract frames
    if input_path.suffix.lower() in (".mp4", ".avi", ".mov", ".mkv"):
        frames_dir = output_dir / "frames"
        if frames_dir.exists():
            shutil.rmtree(frames_dir)
        frame_paths = extract_frames(input_path, frames_dir, fps)
        raw_frames = [cv2.imread(str(p)) for p in frame_paths]
        raw_frames = [f for f in raw_frames if f is not None]
    else:
        frame = cv2.imread(str(input_path))
        if frame is None:
            raise RuntimeError(f"Could not load image: {input_path}")
        raw_frames = [frame]
        frame_paths = [input_path]

    print(f"Loaded {len(raw_frames)} frames")

    # Step 2: Align
    aligned = align_frames(raw_frames, target_size=1024)

    # Save a sample aligned frame
    cv2.imwrite(str(output_dir / "aligned_sample.png"), aligned[len(aligned)//2])

    # Step 3: Stack
    stacked = stack_frames(aligned, method="mean")
    stacked_norm = normalize_brightness(stacked)
    cv2.imwrite(str(output_dir / "stacked.png"), stacked_norm)
    print("  Saved stacked.png")

    # Step 4: Enhance
    enhanced = enhance_surface(stacked_norm)
    cv2.imwrite(str(output_dir / "enhanced.png"), enhanced)
    print("  Saved enhanced.png")

    # Step 5: Colorize variants
    for style in ["sdo", "blue", "green", "mono"]:
        colored = apply_false_color(enhanced, style)
        out_name = output_dir / f"colored_{style}.png"
        cv2.imwrite(str(out_name), colored)
        print(f"  Saved {out_name.name}")

    # Also save a high-contrast sunspot version
    spots = cv2.createCLAHE(clipLimit=4.0, tileGridSize=(8, 8)).apply(enhanced)
    spots_colored = apply_false_color(spots, "sdo")
    cv2.imwrite(str(output_dir / "colored_sunspots.png"), spots_colored)
    print("  Saved colored_sunspots.png")

    print(f"\nAll results in: {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Stack and enhance solar images")
    parser.add_argument("input", help="Path to MP4 timelapse or single image")
    parser.add_argument("--output-dir", "-o", default="./solar_output", help="Output directory")
    parser.add_argument("--fps", type=float, default=None, help="Frame extraction FPS (default: all)")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_dir = Path(args.output_dir).resolve()

    if not input_path.exists():
        print(f"Error: file not found: {input_path}")
        sys.exit(1)

    process(input_path, output_dir, fps=args.fps)


if __name__ == "__main__":
    main()
