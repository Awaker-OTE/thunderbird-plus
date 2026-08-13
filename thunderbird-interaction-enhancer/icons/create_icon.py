from PIL import Image, ImageDraw


CANVAS = 512
SUPERSAMPLE = 4


def mix(start, end, ratio):
    return tuple(round(start[index] + (end[index] - start[index]) * ratio) for index in range(4))


def scaled(value, scale):
    return round(value * scale)


def scaled_box(box, scale):
    return [scaled(value, scale) for value in box]


def create_gradient(size):
    start = (37, 99, 235, 255)
    end = (15, 23, 42, 255)
    image = Image.new("RGBA", (size, size))
    pixels = image.load()
    limit = max(1, (size - 1) * 2)

    for y in range(size):
        for x in range(size):
            pixels[x, y] = mix(start, end, (x + y) / limit)

    return image


def create_translate_icon(size, filename):
    large_size = size * SUPERSAMPLE
    scale = large_size / CANVAS

    image = Image.new("RGBA", (large_size, large_size), (0, 0, 0, 0))
    mask = Image.new("L", (large_size, large_size), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        scaled_box((40, 40, 472, 472), scale),
        radius=scaled(96, scale),
        fill=255,
    )

    image.paste(create_gradient(large_size), (0, 0), mask)
    draw = ImageDraw.Draw(image, "RGBA")

    draw.rounded_rectangle(
        scaled_box((64, 64, 448, 448), scale),
        radius=scaled(76, scale),
        outline=(255, 255, 255, 31),
        width=max(1, scaled(10, scale)),
    )

    mark = (248, 250, 252, 255)
    draw.rounded_rectangle(
        scaled_box((114, 156, 366, 220), scale),
        radius=scaled(24, scale),
        fill=mark,
    )
    draw.rounded_rectangle(
        scaled_box((212, 156, 286, 370), scale),
        radius=scaled(26, scale),
        fill=mark,
    )

    draw.ellipse(scaled_box((308, 280, 424, 396), scale), fill=(56, 189, 248, 255))
    draw.line(
        [tuple(scaled_box((366, 306), scale)), tuple(scaled_box((366, 370), scale))],
        fill=(15, 23, 42, 255),
        width=max(1, scaled(24, scale)),
    )
    draw.line(
        [tuple(scaled_box((334, 338), scale)), tuple(scaled_box((398, 338), scale))],
        fill=(15, 23, 42, 255),
        width=max(1, scaled(24, scale)),
    )

    image = image.resize((size, size), Image.Resampling.LANCZOS)
    image.save(filename)
    print(f"Created {filename}")


for icon_size in (16, 32, 48, 64, 96, 128):
    create_translate_icon(icon_size, f"translate-{icon_size}.png")
