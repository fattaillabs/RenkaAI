/*
 * Renka 랜딩 모션 (2026-09-29) — 외부 라이브러리 없이 Canvas·CSS 로만.
 *
 * 전부 점진적 향상이다. 이 파일이 안 불리거나 메쉬 JSON 을 못 받아도 기존 페이지(사진·SVG·텍스트)가
 * 그대로 보인다. 텍스트는 전부 HTML 에 있어 크롤러(네이버·LLM 봇)가 읽는 내용은 바뀌지 않는다.
 *
 *  1. 히어로  — 사진 위에 실제 얼굴 메쉬(MediaPipe 468점 + 변 중점 = 앱과 같은 1,220점)가 짜여 들어오고
 *               앱과 같은 색(0x66CC66)으로 맥동, 스캔바(0x00FF4D)가 지나가는 변을 밝힌다.
 *  2. 여정    — 스크롤로 스캔 → 비율 → 대칭 → 붓기 네 장면. 수치는 사진의 랜드마크로 실제 계산한다.
 *  3. 개인정보 — 데이터 점들이 폰 실루엣 밖으로 못 나가고 튕겨 들어온다.
 *  4. CTA     — 스크롤에 따라 그라데이션이 흐른다.
 *  5. 기타    — 히어로 칩 숫자 카운트업, 포인터 기울기, 모바일 언어 메뉴.
 *
 * 메쉬 데이터: assets/mesh/hero.json — 히어로 사진 두 장(asia/en)에서 MediaPipe 로 뽑았다.
 * 사진을 바꾸면 JSON 도 다시 뽑아야 한다(정렬이 어긋난다).
 */
