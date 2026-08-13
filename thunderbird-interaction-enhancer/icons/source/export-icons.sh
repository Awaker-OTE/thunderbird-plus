#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ICON_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MASTER_SVG="${SCRIPT_DIR}/thunderbird-plus-master.svg"
PUBLIC_SVG="${ICON_DIR}/thunderbird-plus.svg"
REFERENCE_PNG="${SCRIPT_DIR}/thunderbird-plus-reference.png"
SIZES=(16 32 48 64 96 128 256 512 1024)

cp "${MASTER_SVG}" "${PUBLIC_SVG}"

if [[ -f "${REFERENCE_PNG}" ]]; then
  echo "Using raster reference ${REFERENCE_PNG} for the final Thunderbird Plus PNG icons."
  python3 - "${ICON_DIR}" "${REFERENCE_PNG}" <<'PY'
import sys
from collections import deque
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:
    raise SystemExit("Pillow is required to export the reference PNG: python3 -m pip install pillow") from exc

ICON_DIR = Path(sys.argv[1])
REFERENCE = Path(sys.argv[2])
SIZES = (16, 32, 48, 64, 96, 128, 256, 512, 1024)


def is_border_white(pixel):
    r, g, b, _ = pixel
    return r >= 238 and g >= 238 and b >= 238 and max(r, g, b) - min(r, g, b) <= 18


def remove_connected_white_background(image):
    image = image.convert("RGBA")
    width, height = image.size
    pixels = image.load()
    visited = bytearray(width * height)
    queue = deque()

    def index(x, y):
        return y * width + x

    def enqueue(x, y):
        i = index(x, y)
        if visited[i]:
            return
        if is_border_white(pixels[x, y]):
            visited[i] = 1
            queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < width and 0 <= ny < height:
                enqueue(nx, ny)

    background = Image.new("L", (width, height), 0)
    background.putdata(visited)
    background = background.point(lambda value: 255 if value else 0).filter(ImageFilter.GaussianBlur(1.2))

    alpha = image.getchannel("A")
    alpha_pixels = []
    for alpha_value, background_value in zip(alpha.getdata(), background.getdata()):
        alpha_pixels.append(round(alpha_value * (255 - background_value) / 255))
    alpha.putdata(alpha_pixels)
    image.putalpha(alpha)
    return image


def export_icons(source):
    for size in SIZES:
        icon = source.resize((size, size), Image.Resampling.LANCZOS)
        if size <= 32:
            icon = icon.filter(ImageFilter.UnsharpMask(radius=0.45, percent=170, threshold=1))
        elif size <= 96:
            icon = icon.filter(ImageFilter.UnsharpMask(radius=0.55, percent=115, threshold=2))
        output = ICON_DIR / f"thunderbird-plus-{size}.png"
        icon.save(output)
        print(f"Generated {output}")


def add_label(draw, position, text, fill):
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    draw.text(position, text, fill=fill, font=font)


