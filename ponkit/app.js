// ポンキット: ツールの切り替えと「スマホで開く」
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const TOOLS = ["image", "pdf", "audio", "qr", "text", "util"];

  function showTool(tool) {
    const active = TOOLS.includes(tool) ? tool : null;
    $("home").hidden = !!active;
    TOOLS.forEach((t) => { $(`tool-${t}`).hidden = t !== active; });
    document.querySelectorAll("[data-go]").forEach((b) => {
      if (b.closest(".nav")) b.setAttribute("aria-current", (b.dataset.go || null) === active ? "page" : "false");
    });
    window.scrollTo(0, 0);
  }
  document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => showTool(b.dataset.go)));
  // 共有リンクの #image や #qr などでそのツールを開く
  showTool(location.hash.slice(1));

  // ---- スマホで開く ----
  // ページは枠の中で動くので自分の URL を知れない。公開先のアドレスを直接書く
  const APP_URL = "https://claude.ai/artifact/AVYNTaWKG7QtnXvbAumcJF";

  function qrSvg(text) {
    const qr = qrcode(0, "M");
    qr.addData(text); qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return `<svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges" role="img" aria-label="ポンキットを開く QR コード"><path d="${d}" fill="#1d2a3a"/></svg>`;
  }

  function openQr() {
    if (typeof qrcode === "function" && !$("qrCode").firstChild) $("qrCode").innerHTML = qrSvg(APP_URL);
    $("qrCode").hidden = typeof qrcode !== "function";
    $("qrUrl").value = APP_URL;
    $("qrBack").hidden = false;
    $("qrClose").focus();
  }
  const closeQr = () => { $("qrBack").hidden = true; $("phoneBtn").focus(); };
  $("phoneBtn").onclick = openQr;
  $("qrClose").onclick = closeQr;
  $("qrBack").onclick = (e) => { if (e.target === $("qrBack")) closeQr(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("qrBack").hidden) closeQr(); });
  $("qrCopy").onclick = () => {
    navigator.clipboard.writeText(APP_URL)
      .then(() => { $("qrCopy").textContent = "コピーしました"; })
      .catch(() => { $("qrUrl").select(); $("qrCopy").textContent = "選択しました"; });
    setTimeout(() => { $("qrCopy").textContent = "コピー"; }, 2000);
  };
})();
