"""Generate Tunebox app icons (pure Python, no PIL). Run: python make_icons.py"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).parent / "icons"


def inside_note(x, y):
    # two beamed eighth notes, unit square coords (y down)
    for cx, cy in ((0.36, 0.70), (0.66, 0.64)):
        dx, dy = x - cx, y - cy
        a = math.radians(-22)
        rx = dx * math.cos(a) - dy * math.sin(a)
        ry = dx * math.sin(a) + dy * math.cos(a)
        if (rx / 0.105) ** 2 + (ry / 0.078) ** 2 <= 1:
            return True
    # stems
    if 0.435 <= x <= 0.470 and 0.27 <= y <= 0.69:
        return True
    if 0.735 <= x <= 0.770 and 0.21 <= y <= 0.63:
        return True
    # beam: band between the two stem tops
    if 0.435 <= x <= 0.770:
        t = (x - 0.435) / (0.770 - 0.435)
        top = 0.27 + (0.21 - 0.27) * t
        if top <= y <= top + 0.085:
            return True
    return False


def make(size):
    ss = 3
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            u, v = px / size, py / size
            # diagonal gradient pink -> violet
            g = (u + v) / 2
            r0 = int(255 * (1 - g) + 124 * g)
            g0 = int(79 * (1 - g) + 58 * g)
            b0 = int(123 * (1 - g) + 237 * g)
            hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    if inside_note((px + (sx + .5) / ss) / size, (py + (sy + .5) / ss) / size):
                        hits += 1
            c = hits / (ss * ss)
            row += bytes((int(r0 + (255 - r0) * c), int(g0 + (255 - g0) * c), int(b0 + (255 - b0) * c)))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    (OUT / f"icon-{size}.png").write_bytes(png)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    for s in (180, 192, 512):
        make(s)
        print("wrote", s)
