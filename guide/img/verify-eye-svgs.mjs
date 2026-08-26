import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const specs = {
  'eye-tilt-balanced.svg':   { upper: 16, lower: 50, inner: 33, outer: 33 },
  'eye-tilt-downturned.svg': { upper: 19, lower: 53, inner: 26, outer: 46 },
  'eye-tilt-upturned.svg':   { upper: 14, lower: 48, inner: 44, outer: 18 },
  'eye-aspect-round.svg':    { upper: 11, lower: 55, inner: 33, outer: 33 },
  'eye-aspect-between.svg':  { upper: 16, lower: 50, inner: 33, outer: 33 },
  'eye-aspect-almond.svg':   { upper: 22, lower: 44, inner: 33, outer: 33 },
  'eye-cover-open.svg':      { upper: 16, lower: 50, inner: 33, outer: 33, cover: 0 },
  'eye-cover-medium.svg':    { upper: 16, lower: 50, inner: 33, outer: 33, cover: 7 },
  'eye-cover-deep.svg':      { upper: 16, lower: 50, inner: 33, outer: 33, cover: 11 },
};

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ±${tolerance}, got ${actual}`);

function parseAperture(d, file) {
  const tokens = d.match(/[MCZ]|-?(?:\d+\.?\d*|\.\d+)/gi) ?? [];
  let i = 0;
  assert.equal(tokens[i++].toUpperCase(), 'M', `${file}: aperture must start with M`);
  const start = { x: +tokens[i++], y: +tokens[i++] };
  const curves = [];
  let from = start;
  while (tokens[i]?.toUpperCase() === 'C') {
    i++;
    const values = tokens.slice(i, i + 6).map(Number);
    assert.equal(values.length, 6, `${file}: incomplete cubic segment`);
    i += 6;
    const curve = {
      from,
      c1: { x: values[0], y: values[1] },
      c2: { x: values[2], y: values[3] },
      to: { x: values[4], y: values[5] },
    };
    curves.push(curve);
    from = curve.to;
  }
  assert.equal(tokens[i++]?.toUpperCase(), 'Z', `${file}: aperture must close with Z`);
  assert.equal(i, tokens.length, `${file}: unexpected aperture tokens`);
  assert.equal(curves.length, 4, `${file}: expected four cubic segments`);
  return { start, curves, end: from };
}

function cubicPoint(curve, t) {
  const u = 1 - t;
  const coordinate = (key) => u ** 3 * curve.from[key]
    + 3 * u ** 2 * t * curve.c1[key]
    + 3 * u * t ** 2 * curve.c2[key]
    + t ** 3 * curve.to[key];
  return { x: coordinate('x'), y: coordinate('y') };
}

function assertMonotonic(curves, direction, file, lid) {
  let previous = curves[0].from.x;
  for (const curve of curves) {
    for (let step = 1; step <= 100; step++) {
      const x = cubicPoint(curve, step / 100).x;
      assert.ok(direction * (x - previous) >= -1e-7,
        `${file}: ${lid} x is not monotonic near x=${x}`);
      previous = x;
    }
  }
}

function numberAttr(tag, name, file) {
  const match = tag.match(new RegExp(`\\b${name}="([^"]+)"`));
  assert.ok(match, `${file}: circle missing ${name}`);
  return Number(match[1]);
}

for (const [file, spec] of Object.entries(specs)) {
  const svg = await readFile(new URL(file, import.meta.url), 'utf8');
  const bytes = (await stat(new URL(file, import.meta.url))).size;
  assert.ok(bytes < 20 * 1024, `${file}: ${bytes} bytes exceeds 20 KB`);

  const clipD = svg.match(/<clipPath\b[^>]*>\s*<path\b[^>]*\bd="([^"]+)"/s)?.[1];
  const outlineD = svg.match(/<path\b[^>]*\bd="([^"]+)"[^>]*\bfill="url\(#sclera_[^)]+\)"/)?.[1];
  assert.ok(clipD && outlineD, `${file}: missing clip or sclera aperture path`);
  assert.equal(clipD, outlineD, `${file}: clipPath and outline aperture differ`);

  const aperture = parseAperture(clipD, file);
  near(aperture.end.x, aperture.start.x, 0.5, `${file}: closing x`);
  near(aperture.end.y, aperture.start.y, 0.5, `${file}: closing y`);
  assertMonotonic(aperture.curves.slice(0, 2), 1, file, 'upper lid');
  assertMonotonic(aperture.curves.slice(2), -1, file, 'lower lid');

  const upperCenter = aperture.curves[0].to;
  const outer = aperture.curves[1].to;
  const lowerCenter = aperture.curves[2].to;
  near(upperCenter.x, 66, 0.5, `${file}: upper center x`);
  near(lowerCenter.x, 66, 0.5, `${file}: lower center x`);
  near(upperCenter.y, spec.upper, 1.5, `${file}: upper center y`);
  near(lowerCenter.y, spec.lower, 1.5, `${file}: lower center y`);
  near(aperture.start.y, spec.inner, 0.5, `${file}: inner-corner y`);
  near(outer.y, spec.outer, 0.5, `${file}: outer-corner y`);

  const circles = [...svg.matchAll(/<circle\b[^>]*\/>/g)].map(({ 0: tag }) => ({
    cx: numberAttr(tag, 'cx', file), cy: numberAttr(tag, 'cy', file),
    r: numberAttr(tag, 'r', file), tag,
  }));
  assert.ok(circles.length >= 4, `${file}: expected iris, pupil, and catchlights`);
  const irisRadius = Math.max(...circles.map(({ r }) => r));
  const iris = circles.find(({ r }) => r === irisRadius);
  const pupil = circles.filter(({ r }) => r < irisRadius)
    .sort((a, b) => b.r - a.r)[0];
  assert.equal(iris.cx, 66, `${file}: iris center x must be 66`);
  near(pupil.cx, iris.cx, 0, `${file}: pupil/iris center x`);
  near(pupil.cy, iris.cy, 0, `${file}: pupil/iris center y`);
  const catchlights = circles.filter(({ r }) => r < pupil.r);
  assert.ok(catchlights.length > 0, `${file}: no catchlights found`);
  for (const light of catchlights) {
    const distance = Math.hypot(light.cx - iris.cx, light.cy - iris.cy);
    assert.ok(distance <= iris.r,
      `${file}: catchlight center (${light.cx},${light.cy}) is outside iris`);
  }

  if (spec.cover !== undefined) {
    const hiddenTop = spec.upper - (iris.cy - iris.r);
    near(hiddenTop, spec.cover, spec.cover === 0 ? 0.5 : 1.5,
      `${file}: iris top cover`);
  }

  const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, `${file}: duplicate id`);
  const refs = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
  for (const ref of refs) assert.ok(ids.includes(ref), `${file}: missing local reference #${ref}`);
  assert.ok(!/\b(?:href|xlink:href)\s*=|url\((?!#)/i.test(svg), `${file}: external reference found`);

  console.log(`PASS ${file} — close, direction, geometry, iris/pupil/catchlights, refs, ${bytes} B`);
}

console.log(`PASS all ${Object.keys(specs).length} eye SVGs`);