def make_preview():
    preview = Image.new("RGB", (1800, 1180), (246, 248, 252))
    draw = ImageDraw.Draw(preview)
    add_label(draw, (90, 54), "Thunderbird Plus - reference-based icon", (20, 24, 46))

    large = Image.open(ICON_DIR / "thunderbird-plus-1024.png").convert("RGBA").resize((620, 620), Image.Resampling.LANCZOS)
    preview.paste(large, (90, 130), large)
    add_label(draw, (90, 784), "1024 px source render", (74, 78, 105))

    sizes = [128, 64, 32, 16]
    white_panel = (810, 130, 1690, 500)
    dark_panel = (810, 570, 1690, 940)
    draw.rounded_rectangle(white_panel, radius=34, fill=(255, 255, 255), outline=(225, 230, 241), width=2)
    draw.rounded_rectangle(dark_panel, radius=34, fill=(18, 16, 56), outline=(42, 37, 112), width=2)
    add_label(draw, (842, 162), "White background", (74, 78, 105))
    add_label(draw, (842, 602), "Dark background", (218, 224, 244))

    x_positions = [880, 1110, 1320, 1510]
    for x, icon_size in zip(x_positions, sizes):
        icon = Image.open(ICON_DIR / f"thunderbird-plus-{icon_size}.png").convert("RGBA")
        preview.paste(icon, (x, 282 - icon_size // 2), icon)
        preview.paste(icon, (x, 722 - icon_size // 2), icon)
        add_label(draw, (x - 18, 394), f"{icon_size}px", (74, 78, 105))
        add_label(draw, (x - 18, 834), f"{icon_size}px", (218, 224, 244))

    output = ICON_DIR / "thunderbird-plus-preview.png"
    preview.save(output)
    print(f"Generated {output}")


source = remove_connected_white_background(Image.open(REFERENCE))
export_icons(source)
make_preview()
PY

  echo
  echo "Generated files:"
  for size in "${SIZES[@]}"; do
    printf '  %s\n' "${ICON_DIR}/thunderbird-plus-${size}.png"
  done
  printf '  %s\n' "${ICON_DIR}/thunderbird-plus-preview.png"
  exit 0
fi

renderer=""
if command -v rsvg-convert >/dev/null 2>&1; then
  renderer="rsvg"
elif command -v magick >/dev/null 2>&1; then
  renderer="magick"
elif command -v inkscape >/dev/null 2>&1; then
  renderer="inkscape"
elif command -v node >/dev/null 2>&1 && node -e "require('sharp')" >/dev/null 2>&1; then
  renderer="sharp"
fi

render_svg() {
  local size="$1"
  local output="$2"

  case "${renderer}" in
    rsvg)
      rsvg-convert -w "${size}" -h "${size}" "${MASTER_SVG}" -o "${output}"
      ;;
    magick)
      magick -background none -density 1024 "${MASTER_SVG}" -resize "${size}x${size}" "${output}"
      ;;
    inkscape)
      inkscape "${MASTER_SVG}" --export-type=png --export-filename="${output}" -w "${size}" -h "${size}" >/dev/null
      ;;
    sharp)
      node - "${MASTER_SVG}" "${output}" "${size}" <<'NODE'
const sharp = require("sharp");
const [input, output, sizeText] = process.argv.slice(2);
const size = Number(sizeText);
sharp(input).resize(size, size).png().toFile(output).catch((error) => {
  console.error(error);
  process.exit(1);
});
NODE
      ;;
  esac
}

if [[ -n "${renderer}" ]]; then
  echo "Using ${renderer} to export PNG files from ${MASTER_SVG}"
  for size in "${SIZES[@]}"; do
    render_svg "${size}" "${ICON_DIR}/thunderbird-plus-${size}.png"
  done
else
  cat <<'MSG'
No ImageMagick, librsvg, Inkscape, or Sharp renderer was found.

Install one of these for SVG-native exports:
  brew install librsvg
  brew install imagemagick
  brew install --cask inkscape
  npm install sharp

Using the bundled Pillow fallback now. It recreates the same vector geometry and applies small-size optical corrections.
MSG
fi

python3 - "${ICON_DIR}" "${renderer:-fallback}" <<'PY'
import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as exc:
    raise SystemExit("Pillow is required for fallback export and preview generation: python3 -m pip install pillow") from exc

ICON_DIR = Path(sys.argv[1])
RENDERER = sys.argv[2]
SIZES = (16, 32, 48, 64, 96, 128, 256, 512, 1024)
CANVAS = 1024
SUPERSAMPLE = 4


def mix(a, b, ratio):
    return tuple(round(a[i] + (b[i] - a[i]) * ratio) for i in range(4))


def make_bg(size):
    start = (32, 27, 97, 255)
    middle = (23, 22, 74, 255)
    end = (18, 16, 56, 255)
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    center_x, center_y = size * 0.46, size * 0.34
    max_radius = size * 0.78
    for y in range(size):
        for x in range(size):
            distance = math.hypot(x - center_x, y - center_y) / max_radius
            if distance < 0.58:
                color = mix(start, middle, distance / 0.58)
            else:
                color = mix(middle, end, min(1, (distance - 0.58) / 0.42))
            pixels[x, y] = color
    return image


def scale_point(point, scale):
    return (point[0] * scale, point[1] * scale)


