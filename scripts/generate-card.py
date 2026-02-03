#!/usr/bin/env python3
"""Generate a Twitter card image for dpth.io — v4: minimal, readable at thumbnail"""
from PIL import Image, ImageDraw, ImageFont
import os

W, H = 1200, 630
bg = (10, 10, 14)
accent = (59, 130, 246)
green = (34, 197, 94)
white = (240, 240, 240)
dim = (120, 120, 130)
surface = (22, 22, 28)

img = Image.new('RGB', (W, H), bg)
draw = ImageDraw.Draw(img)

def get_font(size, bold=False):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    return ImageFont.truetype(p, size) if os.path.exists(p) else ImageFont.load_default()

def get_mono(size):
    p = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
    return ImageFont.truetype(p, size) if os.path.exists(p) else ImageFont.load_default()

def center_text(y, text, font, fill):
    bbox = draw.textbbox((0, 0), text, font=font)
    draw.text(((W - (bbox[2]-bbox[0])) // 2, y), text, fill=fill, font=font)
    return bbox[3] - bbox[1]

def text_width(text, font):
    bbox = draw.textbbox((0, 0), text, font=font)
    return bbox[2] - bbox[0]

# Subtle grid
for x in range(0, W, 80):
    draw.line([(x, 0), (x, H)], fill=(14, 14, 18), width=1)
for y_line in range(0, H, 80):
    draw.line([(0, y_line), (W, y_line)], fill=(14, 14, 18), width=1)

# --- Simple visual: three circles connected by lines (data sources → unified) ---
# Left side: three source dots, right side: one unified dot
# Positioned in upper-right area as subtle background element
src_dots = [(920, 160), (1020, 280), (920, 400)]
unified = (1100, 280)
for sx, sy in src_dots:
    # connection line
    draw.line([(sx, sy), unified], fill=(30, 30, 40), width=2)
for sx, sy in src_dots:
    draw.ellipse([sx-10, sy-10, sx+10, sy+10], fill=(30, 35, 50), outline=(50, 55, 75), width=2)
# Unified dot — bigger, accent color
draw.ellipse([unified[0]-16, unified[1]-16, unified[0]+16, unified[1]+16], fill=accent, outline=accent)

# --- Text content (left-aligned with generous margins) ---
lx = 80
cy = 120

# "dpth.io"
title_font = get_font(72, bold=True)
draw.text((lx, cy), "dpth.io", fill=white, font=title_font)
cy += 100

# Tagline — plain English, no jargon
tag_font = get_font(34, bold=True)
draw.text((lx, cy), "Same person in Stripe and GitHub?", fill=accent, font=tag_font)
cy += 50
draw.text((lx, cy), "dpth matches them automatically.", fill=accent, font=tag_font)
cy += 65

# One-liner explanation
desc_font = get_font(20, bold=False)
draw.text((lx, cy), "Pattern detection and temporal history across all your", fill=dim, font=desc_font)
cy += 30
draw.text((lx, cy), "data sources. Pure TypeScript, zero dependencies.", fill=dim, font=desc_font)
cy += 55

# Install command
mono = get_mono(24)
cmd = "npm install dpth"
dollar_w = text_width("$ ", mono)
cmd_w = text_width(cmd, mono)
box_w = dollar_w + cmd_w + 50
box_h = 48
draw.rounded_rectangle([lx, cy, lx + box_w, cy + box_h], radius=10, fill=surface, outline=(45, 45, 55))
draw.text((lx + 25, cy + 12), "$ ", fill=dim, font=mono)
draw.text((lx + 25 + dollar_w, cy + 12), cmd, fill=green, font=mono)

# Bottom stats
stat_font = get_font(14, bold=False)
stats_y = H - 45
center_text(stats_y, "TypeScript  ·  59KB  ·  86 tests  ·  MIT license  ·  github.com/rightclickable420/dpth", stat_font, (60, 60, 70))

out = os.path.join(os.path.dirname(os.path.dirname(__file__)), "docs", "twitter-card.png")
img.save(out, "PNG", optimize=True)
print(f"Saved to {out} ({os.path.getsize(out)} bytes, {W}x{H})")
