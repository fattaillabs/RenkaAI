#!/usr/bin/env python3
"""Renka 랜딩 로케일 빌드.

원본은 하나: _src/index.html (7개 언어가 <span lang="xx"> 로 인라인).
이 스크립트가 로케일마다 다른 언어 span을 물리적으로 제거하고 head 메타를
_src/locales.json 값으로 바꿔 index.html, ko/index.html, ja/index.html … 을
써낸다. 배포 파일에는 그 언어 텍스트만 남으므로 JS를 실행하지 않는
크롤러(네이버·LLM 봇)도 해당 언어를 그대로 읽는다.

  python3 _src/build.py          # 7개 페이지 생성
  python3 _src/build.py --check  # 생성 결과가 현재 파일과 같은지만 확인

카피를 고칠 때는 _src/index.html 만 고치고 다시 빌드한다. 로케일 페이지를
직접 편집하면 다음 빌드에서 덮어써진다. `_src/` 는 GitHub Pages(Jekyll)가
게시하지 않는다.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
BASE = "https://fattaillabs.com/RenkaAI/"
LANG_ORDER = ["en", "ko", "ja", "zh-CN", "zh-TW", "es", "id"]
# 로케일 페이지의 상대 경로 접두어. LANG_HOME 은 페이지 위치 기준.
DIRS = {"en": "", "ko": "ko/", "ja": "ja/", "zh-CN": "zh-cn/", "zh-TW": "zh-tw/", "es": "es/", "id": "id/"}


def strip_other_langs(body, keep):
    """<span lang="xx"> 요소를 깊이 추적으로 통째 제거(keep 언어는 유지)."""
    out = []
    i = 0
    skip_depth = 0
    for m in re.finditer(r'<span\b([^>]*)>|</span>', body):
        if skip_depth:
            if m.group(0) == '</span>':
                skip_depth -= 1
            else:
                skip_depth += 1
            i = m.end()
            continue
        out.append(body[i:m.start()])
        i = m.end()
        if m.group(0) == '</span>':
            out.append(m.group(0))
            continue
        lm = re.search(r'\blang="([^"]*)"', m.group(1))
        if lm and lm.group(1) != keep:
            skip_depth = 1
        else:
            out.append(m.group(0))
    out.append(body[i:])
    s = ''.join(out)
    # 제거로 남은 빈 줄 정리
    s = re.sub(r'\n[ \t]*\n(?:[ \t]*\n)+', '\n', s)
    return s


def set_meta(s, attr, key, value):
    pat = re.compile(r'(<meta %s="%s" content=")[^"]*(")' % (attr, re.escape(key)))
    assert pat.search(s), key
    return pat.sub(lambda m: m.group(1) + value + m.group(2), s, count=1)


def build(lang, cfg, master):
    d = DIRS[lang]
    prefix = "../" if d else ""
    url = BASE + d
    s = master

    # ── head ──
    s = s.replace('<html lang="en">', '<html lang="%s">' % cfg["html_lang"], 1)
    s = re.sub(r'<title>[^<]*</title>', '<title>%s</title>' % cfg["title"], s, count=1)
    s = set_meta(s, "name", "description", cfg["description"])
    s = set_meta(s, "name", "keywords", cfg["keywords"])
    s = set_meta(s, "property", "og:title", cfg["og_title"])
    s = set_meta(s, "property", "og:description", cfg["og_description"])
    s = set_meta(s, "property", "og:url", url)
    s = set_meta(s, "property", "og:locale", cfg["og_locale"])
    s = set_meta(s, "name", "twitter:title", cfg["og_title"])
    s = set_meta(s, "name", "twitter:description", cfg["og_description"])
    s = s.replace('<link rel="canonical" href="%s">' % BASE, '<link rel="canonical" href="%s">' % url, 1)
    alts = "\n".join('    <meta property="og:locale:alternate" content="%s">' % locales[l]["og_locale"]
                     for l in LANG_ORDER if l != lang)
    s = s.replace('    <!-- og:locale:alternate (generated) -->', alts, 1)

    # ── JSON-LD ──
    s = re.sub(r'("@type": "MobileApplication".*?"description": ")[^"]*(")',
               lambda m: m.group(1) + cfg["ld_description"] + m.group(2), s, count=1, flags=re.S)
    s = s.replace('"url": "%s",' % BASE, '"url": "%s",' % url)          # MobileApplication + WebSite
    if cfg["play_hl"]:
        s = s.replace('details?id=com.fattail.renka"', 'details?id=com.fattail.renka&hl=%s"' % cfg["play_hl"], 1)

    # ── 상대 경로 ──
    if prefix:
        s = re.sub(r'((?:href|src)=")(?!https?:|//|#|mailto:|data:|\.\./)(?:\./)?', r'\1' + prefix, s)
        s = re.sub(r"'(assets/[^']+)'", r"'" + prefix + r"\1'", s)
    home = {l: (prefix + DIRS[l] if DIRS[l] else (prefix or "./")) for l in LANG_ORDER}
    lang_home = "{ " + ", ".join("'%s': '%s'" % (l, home[l]) for l in LANG_ORDER) + " }"
    s = re.sub(r"var LANG_HOME = \{[^}]*\};", "var LANG_HOME = %s;" % lang_home, s, count=1)
    s = s.replace("var PAGE_LANG = 'en';", "var PAGE_LANG = '%s';" % lang, 1)

    # ── 히어로 사진: JS 없이도 로케일에 맞는 모델이 보이게 ──
    if lang == "en":
        s = s.replace('src="assets/hero-face.jpg"', 'src="assets/hero-face-en.jpg"', 1)
        s = s.replace('src="assets/face-male.jpg"', 'src="assets/face-male-en.jpg"', 1)

    # ── 언어 버튼·body class ──
    s = s.replace('<button class="lang-btn active" data-lang="en"', '<button class="lang-btn" data-lang="en"', 1)
    s = s.replace('<button class="lang-btn" data-lang="%s"' % lang, '<button class="lang-btn active" data-lang="%s"' % lang, 1)
    s = s.replace('<body class="lang-en">', '<body class="lang-%s">' % lang, 1)

    # 로케일 페이지는 저장된 선호 언어로 되돌리지 않는다(URL이 곧 선택).
    if lang != "en":
        s = re.sub(r"const saved = localStorage\.getItem\('preferred-lang'\);\s*"
                   r"if \(saved && [^\n]*\) \{\s*location\.replace\(LANG_HOME\[saved\]\);\s*\} else \{\s*"
                   r"setLang\(PAGE_LANG\);\s*\}", "setLang(PAGE_LANG);", s, count=1)

    # ── 본문에서 다른 언어 제거 ──
    head, body = s.split("<body", 1)
    body = strip_other_langs(body, lang)
    return head + "<body" + body


if __name__ == "__main__":
    locales = json.load(open(os.path.join(HERE, "locales.json")))
    master = open(os.path.join(HERE, "index.html")).read()
    check = "--check" in sys.argv
    dirty = 0
    for lang in LANG_ORDER:
        out = build(lang, locales[lang], master)
        path = os.path.join(ROOT, DIRS[lang], "index.html")
        cur = open(path).read() if os.path.exists(path) else None
        if check:
            if cur != out:
                dirty += 1
                print("stale:", path)
        else:
            open(path, "w").write(out)
            print("wrote", os.path.relpath(path, ROOT), len(out), "bytes")
    if check:
        print("up to date" if not dirty else "%d stale" % dirty)
        sys.exit(1 if dirty else 0)
