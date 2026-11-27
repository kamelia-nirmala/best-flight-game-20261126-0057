// Look at the four screenshots as pixels, not as claims, and say whether each one actually shows
// what the brief asks for: a gold ring, the grey runway, the aeroplane's silhouette, enough land,
// and four frames that differ from each other.
//
// The point of this check is that a state dump can lie. The page's own debug block reported the
// aeroplane projecting to (641,501) while the frame contained only sky, sea and HUD, because the
// terrain mesh had vertices but no index list and drawElements() therefore drew nothing at all.
// Nothing but reading the pixels catches that.
//
//   node tools/pixelcheck.mjs <dir>
//
// Exit 0 when every check passes, 1 when one fails.

import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const dir = process.argv[2] ?? 'screenshots';
const LIMIT_BYTES = 262144;
const WIDTH = 1280;
const HEIGHT = 720;

// ---------------------------------------------------------------------------------------------
// Images are decoded with Pillow through python3: writing a JPEG decoder is not the job here, and
// Pillow is present on this machine. The tool refuses to guess — an image it cannot decode fails.
// ---------------------------------------------------------------------------------------------

function decode(path) {
  const script = `
import sys, json
from PIL import Image
im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
sys.stdout.write(json.dumps({"w": w, "h": h, "data": list(im.tobytes())}))
`;
  const out = spawnSync('python3', ['-c', script, path], { encoding: 'utf8', maxBuffer: 1 << 29 });
  if (out.status !== 0) return null;
  try {
    const parsed = JSON.parse(out.stdout);
    return { w: parsed.w, h: parsed.h, data: Uint8Array.from(parsed.data) };
  } catch {
    return null;
  }
}

function pixel(img, x, y) {
  const i = (y * img.w + x) * 3;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

/**
 * The 3D view only. The HUD owns the top ribbon (to y ~114), the speed and altitude tapes at the
 * left and right edges (x ~49..143 and ~1137..1231) and the bottom leg bar (from y ~676). Those
 * bands are full of HUD amber (#ffb347), which is within a few units of the ring gold, and of
 * panel darks that look exactly like asphalt. Measuring the whole frame therefore counts the
 * instrument panel as scenery; every predicate below is applied inside this window instead.
 */
const VIEW = { x0: 170, x1: 1110, y0: 130, y1: 660 };

/**
 * Ring gold is (255,179,71) in the ring's own colour and the drop circle is painted the same. The
 * warm horizon sky is (241,168,115), so the `g - b > 55` bar keeps the sky out, and the `r - g >
 * 35` bar keeps the pale sand out.
 */
function isGold(r, g, b) {
  return r > 200 && g > 130 && g < 220 && b < 130 && g - b > 55 && r - g > 35;
}

/** The aeroplane's cream paint: bright, warm, and lighter than any terrain in the scene. */
function isHull(r, g, b) {
  return r > 168 && g > 152 && b > 132 && r - b > 10 && r - b < 70 && b >= g - 30;
}

/**
 * Land: the island's rock and moss. The sea is blue-lead and the sky is either blue-violet above
 * or a bright warm cream at the horizon, so land is what is neither: blue clearly behind green and
 * not bright. Measured, not assumed — the four old frames score 0.5-9.2% and the new ones 12-44%.
 */
function isLand(r, g, b) {
  if (isGold(r, g, b) || isHull(r, g, b)) return false;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return b < g - 8 && lum < 132;
}

/** Asphalt: dark and nearly neutral, with blue not trailing. */
function isRunwayGrey(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max < 78 && max > 10 && max - min < 18 && b >= g - 4;
}

/**
 * The largest connected component of a mask, as { n, w, h }. This is what separates a ring from
 * HUD furniture: a gate is a closed hoop with extent in both directions, while the amber chrome
 * that survives the colour test is thin horizontal rules — the old frames' biggest "gold" blobs
 * were 290x6, 254x0 and 244x8 pixels. A real gate scores 54x177 and up.
 */
function biggestBlob(mask) {
  const h = mask.length;
  const w = h ? mask[0].length : 0;
  const seen = Array.from({ length: h }, () => new Uint8Array(w));
  let best = { n: 0, w: 0, h: 0 };
  for (let j = 0; j < h; j += 1) {
    for (let i = 0; i < w; i += 1) {
      if (!mask[j][i] || seen[j][i]) continue;
      const stack = [[j, i]];
      seen[j][i] = 1;
      let n = 0;
      let minX = i;
      let maxX = i;
      let minY = j;
      let maxY = j;
      while (stack.length) {
        const [cj, ci] = stack.pop();
        n += 1;
        if (ci < minX) minX = ci;
        if (ci > maxX) maxX = ci;
        if (cj < minY) minY = cj;
        if (cj > maxY) maxY = cj;
        for (const [dj, di] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nj = cj + dj;
          const ni = ci + di;
          if (nj >= 0 && nj < h && ni >= 0 && ni < w && mask[nj][ni] && !seen[nj][ni]) {
            seen[nj][ni] = 1;
            stack.push([nj, ni]);
          }
        }
      }
      if (n > best.n) best = { n, w: maxX - minX + 1, h: maxY - minY + 1 };
    }
  }
  return best;
}

/** Walk the view window once, counting each predicate and keeping the gold and grey masks. */
function survey(img, step = 2) {
  const goldMask = [];
  const greyMask = [];
  let gold = 0;
  let land = 0;
  let hull = 0;
  let grey = 0;
  let total = 0;
  for (let y = VIEW.y0; y < VIEW.y1; y += step) {
    const gRow = [];
    const rRow = [];
    for (let x = VIEW.x0; x < VIEW.x1; x += step) {
      const [r, g, b] = pixel(img, x, y);
      total += 1;
      const gd = isGold(r, g, b);
      if (gd) gold += 1;
      gRow.push(gd);
      if (isHull(r, g, b)) hull += 1;
      if (isLand(r, g, b)) land += 1;
      const rd = isRunwayGrey(r, g, b);
      if (rd) grey += 1;
      rRow.push(rd);
    }
    goldMask.push(gRow);
    greyMask.push(rRow);
  }
  return {
    gold,
    land,
    hull,
    grey,
    total,
    landPct: (100 * land) / total,
    goldBlob: biggestBlob(goldMask),
    greyBlob: biggestBlob(greyMask),
  };
}

// ---------------------------------------------------------------------------------------------

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
}

