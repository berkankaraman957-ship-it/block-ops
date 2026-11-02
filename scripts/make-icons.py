"""Generates the app icon (voxel crosshair-block motif) in every size needed for PWA/Android/iOS."""
import sys, os
from PIL import Image, ImageDraw

def icon(size):
    s = 1024
    im = Image.new('RGBA', (s, s), (17, 21, 28, 255))
    d = ImageDraw.Draw(im)
    # isometric voxel cube
    cx, cy, a = s // 2, s // 2 + 40, 300
    top = [(cx, cy - a), (cx + a, cy - a // 2), (cx, cy), (cx - a, cy - a // 2)]
    left = [(cx - a, cy - a // 2), (cx, cy), (cx, cy + a), (cx - a, cy + a // 2)]
    right = [(cx + a, cy - a // 2), (cx, cy), (cx, cy + a), (cx + a, cy + a // 2)]
    d.polygon(top, fill=(240, 169, 59))
    d.polygon(left, fill=(178, 110, 30))
    d.polygon(right, fill=(120, 72, 18))
    # crosshair
    col = (110, 255, 122)
    w = 26
    d.rectangle([cx - w // 2, 120, cx + w // 2, 300], fill=col)
    d.rectangle([cx - w // 2, s - 300 + 80, cx + w // 2, s - 120 + 80], fill=col)
    d.rectangle([110, cy - w // 2 - 40, 260, cy + w // 2 - 40], fill=col)
    d.rectangle([s - 260, cy - w // 2 - 40, s - 110, cy + w // 2 - 40], fill=col)
    return im.resize((size, size), Image.LANCZOS)

out = sys.argv[1] if len(sys.argv) > 1 else 'public/icons'
os.makedirs(out, exist_ok=True)
for sz in (48, 72, 96, 144, 192, 512, 1024):
    icon(sz).save(os.path.join(out, f'icon-{sz}.png'))
print('icons written to', out)