(function () {
  'use strict';

  var RM = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var SCRIPT = document.currentScript;
  var MESH_URL = new URL('../mesh/hero.json', SCRIPT ? SCRIPT.src : location.href).href;

  var GREEN = '102,204,102';      // 앱 메쉬 0x66CC66
  var SCAN = '0,255,77';          // 앱 스캔바 0x00FF4D
  var POINT = '181,232,163';      // 기존 SVG 점 색 #B5E8A3

  function clamp(v, a, b) { return v < (a || 0) ? (a || 0) : v > (b === undefined ? 1 : b) ? (b === undefined ? 1 : b) : v; }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }

  // ── 메쉬 데이터 ───────────────────────────────────────────
  var mesh = null, waiters = [];
  function onMesh(fn) { if (mesh) fn(mesh); else waiters.push(fn); }
  fetch(MESH_URL).then(function (r) { return r.json(); }).then(function (d) {
    prepare(d); mesh = d; waiters.forEach(function (f) { f(d); }); waiters = [];
  }).catch(function (e) { if (window.console) console.warn('[renka-motion] mesh', e); /* 메쉬 없음 → 기존 SVG 오버레이 그대로 */ });

  // 앱은 1,220점이다. 468 정점 + 앞쪽 752개 변의 중점 = 1,220 — mesh_fx.py 의 "중점 세분화"와 같은 발상.
  function prepare(d) {
    var e = d.edges, n = e.length / 2;
    d.nEdges = n;
    d.mids = [];
    for (var i = 0; i < Math.min(752, n); i++) d.mids.push([e[i * 2], e[i * 2 + 1]]);
    Object.keys(d.faces).forEach(function (k) {
      var f = d.faces[k], p = f.p, minx = 1, maxx = 0, miny = 1, maxy = 0;
      for (var i = 0; i < p.length; i += 3) {
        if (p[i] < minx) minx = p[i]; if (p[i] > maxx) maxx = p[i];
        if (p[i + 1] < miny) miny = p[i + 1]; if (p[i + 1] > maxy) maxy = p[i + 1];
      }
      f.box = { x0: minx, x1: maxx, y0: miny, y1: maxy };
    });
  }
  function faceKeyFor(img) { return /-en\.jpg/.test(img.currentSrc || img.src) ? 'en' : 'asia'; }

  // ── 공용: 캔버스 크기 맞추기, 화면에 보일 때만 돌리기 ──────────────
  function fit(canvas) {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * DPR)), h = Math.max(1, Math.round(r.height * DPR));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: w, h: h };
  }
  function loopWhenVisible(el, frame) {
    var running = false, raf = 0, visible = false;
    function tick(now) { if (!running) return; frame(now); raf = requestAnimationFrame(tick); }
    function sync() {
      var want = visible && !document.hidden;
      if (want && !running) { running = true; raf = requestAnimationFrame(tick); }
      if (!want && running) { running = false; cancelAnimationFrame(raf); }
    }
    new IntersectionObserver(function (es) { visible = es[0].isIntersecting; sync(); }, { rootMargin: '120px' }).observe(el);
    document.addEventListener('visibilitychange', sync);
  }

  // 정규화 좌표 → 캔버스 좌표. map = {W,H,s,ox,oy} (이미지 픽셀 → 캔버스 픽셀)
  function P(face, map, i) {
    var p = face.p;
    return [p[i * 3] * map.W * map.s + map.ox, p[i * 3 + 1] * map.H * map.s + map.oy];
  }

  // 메쉬 그리기: 변(한 경로로 한 번에) + 점(정점 + 중점).
  // reveal 0→1: 코끝에서 가까운 점부터 나타나고, 변은 뒤따라 짜여 들어온다.
  function drawMesh(ctx, face, map, reveal, lineAlpha, pointAlpha, scanY, scanBand) {
    var e = mesh.edges, n = mesh.nEdges, i, a, b;
    var nose = P(face, map, 1), far = (face.box.y1 - face.box.y0) * map.H * map.s * 0.75;

    if (lineAlpha > 0) {
      ctx.lineWidth = Math.max(0.6, 0.55 * DPR);
      ctx.strokeStyle = 'rgba(' + GREEN + ',' + lineAlpha.toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i < n; i++) {
        a = P(face, map, e[i * 2]); b = P(face, map, e[i * 2 + 1]);
        if (reveal < 1) {
          var d = Math.hypot((a[0] + b[0]) / 2 - nose[0], (a[1] + b[1]) / 2 - nose[1]) / far;
          if (d > reveal * 1.35 - 0.2) continue;
        }
        ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      }
      ctx.stroke();
      // 스캔바가 지나가는 줄의 변만 한 번 더 밝게 — 앱의 스캔 느낌
      if (scanY !== null && scanY !== undefined) {
        ctx.strokeStyle = 'rgba(' + SCAN + ',0.55)';
        ctx.lineWidth = Math.max(0.8, 0.8 * DPR);
        ctx.beginPath();
        for (i = 0; i < n; i++) {
          a = P(face, map, e[i * 2]); b = P(face, map, e[i * 2 + 1]);
          var my = (a[1] + b[1]) / 2;
          if (Math.abs(my - scanY) > scanBand) continue;
          ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
        }
        ctx.stroke();
      }
    }
    if (pointAlpha > 0) {
      var r = Math.max(0.9, 0.95 * DPR);
      ctx.fillStyle = 'rgba(' + POINT + ',' + pointAlpha.toFixed(3) + ')';
      ctx.beginPath();
      for (i = 0; i < 468; i++) {
        a = P(face, map, i);
        if (reveal < 1 && Math.hypot(a[0] - nose[0], a[1] - nose[1]) / far > reveal * 1.35) continue;
        ctx.moveTo(a[0] + r, a[1]); ctx.arc(a[0], a[1], r, 0, 6.2832);
      }
      for (i = 0; i < mesh.mids.length; i++) {
        a = P(face, map, mesh.mids[i][0]); b = P(face, map, mesh.mids[i][1]);
        var mx = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
        if (reveal < 1 && Math.hypot(mx - nose[0], my2 - nose[1]) / far > reveal * 1.35 - 0.1) continue;
        ctx.moveTo(mx + r * 0.7, my2); ctx.arc(mx, my2, r * 0.7, 0, 6.2832);
      }
      ctx.fill();
    }
  }

  // ── 1. 히어로 메쉬 ─────────────────────────────────────────
  function initHero() {
    var img = document.getElementById('heroPhoto');
    var screen = img && img.closest('.phone-screen');
    if (!screen) return;
    var canvas = document.createElement('canvas');
    canvas.className = 'mesh-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    img.insertAdjacentElement('afterend', canvas);
    var ctx = canvas.getContext('2d');
    var t0 = 0;

    function ready() { return mesh && img.complete && img.naturalWidth; }
    function frame(now) {
      if (!ready()) return;
      if (!t0) { t0 = now; screen.classList.add('mesh-on'); }
      var size = fit(canvas), face = mesh.faces[faceKeyFor(img)];
      var W = img.naturalWidth, H = img.naturalHeight, s = Math.max(size.w / W, size.h / H);
      var map = { W: W, H: H, s: s, ox: (size.w - W * s) / 2, oy: (size.h - H * s) / 2 };
      ctx.clearRect(0, 0, size.w, size.h);

      var intro = RM ? 1 : clamp((now - t0) / 2400);
      var pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin((now - t0) / 4000 * 6.2832);   // 앱 4초 맥동
      var top = face.box.y0 * H * s + map.oy, bot = face.box.y1 * H * s + map.oy;
      var scanY = null, band = (bot - top) * 0.05;
      if (!RM && intro >= 1) {
        var ph = ((now - t0 - 2400) / 3600) % 1;                            // 3.6초 왕복
        scanY = top + (0.5 - 0.5 * Math.cos(ph * 6.2832)) * (bot - top);
        var g = ctx.createLinearGradient(0, scanY - band * 2.4, 0, scanY + band * 2.4);
        g.addColorStop(0, 'rgba(134,201,114,0)'); g.addColorStop(0.5, 'rgba(134,201,114,0.20)'); g.addColorStop(1, 'rgba(134,201,114,0)');
        ctx.fillStyle = g; ctx.fillRect(size.w * 0.06, scanY - band * 2.4, size.w * 0.88, band * 4.8);
      }
      drawMesh(ctx, face, map, ease(intro), (0.22 + 0.14 * pulse) * clamp(intro * 1.6 - 0.3),
               0.55 + 0.25 * pulse, scanY, band);
      if (RM && intro >= 1) return 'done';
    }
    onMesh(function () {
      if (RM) { var once = function () { if (ready()) frame(performance.now()); else img.addEventListener('load', once, { once: true }); }; once(); return; }
      loopWhenVisible(screen, frame);
    });
    img.addEventListener('load', function () { t0 = 0; });   // 언어 전환으로 사진이 바뀌면 다시 짜여 들어온다
    window.addEventListener('resize', function () { if (RM && ready()) frame(performance.now()); });
  }

  // ── 2. 스크롤 여정 ─────────────────────────────────────────
  function initJourney() {
    var sec = document.querySelector('.journey');
    if (!sec) return;
    var stage = sec.querySelector('.stage'), img = stage.querySelector('img');
    var stepsWrap = sec.querySelector('.journey-steps'), steps = [].slice.call(sec.querySelectorAll('.jstep'));
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    stage.appendChild(canvas);
    var ctx = canvas.getContext('2d');
    var cur = 0, target = 0, active = -1, t0 = 0;

    function measure() {
      var r = stepsWrap.getBoundingClientRect();
      var anchor = innerHeight * (innerWidth < 860 ? 0.8 : 0.55);
      target = clamp((anchor - r.top) / r.height) * steps.length;
    }
    function setActive(i) {
      if (i === active) return; active = i;
      steps.forEach(function (s, k) { s.classList.toggle('active', k === i); });
      stage.setAttribute('data-step', i);
    }

    function frame(now) {
      if (!mesh || !img.complete || !img.naturalWidth) return;
      if (!t0) { t0 = now; stage.classList.add('live'); }
      measure();
      cur += RM ? (target - cur) : (target - cur) * 0.12;
      setActive(Math.min(steps.length - 1, Math.floor(cur + 0.0001)));
      var size = fit(canvas), face = mesh.faces[faceKeyFor(img)], W = img.naturalWidth, H = img.naturalHeight;

      // 사진은 캔버스가 직접 그린다 — 얼굴 상자를 기준으로 잘라 무대(4:5)를 채운다(오버레이와 좌표가 정확히 같게)
      var b = face.box, fh = (b.y1 - b.y0) * H, cy = (b.y0 + b.y1) / 2 * H + fh * 0.04;
      var sh = Math.min(H, fh * 1.62), sw = sh * size.w / size.h;
      if (sw > W) { sw = W; sh = sw * size.h / size.w; }
      var sx = clamp((b.x0 + b.x1) / 2 * W - sw / 2, 0, W - sw), sy = clamp(cy - sh / 2, 0, H - sh);
      var s = size.w / sw, map = { W: W, H: H, s: s, ox: -sx * s, oy: -sy * s };
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size.w, size.h);
      var shade = ctx.createLinearGradient(0, 0, 0, size.h);
      shade.addColorStop(0, 'rgba(10,14,11,0.10)'); shade.addColorStop(1, 'rgba(10,14,11,0.38)');
      ctx.fillStyle = shade; ctx.fillRect(0, 0, size.w, size.h);

      // 각 장면은 자기 단계의 앞 40% 안에 완성되고, 다음 단계가 시작되면 빠르게 물러난다
      var p0 = clamp(cur * 2.5), p1 = clamp((cur - 1) * 2.5), p2 = clamp((cur - 2) * 2.5), p3 = clamp((cur - 3) * 2.5);
      var out1 = 1 - clamp((cur - 2) * 3) * 0.85, out2 = 1 - clamp((cur - 3) * 3) * 0.85;
      var later = clamp((cur - 1) * 2);                             // 다음 장면부터 메쉬는 옅게 뒤로
      var pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin((now - t0) / 4000 * 6.2832);
      if (p3 > 0) drawHeatMesh(ctx, face, map, ease(p3), (0.30 + 0.12 * pulse) * (1 - later * 0.62));
      else drawMesh(ctx, face, map, ease(p0), (0.36 + 0.14 * pulse) * (1 - later * 0.62), (0.8 - later * 0.6) * p0, null, 0);

      var fw = Math.hypot(P(face, map, 454)[0] - P(face, map, 234)[0], P(face, map, 454)[1] - P(face, map, 234)[1]);
      var font = Math.round(Math.max(10, Math.min(14, fw / DPR / 22)) * DPR);   // CSS 10~14px 를 캔버스 배율로
      ctx.font = '700 ' + font + 'px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      if (p1 > 0 && out1 > 0.2) drawProportion(ctx, face, map, ease(p1) * out1, fw, font);
      if (p2 > 0 && out2 > 0.2) drawSymmetry(ctx, face, map, ease(p2) * out2, fw, font);
      if (p3 > 0) drawPuffiness(ctx, face, map, ease(p3), fw);
      if (RM) return 'done';
    }

    function line(ctx, a, b, t) { ctx.moveTo(a[0], a[1]); ctx.lineTo(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); }
    function pill(ctx, text, x, y, alpha, color) {
      var w = ctx.measureText(text).width + 14 * DPR, h = 20 * DPR;
      ctx.fillStyle = 'rgba(10,14,11,' + (0.62 * alpha).toFixed(3) + ')';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - w / 2, y - h / 2, w, h, h / 2) : ctx.rect(x - w / 2, y - h / 2, w, h); ctx.fill();
      ctx.fillStyle = 'rgba(' + (color || '230,244,222') + ',' + alpha.toFixed(3) + ')';
      ctx.textAlign = 'center'; ctx.fillText(text, x, y + 0.5);
    }
    function avgY(face, map, ids) { var y = 0; ids.forEach(function (i) { y += P(face, map, i)[1]; }); return y / ids.length; }

    // 비율: 가로 5등분(얼굴 가장자리·눈꼬리·눈머리) + 중안부:하안부. 사진 랜드마크로 실제 계산한다.
    function drawProportion(ctx, face, map, t, fw, font) {
      var xs = [234, 33, 133, 362, 263, 454].map(function (i) { return P(face, map, i)[0]; });
      var yBrow = avgY(face, map, [107, 336]), yNose = P(face, map, 2)[1], yChin = P(face, map, 152)[1];
      var x0 = xs[0] - fw * 0.06, x1 = xs[5] + fw * 0.06;
      ctx.lineWidth = 1.2 * DPR; ctx.setLineDash([5 * DPR, 4 * DPR]);
      ctx.strokeStyle = 'rgba(232,201,62,' + (0.9 * t).toFixed(3) + ')';            // 앱 하악각 노랑
      ctx.beginPath();
      [yBrow, yNose, yChin].forEach(function (y) { var c = (x0 + x1) / 2; line(ctx, [c, y], [x0, y], t); line(ctx, [c, y], [x1, y], t); });
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,' + (0.7 * t).toFixed(3) + ')';
      ctx.beginPath();
      xs.forEach(function (x) { line(ctx, [x, yBrow - fw * 0.05], [x, yChin], t); });
      ctx.stroke(); ctx.setLineDash([]);
      if (t < 0.6) return;
      var la = clamp((t - 0.6) / 0.4), eye = (xs[2] - xs[1] + xs[4] - xs[3]) / 2;
      var fifths = [xs[1] - xs[0], xs[2] - xs[1], xs[3] - xs[2], xs[4] - xs[3], xs[5] - xs[4]].map(function (v) { return (v / eye).toFixed(1); });
      pill(ctx, fifths.join(' · '), (xs[0] + xs[5]) / 2, yBrow - fw * 0.16, la);
      var mid = yNose - yBrow, low = yChin - yNose;
      pill(ctx, '1 : ' + (low / mid).toFixed(2), x1 - fw * 0.02, (yNose + yChin) / 2, la, '232,201,62');
    }

    // 대칭: 정중선 + 좌우 짝(눈꼬리·눈머리·입꼬리·광대·턱). 정중선까지 거리 차를 mm 로(얼굴 폭 ≈ 138mm 가정 환산).
    function drawSymmetry(ctx, face, map, t, fw, font) {
      var top = P(face, map, 10), chin = P(face, map, 152), mid = P(face, map, 168);
      var dx = chin[0] - mid[0], dy = chin[1] - mid[1], len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
      function distToMid(pt) { var vx = pt[0] - mid[0], vy = pt[1] - mid[1]; return Math.abs(vx * uy - vy * ux); }
      ctx.lineWidth = 1.4 * DPR;
      ctx.strokeStyle = 'rgba(42,199,189,' + (0.95 * t).toFixed(3) + ')';          // 앱 턱선 틸
      ctx.beginPath(); line(ctx, [top[0] - ux * fw * 0.1, top[1] - uy * fw * 0.1], [chin[0] + ux * fw * 0.08, chin[1] + uy * fw * 0.08], t); ctx.stroke();
      var pairs = [[33, 263], [133, 362], [61, 291], [234, 454], [172, 397]];
      var mmPerPx = 138 / fw, worst = 0;
      ctx.strokeStyle = 'rgba(224,102,172,' + (0.85 * t).toFixed(3) + ')';          // 앱 캘리퍼 마젠타
      ctx.beginPath();
      pairs.forEach(function (pr) {
        var a = P(face, map, pr[0]), b = P(face, map, pr[1]);
        line(ctx, a, b, t);
        worst = Math.max(worst, Math.abs(distToMid(a) - distToMid(b)) * mmPerPx);
      });
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,' + (0.9 * t).toFixed(3) + ')';
      pairs.forEach(function (pr) { [pr[0], pr[1]].forEach(function (i) { var q = P(face, map, i); ctx.beginPath(); ctx.arc(q[0], q[1], 2.2 * DPR, 0, 6.2832); ctx.fill(); }); });
      if (t < 0.6) return;
      pill(ctx, '± ' + worst.toFixed(1) + ' mm', chin[0], chin[1] + fw * 0.14, clamp((t - 0.6) / 0.4), '42,199,189');
    }

    // 붓기 부위(랜드마크, 세기): 눈 밑이 가장 붓고 볼·턱선은 덜 — 앱 히트맵 표현(초록→노랑→주황)
    var HEAT_SPOTS = [[230, 1.0], [450, 0.85], [50, 0.6], [280, 0.7], [205, 0.35], [425, 0.35]];
    function heatAt(face, map, x, y, fw) {
      var h = 0;
      for (var k = 0; k < HEAT_SPOTS.length; k++) {
        var q = P(face, map, HEAT_SPOTS[k][0]), d = Math.hypot(x - q[0], y - q[1]) / (fw * 0.16);
        h = Math.max(h, HEAT_SPOTS[k][1] * Math.exp(-d * d));
      }
      return h;
    }
    function drawHeatMesh(ctx, face, map, t, baseAlpha) {
      var e = mesh.edges, n = mesh.nEdges, fw = Math.hypot(P(face, map, 454)[0] - P(face, map, 234)[0], P(face, map, 454)[1] - P(face, map, 234)[1]);
      var buckets = [[], [], []];                                    // 0 초록 / 1 노랑 / 2 주황
      for (var i = 0; i < n; i++) {
        var a = P(face, map, e[i * 2]), b = P(face, map, e[i * 2 + 1]);
        var h = heatAt(face, map, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, fw) * t;
        buckets[h > 0.55 ? 2 : h > 0.25 ? 1 : 0].push(a, b);
      }
      var cols = [[GREEN, baseAlpha], ['232,201,62', 0.75 * t], ['240,122,62', 0.9 * t]];
      for (var c = 0; c < 3; c++) {
        var list = buckets[c]; if (!list.length) continue;
        ctx.strokeStyle = 'rgba(' + cols[c][0] + ',' + cols[c][1].toFixed(3) + ')';
        ctx.lineWidth = (c ? 1.1 : 0.6) * DPR;
        ctx.beginPath();
        for (var j = 0; j < list.length; j += 2) { ctx.moveTo(list[j][0], list[j][1]); ctx.lineTo(list[j + 1][0], list[j + 1][1]); }
        ctx.stroke();
      }
    }
    function drawPuffiness(ctx, face, map, t, fw) {
      var spots = [[230, 0.55, '240,154,62'], [450, 0.45, '232,201,62'], [50, 0.35, '232,201,62'], [280, 0.40, '240,154,62'],
                   [205, 0.25, '134,201,114'], [425, 0.25, '134,201,114'], [152, 0.2, '134,201,114']];
      spots.forEach(function (sp, k) {
        var q = P(face, map, sp[0]), r = fw * (0.13 + (k < 2 ? 0.02 : 0)), a = sp[1] * t * 0.4;
        var g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], r);
        g.addColorStop(0, 'rgba(' + sp[2] + ',' + a.toFixed(3) + ')'); g.addColorStop(1, 'rgba(' + sp[2] + ',0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 6.2832); ctx.fill();
      });
    }

    onMesh(function () {
      if (RM) {
        var draw = function () { if (img.complete && img.naturalWidth) frame(performance.now()); };
        img.complete ? draw() : img.addEventListener('load', draw, { once: true });
        addEventListener('scroll', draw, { passive: true }); addEventListener('resize', draw);
        return;
      }
      loopWhenVisible(sec, frame);
    });
  }

  // ── 3. 개인정보: 폰 안에서만 도는 점들 ─────────────────────────
  function initPrivacy() {
    var slot = document.querySelector('.privacy-band .lock');
    if (!slot || RM) return;
    var canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    slot.classList.add('live'); slot.appendChild(canvas);
    var ctx = canvas.getContext('2d'), dots = [], hits = [], last = 0;
    for (var i = 0; i < 16; i++) dots.push({ x: Math.random(), y: Math.random(), vx: (Math.random() - 0.5) * 0.35, vy: (Math.random() - 0.5) * 0.35 });
    loopWhenVisible(slot, function (now) {
      var size = fit(canvas), w = size.w, h = size.h, dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016; last = now;
      ctx.clearRect(0, 0, w, h);
      var pw = w * 0.52, ph = h * 0.82, px = (w - pw) / 2, py = (h - ph) / 2, rr = pw * 0.2;
      ctx.lineWidth = 2 * DPR; ctx.strokeStyle = 'rgba(62,127,56,0.85)';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px, py, pw, ph, rr) : ctx.rect(px, py, pw, ph); ctx.stroke();
      var ix = px + 5 * DPR, iy = py + 7 * DPR, iw = pw - 10 * DPR, ih = ph - 14 * DPR;
      dots.forEach(function (d) {
        d.x += d.vx * dt; d.y += d.vy * dt;
        if (d.x < 0 || d.x > 1) { d.vx = -d.vx; d.x = clamp(d.x); hits.push({ x: d.x, y: d.y, t: now }); }
        if (d.y < 0 || d.y > 1) { d.vy = -d.vy; d.y = clamp(d.y); hits.push({ x: d.x, y: d.y, t: now }); }
        ctx.fillStyle = 'rgba(89,162,78,0.9)';
        ctx.beginPath(); ctx.arc(ix + d.x * iw, iy + d.y * ih, 1.9 * DPR, 0, 6.2832); ctx.fill();
      });
      hits = hits.filter(function (hh) { return now - hh.t < 600; });
      hits.forEach(function (hh) {       // 벽에 닿은 자리에 짧은 파문 — "밖으로 안 나간다"
        var k = (now - hh.t) / 600;
        ctx.strokeStyle = 'rgba(134,201,114,' + (0.7 * (1 - k)).toFixed(3) + ')'; ctx.lineWidth = 1.2 * DPR;
        ctx.beginPath(); ctx.arc(ix + hh.x * iw, iy + hh.y * ih, (2 + 7 * k) * DPR, 0, 6.2832); ctx.stroke();
      });
    });
  }

  // ── 4. CTA 그라데이션: 스크롤에 따라 흐른다 ────────────────────
  function initCta() {
    var cta = document.querySelector('.cta-inner');
    if (!cta || RM) return;
    var on = false;
    new IntersectionObserver(function (es) { on = es[0].isIntersecting; if (on) upd(); }).observe(cta);
    function upd() {
      if (!on) return;
      var r = cta.getBoundingClientRect(), p = clamp((innerHeight - r.top) / (innerHeight + r.height));
      cta.style.setProperty('--p', p.toFixed(3));
    }
    addEventListener('scroll', function () { requestAnimationFrame(upd); }, { passive: true });
  }

  // ── 5. 히어로 칩 카운트업 · 포인터 기울기 · 기능 행 수치 ───────────
  function initTickers() {
    if (RM) return;
    [].slice.call(document.querySelectorAll('.chip .v, [data-tick]')).forEach(function (el, k) {
      var node = el.firstChild;
      if (!node || node.nodeType !== 3) return;
      var m = node.nodeValue.match(/^(\s*)(\d+(?:\.\d+)?)/);
      if (!m) return;
      var to = parseFloat(m[2]), dec = (m[2].split('.')[1] || '').length, rest = node.nodeValue.slice(m[0].length);
      var run = function () {
        var t0 = performance.now(), dur = 1300 + k * 150;
        (function step(now) {
          var t = ease(clamp((now - t0) / dur));
          node.nodeValue = m[1] + (to * t).toFixed(dec) + rest;
          if (t < 1) requestAnimationFrame(step);
        })(t0);
      };
      new IntersectionObserver(function (es, io) { if (es[0].isIntersecting) { io.disconnect(); run(); } }).observe(el);
    });
  }
  function initTilt() {
    var hero = document.querySelector('.hero'), vis = document.querySelector('.hero-visual');
    if (!hero || !vis || RM || !(window.matchMedia && matchMedia('(hover: hover) and (pointer: fine)').matches)) return;
    hero.addEventListener('pointermove', function (e) {
      var r = vis.getBoundingClientRect(), x = (e.clientX - (r.left + r.width / 2)) / innerWidth, y = (e.clientY - (r.top + r.height / 2)) / innerHeight;
      vis.style.setProperty('--ry', (x * 10).toFixed(2) + 'deg'); vis.style.setProperty('--rx', (-y * 8).toFixed(2) + 'deg');
    });
    hero.addEventListener('pointerleave', function () { vis.style.setProperty('--ry', '0deg'); vis.style.setProperty('--rx', '0deg'); });
  }

  // ── 6. 모바일 언어 메뉴: 좁은 화면에선 국기 7개 대신 지금 언어 하나 + 펼침 ──
  // (360~390px 에서 국기 줄이 '다운로드' 버튼을 화면 밖으로 밀어내던 문제, 2026-09-29 실측)
  function initLangMenu() {
    var bar = document.querySelector('.lang-bar');
    if (!bar) return;
    bar.addEventListener('click', function (e) {
      var btn = e.target.closest('.lang-btn');
      if (!btn || !btn.classList.contains('active')) return;
      if (matchMedia('(max-width: 560px)').matches) { e.stopPropagation(); bar.classList.toggle('open'); }
    }, true);
    document.addEventListener('click', function (e) { if (!bar.contains(e.target)) bar.classList.remove('open'); });
  }

  function boot() {
    initLangMenu();
    initHero(); initJourney(); initPrivacy(); initCta(); initTickers(); initTilt();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
