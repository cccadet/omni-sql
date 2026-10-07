from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs" / "images" / "release-visuals"


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    name = "segoeuib.ttf" if bold else "segoeui.ttf"
    return ImageFont.truetype(f"C:/Windows/Fonts/{name}", size)


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    target_ratio = size[0] / size[1]
    source_ratio = image.width / image.height
    if source_ratio > target_ratio:
        width = round(image.height * target_ratio)
        left = (image.width - width) // 2
        image = image.crop((left, 0, left + width, image.height))
    elif source_ratio < target_ratio:
        height = round(image.width / target_ratio)
        top = (image.height - height) // 2
        image = image.crop((0, top, image.width, top + height))
    return image.resize(size, Image.Resampling.LANCZOS)


def screenshot_card(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    shot = fit(image, size)
    card = Image.new("RGBA", (size[0] + 24, size[1] + 24), (0, 0, 0, 0))
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((12, 12, size[0] + 12, size[1] + 12), 15, fill=(0, 0, 0, 180))
    shadow = shadow.filter(ImageFilter.GaussianBlur(10))
    card.alpha_composite(shadow)
    card.alpha_composite(shot.convert("RGBA"), (0, 0))
    ImageDraw.Draw(card).rounded_rectangle((0, 0, size[0], size[1]), 12, outline=(79, 72, 52, 255), width=2)
    return card


def make_social(overview: Image.Image) -> None:
    canvas = Image.new("RGB", (1280, 640), "#0c0d0f")
    pixels = canvas.load()
    for y in range(canvas.height):
        for x in range(canvas.width):
            glow = max(0.0, 1.0 - (((x - 230) / 520) ** 2 + ((y - 80) / 430) ** 2) ** 0.5)
            pixels[x, y] = (round(12 + 24 * glow), round(13 + 18 * glow), round(15 + 4 * glow))

    draw = ImageDraw.Draw(canvas)
    icon = Image.open(ROOT / "icon-omni-sql.png").convert("RGBA").resize((64, 64), Image.Resampling.LANCZOS)
    canvas.paste(icon, (70, 62), icon)
    draw.text((150, 72), "omni-sql", font=font(34, True), fill="#f4f4f2")
    draw.text((70, 186), "One focused SQL", font=font(50, True), fill="#f4f4f2")
    draw.text((70, 244), "workspace for", font=font(50, True), fill="#f4f4f2")
    draw.text((70, 302), "every database.", font=font(50, True), fill="#ffbd2e")
    draw.text((70, 406), "Context-aware completion · Results · EXPLAIN", font=font(20), fill="#bec0c4")
    draw.text((70, 455), "PostgreSQL  •  MySQL  •  MariaDB", font=font(17, True), fill="#8d9096")
    draw.text((70, 482), "SQL Server  •  Oracle", font=font(17, True), fill="#8d9096")
    draw.rounded_rectangle((70, 548, 270, 590), 8, fill="#ffbd2e")
    draw.text((98, 557), "OPEN SOURCE", font=font(16, True), fill="#191308")

    card = screenshot_card(overview, (690, 371))
    canvas.paste(card, (566, 137), card)
    canvas.save(SOURCE / "omni-sql-social-1280x640.png", optimize=True)


def labeled_frame(image: Image.Image, label: str) -> Image.Image:
    frame = fit(image, (960, 516)).convert("RGBA")
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    box = draw.textbbox((0, 0), label, font=font(20, True))
    width = box[2] - box[0] + 42
    draw.rounded_rectangle((24, 450, 24 + width, 496), 10, fill=(12, 13, 15, 225), outline=(255, 189, 46, 255), width=2)
    draw.text((45, 460), label, font=font(20, True), fill="#f4f4f2")
    return Image.alpha_composite(frame, overlay).convert("RGB")


def make_gif(scenes: list[tuple[Image.Image, str]]) -> None:
    frames: list[Image.Image] = []
    rendered = [labeled_frame(image, label) for image, label in scenes]
    hold_frames = 19
    transition_frames = 5
    for index, current in enumerate(rendered):
        frames.extend([current] * hold_frames)
        following = rendered[(index + 1) % len(rendered)]
        for step in range(1, transition_frames + 1):
            frames.append(Image.blend(current, following, step / (transition_frames + 1)))
    frames[0].save(
        SOURCE / "omni-sql-demo.gif",
        save_all=True,
        append_images=frames[1:],
        duration=170,
        loop=0,
        optimize=True,
        disposal=2,
    )


def main() -> None:
    overview = Image.open(SOURCE / "omni-sql-overview.png").convert("RGB")
    autocomplete = Image.open(SOURCE / "omni-sql-autocomplete.png").convert("RGB")
    results = Image.open(SOURCE / "omni-sql-query-results.png").convert("RGB")
    explain = Image.open(SOURCE / "omni-sql-explain.png").convert("RGB")
    make_social(overview)
    make_gif(
        [
            (autocomplete, "Context-aware autocomplete"),
            (results, "Fast, editable query results"),
            (explain, "PostgreSQL EXPLAIN"),
        ]
    )


if __name__ == "__main__":
    main()
