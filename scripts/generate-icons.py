"""Generate the extension's simple download glyph using only the Python standard library."""
from pathlib import Path
import math
import struct
import zlib

OUTPUT = Path(__file__).resolve().parents[1] / 'extension' / 'icons'
OUTPUT.mkdir(parents=True, exist_ok=True)
SEGMENTS = [(0.5, 0.24, 0.5, 0.62), (0.34, 0.48, 0.5, 0.64),
            (0.5, 0.64, 0.66, 0.48), (0.29, 0.69, 0.29, 0.77),
            (0.29, 0.77, 0.71, 0.77), (0.71, 0.77, 0.71, 0.69)]

def distance(x, y, segment):
    x1, y1, x2, y2 = segment
    fraction = max(0, min(1, ((x-x1)*(x2-x1)+(y-y1)*(y2-y1))/((x2-x1)**2+(y2-y1)**2)))
    return math.hypot(x-x1-fraction*(x2-x1), y-y1-fraction*(y2-y1))

def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data))

for size in (16, 32, 48, 128):
    rows = bytearray()
    for y in range(size):
        rows.append(0)
        for x in range(size):
            samples = []
            for sy in range(4):
                for sx in range(4):
                    px, py = (x+(sx+.5)/4)/size, (y+(sy+.5)/4)/size
                    corner = math.hypot(max(abs(px-.5)-.28, 0), max(abs(py-.5)-.28, 0))
                    if corner > .21:
                        samples.append((0, 0, 0, 0))
                    elif min(distance(px, py, segment) for segment in SEGMENTS) < .035:
                        samples.append((242, 255, 251, 255))
                    else:
                        samples.append((int(20+10*(1-py)), int(104+25*(1-py)), int(101+18*(1-py)), 255))
            rows.extend(round(sum(s[i] for s in samples)/len(samples)) for i in range(4))
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(bytes(rows))) + chunk(b'IEND', b'')
    (OUTPUT / f'{size}.png').write_bytes(png)
