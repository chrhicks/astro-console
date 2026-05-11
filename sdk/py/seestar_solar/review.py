from __future__ import annotations

from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw


def make_sheet(
    images: Iterable[tuple[str, Path]],
    out_path: Path,
    *,
    detail: bool = False,
    detail_center: tuple[float, float] = (0.58, 0.39),
    detail_radius_fraction: float = 0.11,
) -> None:
    cards = []
    for label, path in images:
        img = Image.open(path).convert("RGB")
        if detail:
            w, h = img.size
            cx = int(w * detail_center[0])
            cy = int(h * detail_center[1])
            r = int(min(w, h) * detail_radius_fraction)
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

    out_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(out_path)
