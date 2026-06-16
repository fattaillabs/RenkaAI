/*
 * Renka 스타일 가이드 접근 게이트 (클라이언트, 캐주얼 차단용)
 * 앱 WebView는 UA에 "RenkaApp" 토큰을 넣어 통과시키고,
 * 일반 브라우저/검색 유입은 안내 화면으로 대체한다.
 * 정적 호스팅이라 완벽 차단은 아니며(UA 위조 가능), 우연한 직접 접근을 막는 용도.
 */
(function () {
  var ua = navigator.userAgent || '';
  if (ua.indexOf('RenkaApp') !== -1) return; // 앱 WebView → 통과

  // 플래시 방지: 콘텐츠 즉시 숨김 (head에서 동기 실행)
  try {
    var s = document.createElement('style');
    s.id = 'renka-gate-hide';
    s.textContent = 'body{visibility:hidden!important}';
    (document.head || document.documentElement).appendChild(s);
  } catch (e) {}

  function gate() {
    var lang = (navigator.language || 'en').toLowerCase();
    var m;
    if (lang.indexOf('ko') === 0) m = { t: 'Renka 앱 전용 가이드', d: '이 스타일 가이드는 Renka 앱의 측정 결과에서 열어볼 수 있어요.' };
    else if (lang.indexOf('ja') === 0) m = { t: 'Renkaアプリ専用ガイド', d: 'このスタイルガイドはRenkaアプリの測定結果から開けます。' };
    else if (lang.indexOf('zh') === 0) m = { t: 'Renka 应用专属指南', d: '此造型指南可在 Renka 应用的测量结果中打开。' };
    else m = { t: 'Renka app only', d: 'This style guide opens from your measurement results in the Renka app.' };
    document.title = m.t;
    document.body.innerHTML =
      '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#f2fae8,#e2f3d0);font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#33402d">'
      + '<div style="text-align:center;padding:40px;max-width:340px">'
      + '<div style="font-size:46px;margin-bottom:16px">🌿</div>'
      + '<h1 style="font-size:21px;margin:0 0 10px;font-weight:800">' + m.t + '</h1>'
      + '<p style="font-size:14px;color:#5e6d54;line-height:1.7;margin:0">' + m.d + '</p>'
      + '</div></div>';
    document.body.style.visibility = 'visible';
    var h = document.getElementById('renka-gate-hide');
    if (h) h.remove();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', gate);
  else gate();
})();
