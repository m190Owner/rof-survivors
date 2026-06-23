#!/usr/bin/env python3
"""Normalize Kenney CC0 art into the game's sprite assets.

Reads the extracted packs from .art-src/ and writes final PNGs into assets/
(Vite publicDir), named to match ASSET_MANIFEST in src/sprites.js so
initSprites() loads them as drop-in replacements for the procedural art.

Soldiers (Top-down Shooter): top-down, rotated up->right (+x) to match the
engine's aim convention. Enemies (Monster Builder): front-view cyclops monsters
composited from parts and recolored to the crimson faction palette; rendered as
non-rotating billboards by the engine.

Run:  python tools/build_sprites.py
"""
import os, glob
from PIL import Image, ImageOps

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '.art-src')
OUT = os.path.join(ROOT, 'assets')
TDS = os.path.join(SRC, 'tds', 'PNG')
MON = os.path.join(SRC, 'monsters', 'PNG', 'Default')
os.makedirs(OUT, exist_ok=True)


def trim(img):
    bbox = img.getbbox()
    return img.crop(bbox) if bbox else img


def fit_square(img, size, pad=0.94):
    """Scale img to fit within size*pad, centered on a transparent size canvas."""
    img = trim(img)
    target = size * pad
    scale = min(target / img.width, target / img.height)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    img = img.resize((w, h), Image.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - w) // 2, (size - h) // 2), img)
    return canvas


def tint_multiply(img, rgb):
    """Multiply RGB channels by rgb (0..1 each), preserving alpha."""
    r, g, b, a = img.split()
    r = r.point(lambda v: int(v * rgb[0]))
    g = g.point(lambda v: int(v * rgb[1]))
    b = b.point(lambda v: int(v * rgb[2]))
    return Image.merge('RGBA', (r, g, b, a))


def colorize_faction(img, shadow, mid, hi):
    """Recolor by luminance ramp, preserving shape shading + alpha."""
    a = img.split()[3]
    gray = ImageOps.grayscale(img)
    rgb = ImageOps.colorize(gray, black=shadow, white=hi, mid=mid)
    rgb = rgb.convert('RGBA')
    rgb.putalpha(a)
    return rgb


def load(folder, name):
    matches = glob.glob(os.path.join(folder, name))
    if not matches:
        raise FileNotFoundError(name + ' in ' + folder)
    return Image.open(matches[0]).convert('RGBA')


# ---------------- Soldiers ----------------
# (manifest name, character folder, pose, output size, optional tint)
SOLDIERS = [
    ('char_commando',   'Soldier 1',   'soldier1_gun.png',     54, None),
    ('char_heavy',      'Survivor 1',  'survivor1_machine.png', 58, None),
    ('char_demo',       'Hitman 1',    'hitman1_silencer.png',  54, None),
    ('char_medic',      'Man Blue',    'manBlue_gun.png',       52, None),
    ('team_infantry',   'Man Brown',   'manBrown_gun.png',      40, None),
    ('team_gunner',     'Robot 1',     'robot1_machine.png',    46, None),
    ('team_sniper',     'Woman Green', 'womanGreen_silencer.png', 44, None),
    ('team_grenadier',  'Survivor 1',  'survivor1_gun.png',     44, None),
    ('team_medic',      'Man Old',     'manOld_gun.png',        40, (1.25, 1.25, 1.3)),
    ('team_sergeant',   'Soldier 1',   'soldier1_machine.png',  42, (0.78, 0.82, 0.6)),
    ('team_lieutenant', 'Hitman 1',    'hitman1_gun.png',       44, (0.85, 0.78, 0.7)),
]


def build_soldiers():
    for name, folder, pose, size, tint in SOLDIERS:
        img = load(os.path.join(TDS, folder), pose)
        # Kenney top-down characters already face +x (right) — the engine's
        # convention — so no rotation is needed.
        if tint:
            img = tint_multiply(img, tint)
        out = fit_square(img, size)
        out.save(os.path.join(OUT, name + '.png'))
        print('soldier', name, out.size)


# ---------------- Enemies (cyclops monsters) ----------------
CRIMSON = ((58, 13, 13), (142, 43, 43), (208, 90, 90))
MAGENTA = ((58, 13, 42), (155, 58, 106), (213, 111, 174))
DARK    = ((30, 6, 6),   (94, 36, 36),  (154, 64, 64))
ORANGE  = ((70, 30, 6),  (200, 96, 24), (255, 176, 80))   # volatile / explosive