def rounded_diamond_points(top, right, bottom, left, radius, scale):
    vertices = [top, right, bottom, left]
    scaled_vertices = [scale_point(point, scale) for point in vertices]
    radius *= scale
    points = []

    for index, vertex in enumerate(scaled_vertices):
        previous_vertex = scaled_vertices[index - 1]
        next_vertex = scaled_vertices[(index + 1) % len(scaled_vertices)]

        def offset_toward(target):
            dx = target[0] - vertex[0]
            dy = target[1] - vertex[1]
            length = max(1, math.hypot(dx, dy))
            return (vertex[0] + dx / length * radius, vertex[1] + dy / length * radius)

        start = offset_toward(previous_vertex)
        end = offset_toward(next_vertex)
        for step in range(9):
            t = step / 8
            x = (1 - t) ** 2 * start[0] + 2 * (1 - t) * t * vertex[0] + t**2 * end[0]
            y = (1 - t) ** 2 * start[1] + 2 * (1 - t) * t * vertex[1] + t**2 * end[1]
            points.append((x, y))

    return points


def gradient_for_mask(size, colors, mask):
    top, bottom = colors
    gradient = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = gradient.load()
    limit = max(1, size - 1)
    for y in range(size):
        ratio = y / limit
        color = mix(top, bottom, ratio)
        for x in range(size):
            pixels[x, y] = color
    output = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    output.paste(gradient, (0, 0), mask)
    return output