if (!existsSync(dir)) {
  console.log(`pixelcheck: ${dir} does not exist`);
  process.exit(1);
}

const files = (await readdir(dir)).filter((f) => /\.(jpg|jpeg|png)$/i.test(f)).sort();
const wanted = ['1-cover.jpg', '2-cockpit.jpg', '3-mail.jpg', '4-landing.jpg'];

check('four screenshots present', files.length === 4, `${files.length} image(s): ${files.join(', ')}`);
for (const name of wanted) {
  check(`file ${name} exists`, files.includes(name), files.includes(name) ? 'present' : `missing; have ${files.join(', ')}`);
}

const images = new Map();
for (const f of files) {
  const path = join(dir, f);
  const size = (await readFile(path)).length;
  const img = decode(path);
  if (!img) {
    check(`${f} decodes`, false, 'could not decode');
    continue;
  }
  images.set(f, img);
  check(`${f} under 256 KiB`, size < LIMIT_BYTES, `${size} B`);
  check(`${f} is 1280x720`, img.w === WIDTH && img.h === HEIGHT, `${img.w}x${img.h}`);
  check(
    `${f} long side <= 1280 and short side >= 480`,
    Math.max(img.w, img.h) <= 1280 && Math.min(img.w, img.h) >= 480,
    `long ${Math.max(img.w, img.h)}, short ${Math.min(img.w, img.h)}`,
  );
}

// What each shot is a picture of. The brief wants the island, the smoking volcano, the runway, the
// gold rings, the mail drop circle and the aeroplane across the set; each frame is checked against
// the subject it is named for rather than every element being demanded of every frame.
const SUBJECTS = {
  '1-cover.jpg': { gold: 'a gold ring', runway: false },
  '2-cockpit.jpg': { gold: 'a gold ring ahead through the windscreen', runway: false },
  '3-mail.jpg': { gold: 'the gold mail drop circle', runway: false },
  '4-landing.jpg': { gold: null, runway: true },
};

for (const [f, img] of images) {
  const s = survey(img);
  const subject = SUBJECTS[f] ?? { gold: 'a gold ring', runway: false };
  const detail = `gold ${s.gold} px (blob ${s.goldBlob.n} at ${s.goldBlob.w}x${s.goldBlob.h}), land ${s.landPct.toFixed(1)}%, hull ${s.hull} px, grey ${s.grey} px (blob ${s.greyBlob.n} at ${s.greyBlob.w}x${s.greyBlob.h})`;

  // A gate or the painted drop circle is hundreds of gold pixels with extent in both directions.
  // HUD chrome that passes the colour test is a thin rule, so the shape test is what bites.
  if (subject.gold) {
    const shaped = s.goldBlob.w >= 24 && s.goldBlob.h >= 16;
    check(`${f} shows ${subject.gold}`, s.goldBlob.n >= 150 && shaped, detail);
  }

  check(`${f} shows land`, s.landPct >= 11, `${s.landPct.toFixed(1)}% of the view is island`);

  // The aeroplane itself: the chase and mail shots frame it, and the cockpit shot looks over its
  // own cowling, so a good part of the airframe is in the lower frame.
  check(`${f} shows the aeroplane`, s.hull >= 60, `${s.hull} cream-hull px`);

  if (subject.runway) {
    // The strip is a long dark band: wide, and much wider than it is tall. The old result card's
    // dark overlay covered the whole frame (75632 px, no band shape) and must not pass for a strip.
    const band = s.greyBlob.n >= 1200 && s.greyBlob.w >= 100 && s.greyBlob.w > s.greyBlob.h * 1.5;
    check(`${f} shows the runway`, band, detail);
  }
}

// The four frames must be different frames, not one frame four times.
if (images.size >= 2) {
  const entries = [...images.entries()];
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [fa, a] = entries[i];
      const [fb, b] = entries[j];
      let diff = 0;
      let n = 0;
      for (let y = 0; y < Math.min(a.h, b.h); y += 4) {
        for (let x = 0; x < Math.min(a.w, b.w); x += 4) {
          const pa = pixel(a, x, y);
          const pb = pixel(b, x, y);
          const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
          if (d > 24) diff += 1;
          n += 1;
        }
      }
      const pct = (100 * diff) / n;
      check(`${fa} differs from ${fb}`, pct >= 12, `${pct.toFixed(1)}% of sampled pixels differ`);
    }
  }
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`pixelcheck: ${checks.length - failed}/${checks.length} passed on ${dir}`);
for (const c of checks) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}: ${c.detail}`);
process.exit(failed === 0 ? 0 : 1);
