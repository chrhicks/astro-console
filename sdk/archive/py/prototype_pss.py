#!/usr/bin/env python3
"""Run PlanetarySystemStacker on a RAW AVI at several stack percentages.

This wraps PSS in a reproducible way and renders quick-look PNG outputs plus
comparison sheets so we can judge whether a given percentage is better.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


def run_pss(pss_source: Path, input_path: Path, output_dir: Path, percentages: list[int]) -> list[tuple[int, Path]]:
    output_dir.mkdir(parents=True, exist_ok=True)
    local_input = output_dir / input_path.name
    if not local_input.exists():
        os.symlink(input_path, local_input)

    env = os.environ.copy()
    env["QT_QPA_PLATFORM"] = "offscreen"
    env["PYTHONPATH"] = str(pss_source)

    results: list[tuple[int, Path]] = []
    for pct in percentages:
        command = [
            sys.executable,
            "-m",
            "planetary_system_stacker.planetary_system_stacker",
            "--out_format",
            "tiff",
            "--debayering",
            "Force Bayer GRBG",
            "--debayer_method",
            "Edge Aware",
            "-m",
            "Surface",
            "-s",
            str(pct),
            "--rf_percent",
            "10",
            "--name_add_p",
            "--name_add_f",
            str(local_input),
        ]
        subprocess.run(command, check=True, cwd=pss_source, env=env, capture_output=True, text=True)

        # PSS writes output next to the input with a generated suffix.
        candidates = sorted(output_dir.glob(f"{input_path.stem}_pss_*.tiff"), key=lambda p: p.stat().st_mtime)
        if not candidates:
            raise RuntimeError(f"No PSS output found for stack percent {pct}")
        results.append((pct, candidates[-1]))

    return results


def finish_tiff(tiff_path: Path, out_path: Path) -> None:
    img = cv2.imread(str(tiff_path), cv2.IMREAD_UNCHANGED)
    if img is None:
        raise RuntimeError(f"Could not read {tiff_path}")

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY) if img.ndim == 3 else img
    lo = np.percentile(gray, 0.2)
    hi = np.percentile(gray, 99.8)
    scaled = np.clip((gray.astype(np.float32) - lo) / max(hi - lo, 1), 0, 1)
    img8 = (scaled * 255).astype(np.uint8)
    clahe = cv2.createCLAHE(clipLimit=1.2, tileGridSize=(8, 8)).apply(img8)
    blur = cv2.GaussianBlur(clahe, (0, 0), 1.0)
    sharp = cv2.addWeighted(clahe, 1.2, blur, -0.2, 0)
    cv2.imwrite(str(out_path), sharp)


def make_sheet(rendered: list[tuple[str, Path]], out_path: Path, detail: bool) -> None:
    cards = []
    for label, path in rendered:
        img = Image.open(path).convert("RGB")
        if detail:
            w, h = img.size
            cx = int(w * 0.58)
            cy = int(h * 0.39)
            r = int(min(w, h) * 0.11)
            img = img.crop((cx - r, cy - r, cx + r, cy + r)).resize((420, 420), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (420, 460), "black")
        else:
            target_h = 700
            target_w = round(img.width * target_h / img.height)
            img = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
            canvas = Image.new("RGB", (img.width, img.height + 40), "black")
        canvas.paste(img, (0, 40))
        draw = ImageDraw.Draw(canvas)
        draw.text((12, 10), label, fill="white")
        cards.append(canvas)

    sheet = Image.new("RGB", (sum(c.width for c in cards), max(c.height for c in cards)), "black")
    x = 0
    for card in cards:
        sheet.paste(card, (x, 0))
        x += card.width
    sheet.save(out_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prototype PSS stack percentages on a RAW AVI")
    parser.add_argument("input", help="Path to RAW AVI")
    parser.add_argument("--pss-source", default="/tmp/opencode/PlanetarySystemStacker", help="Path to PSS source checkout")
    parser.add_argument("--output-dir", "-o", default="./prototype_output/pss_sweep", help="Output directory")
    parser.add_argument("--percentages", default="10,20,35,50", help="Comma-separated stack percentages")
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    pss_source = Path(args.pss_source).resolve()
    output_dir = Path(args.output_dir).resolve()
    percentages = [int(value) for value in args.percentages.split(",") if value.strip()]

    tiffs = run_pss(pss_source, input_path, output_dir, percentages)
    rendered: list[tuple[str, Path]] = []
    for pct, tiff_path in tiffs:
        png_path = output_dir / f"pss_{pct:02d}.png"
        finish_tiff(tiff_path, png_path)
        rendered.append((f"PSS {pct}%", png_path))

    make_sheet(rendered, output_dir / "pss_percentage_comparison.png", detail=False)
    make_sheet(rendered, output_dir / "pss_percentage_detail_comparison.png", detail=True)
    print(f"PSS outputs written to: {output_dir}")


if __name__ == "__main__":
    main()