def draw_layer(image, spec, scale, size, small):
    top, right, bottom, left, radius, colors, edge_color = spec
    points = rounded_diamond_points(top, right, bottom, left, radius, scale)
    mask = Image.new("L", (size, size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.polygon(points, fill=255)

    if not small:
        shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        shifted_mask = Image.new("L", (size, size), 0)
        shifted = [(x, y + 18 * scale) for x, y in points]
        ImageDraw.Draw(shifted_mask).polygon(shifted, fill=72)
        shadow.putalpha(shifted_mask.filter(ImageFilter.GaussianBlur(max(1, round(18 * scale)))))
        image.alpha_composite(shadow)

    image.alpha_composite(gradient_for_mask(size, colors, mask))

    draw = ImageDraw.Draw(image, "RGBA")
    lower = rounded_diamond_points(
        ((left[0] + bottom[0]) / 2, (left[1] + bottom[1]) / 2),
        right,
        bottom,
        left,
        radius * 0.55,
        scale,
    )
    draw.polygon(lower, fill=edge_color)

    if not small:
        highlight_y = (top[1] + right[1]) / 2
        draw.line(
            [
                scale_point(((left[0] + top[0]) / 2, highlight_y), scale),
                scale_point(top, scale),
                scale_point(((right[0] + top[0]) / 2, highlight_y), scale),
            ],
            fill=(237, 248, 255, 44),
            width=max(1, round(8 * scale)),
            joint="curve",
        )


def star_points(cx, cy, outer, inner, scale):
    cx *= scale
    cy *= scale
    outer *= scale
    inner *= scale
    return [
        (cx, cy - outer),
        (cx + inner, cy - inner),
        (cx + outer, cy),
        (cx + inner, cy + inner),
        (cx, cy + outer),
        (cx - inner, cy + inner),
        (cx - outer, cy),
        (cx - inner, cy - inner),
    ]


def draw_star(image, scale, size, small):
    draw = ImageDraw.Draw(image, "RGBA")
    outer = 128 if small else 120
    inner = 34 if small else 28
    points = star_points(512, 432, outer, inner, scale)

    if not small:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow, "RGBA")
        glow_draw.ellipse(
            [
                (512 - 154) * scale,
                (432 - 122) * scale,
                (512 + 154) * scale,
                (432 + 122) * scale,
            ],
            fill=(139, 223, 255, 46),
        )
        glow = glow.filter(ImageFilter.GaussianBlur(max(1, round(9 * scale))))
        image.alpha_composite(glow)

    draw.polygon(points, fill=(255, 255, 255, 255))
    if not small:
        inner_points = star_points(512, 432, 94, 22, scale)
        draw.polygon(inner_points, fill=(237, 248, 255, 190))


def create_icon(size):
    large_size = size * SUPERSAMPLE
    scale = large_size / CANVAS
    small = size <= 32
    image = Image.new("RGBA", (large_size, large_size), (0, 0, 0, 0))
    mask = Image.new("L", (large_size, large_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    inset = 48 if not small else 56
    radius = 225 if not small else 210
    mask_draw.rounded_rectangle(
        [inset * scale, inset * scale, (CANVAS - inset) * scale, (CANVAS - inset) * scale],
        radius=radius * scale,
        fill=255,
    )
    image.paste(make_bg(large_size), (0, 0), mask)
    draw = ImageDraw.Draw(image, "RGBA")
    draw.rounded_rectangle(
        [74 * scale, 74 * scale, 950 * scale, 950 * scale],
        radius=198 * scale,
        outline=(237, 248, 255, 30 if small else 23),
        width=max(2 if small else 1, round((16 if small else 10) * scale)),
    )

    specs = [
        ((512, 362), (792, 585), (512, 808), (232, 585), 58, ((62, 70, 216, 255), (34, 26, 120, 255)), (40, 27, 141, 132)),
        ((512, 302), (759, 501), (512, 700), (265, 501), 50, ((88, 84, 244, 255), (53, 35, 165, 255)), (58, 39, 192, 108)),
        ((512, 236), (721, 406), (512, 576), (303, 406), 44, ((102, 199, 255, 255), (138, 108, 255, 255)), (93, 67, 236, 76)),
    ]
    if small:
        specs = [
            ((512, 390), (794, 585), (512, 780), (230, 585), 42, ((62, 70, 216, 255), (34, 26, 120, 255)), (40, 27, 141, 132)),
            ((512, 318), (746, 508), (512, 698), (278, 508), 38, ((88, 84, 244, 255), (53, 35, 165, 255)), (58, 39, 192, 108)),
            ((512, 248), (704, 414), (512, 580), (320, 414), 34, ((102, 199, 255, 255), (138, 108, 255, 255)), (93, 67, 236, 76)),
        ]

    for spec in specs:
        draw_layer(image, spec, scale, large_size, small)
    draw_star(image, scale, large_size, small)
    return image.resize((size, size), Image.Resampling.LANCZOS)


def generate_icons():
    sizes_to_render = SIZES if RENDERER == "fallback" else (16, 32)
    for size in sizes_to_render:
        output = ICON_DIR / f"thunderbird-plus-{size}.png"
        create_icon(size).save(output)
        print(f"Generated {output}")


def add_label(draw, position, text, fill):
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 24)
    except OSError:
        font = ImageFont.load_default()
    draw.text(position, text, fill=fill, font=font)


def make_preview():
    preview = Image.new("RGB", (1800, 1180), (246, 248, 252))
    draw = ImageDraw.Draw(preview)
    add_label(draw, (90, 54), "Thunderbird Plus - Layered Intelligence", (20, 24, 46))

    large = Image.open(ICON_DIR / "thunderbird-plus-1024.png").convert("RGBA").resize((620, 620), Image.Resampling.LANCZOS)
    preview.paste(large, (90, 130), large)
    add_label(draw, (90, 784), "1024 px source render", (74, 78, 105))

    sizes = [128, 64, 32, 16]
    white_panel = (810, 130, 1690, 500)
    dark_panel = (810, 570, 1690, 940)
    draw.rounded_rectangle(white_panel, radius=34, fill=(255, 255, 255), outline=(225, 230, 241), width=2)
    draw.rounded_rectangle(dark_panel, radius=34, fill=(18, 16, 56), outline=(42, 37, 112), width=2)
    add_label(draw, (842, 162), "White background", (74, 78, 105))
    add_label(draw, (842, 602), "Dark background", (218, 224, 244))

    x_positions = [880, 1110, 1320, 1510]
    for x, icon_size in zip(x_positions, sizes):
        icon = Image.open(ICON_DIR / f"thunderbird-plus-{icon_size}.png").convert("RGBA")
        preview.paste(icon, (x, 282 - icon_size // 2), icon)
        preview.paste(icon, (x, 722 - icon_size // 2), icon)
        add_label(draw, (x - 18, 394), f"{icon_size}px", (74, 78, 105))
        add_label(draw, (x - 18, 834), f"{icon_size}px", (218, 224, 244))

    output = ICON_DIR / "thunderbird-plus-preview.png"
    preview.save(output)
    print(f"Generated {output}")


generate_icons()
make_preview()
PY

echo
echo "Generated files:"
for size in "${SIZES[@]}"; do
  printf '  %s\n' "${ICON_DIR}/thunderbird-plus-${size}.png"
done
printf '  %s\n' "${ICON_DIR}/thunderbird-plus.svg"
printf '  %s\n' "${ICON_DIR}/thunderbird-plus-preview.png"