# (manifest, body, eye, mouth, horn|None, palette, size, eye_scale)
ENEMIES = [
    ('enemy_swarmer', 'body_redA.png', 'eye_angry_red.png',   'mouthA.png',            None,                       CRIMSON, 28, 0.40),
    ('enemy_chaser',  'body_redB.png', 'eye_angry_red.png',   'mouth_closed_fangs.png', None,                      CRIMSON, 38, 0.42),
    ('enemy_ranged',  'body_redC.png', 'eye_psycho_light.png', 'mouthC.png',           'detail_red_horn_small.png', MAGENTA, 38, 0.40),
    ('enemy_elite',   'body_redD.png', 'eye_psycho_light.png', 'mouth_closed_teeth.png', 'detail_red_horn_large.png', MAGENTA, 54, 0.42),
    ('enemy_tank',    'body_redF.png', 'eye_angry_red.png',   'mouth_closed_teeth.png', 'detail_red_horn_large.png', DARK,    62, 0.34),
    ('enemy_boss',    'body_redE.png', 'eye_angry_red.png',   'mouth_closed_fangs.png', 'detail_red_horn_large.png', DARK,   128, 0.40),
    # M3a archetypes.
    ('enemy_bomber',   'body_redA.png', 'eye_angry_red.png',    'mouth_closed_fangs.png', None,                        ORANGE,  34, 0.46),
    ('enemy_spitter',  'body_redD.png', 'eye_psycho_light.png', 'mouthC.png',             'detail_red_horn_small.png', MAGENTA, 38, 0.42),
    ('enemy_summoner', 'body_redE.png', 'eye_psycho_light.png', 'mouth_closed_teeth.png', 'detail_red_horn_large.png', MAGENTA, 48, 0.44),
    # Boss roster (large, distinct silhouettes).
    ('boss_maw',      'body_redF.png', 'eye_angry_red.png',   'mouth_closed_teeth.png', 'detail_red_horn_large.png', DARK,   132, 0.48),
    ('boss_charger',  'body_redB.png', 'eye_angry_red.png',   'mouth_closed_fangs.png', 'detail_red_horn_large.png', CRIMSON, 122, 0.46),
    ('boss_hive',     'body_redC.png', 'eye_psycho_light.png', 'mouthC.png',            'detail_red_horn_small.png', MAGENTA, 130, 0.46),
]


def build_enemies():
    for name, body_f, eye_f, mouth_f, horn_f, pal, size, eye_scale in ENEMIES:
        body = load(MON, body_f)
        body = colorize_faction(body, *pal)
        bw, bh = body.size
        canvas = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))

        # Horns behind the body, poking out the top.
        if horn_f:
            horn = load(MON, horn_f)
            hs = (bw * 0.34) / horn.width
            horn = horn.resize((round(horn.width * hs), round(horn.height * hs)), Image.LANCZOS)
            for dx in (-0.18, 0.18):
                canvas.alpha_composite(horn, (round(bw * (0.5 + dx) - horn.width / 2),
                                              round(bh * 0.04)))

        canvas.alpha_composite(body, (0, 0))

        # Single glowing eye (cyclops), upper-center.
        eye = load(MON, eye_f)
        es = (bw * eye_scale) / eye.width
        eye = eye.resize((round(eye.width * es), round(eye.height * es)), Image.LANCZOS)
        canvas.alpha_composite(eye, (round(bw * 0.5 - eye.width / 2),
                                     round(bh * 0.34 - eye.height / 2)))

        # Mouth below the eye.
        mouth = load(MON, mouth_f)
        ms = (bw * 0.42) / mouth.width
        mouth = mouth.resize((round(mouth.width * ms), round(mouth.height * ms)), Image.LANCZOS)
        canvas.alpha_composite(mouth, (round(bw * 0.5 - mouth.width / 2),
                                       round(bh * 0.60 - mouth.height / 2)))

        out = fit_square(canvas, size)
        out.save(os.path.join(OUT, name + '.png'))
        print('enemy', name, out.size)


# ---------------- Ground texture ----------------
def build_ground():
    # One base stone tile, recolored per biome. (name, source tile, brightness, tint|None)
    from PIL import ImageEnhance
    biomes = [
        ('ground_depot',  'tile_09', 0.58, None),                # gray concrete
        ('ground_field',  'tile_17', 0.72, None),                # grass
        ('ground_desert', 'tile_09', 0.66, (1.15, 0.95, 0.65)),  # warm tan
        ('ground_marsh',  'tile_09', 0.5,  (1.1, 0.6, 0.62)),    # dark crimson
    ]
    for name, src, bright, tint in biomes:
        t = Image.open(os.path.join(TDS, 'Tiles', src + '.png')).convert('RGBA').resize((64, 64), Image.LANCZOS)
        t = ImageEnhance.Brightness(t).enhance(bright)
        if tint:
            t = tint_multiply(t, tint)
        t.save(os.path.join(OUT, name + '.png'))
        print('ground', name, t.size)
    # Back-compat alias used before biomes existed.
    Image.open(os.path.join(OUT, 'ground_depot.png')).save(os.path.join(OUT, 'ground.png'))


if __name__ == '__main__':
    build_soldiers()
    build_enemies()
    build_ground()
    print('done ->', OUT)
