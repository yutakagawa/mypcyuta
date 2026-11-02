// QRポン: QR コードを作る・画像から読み取る
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const JSQR_URL = "https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js";
  // 日本語も入れられるよう UTF-8 で符号化する
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  let kind = "text", ecl = "M";
  const say = (msg) => { $("qrToast").textContent = msg; };

  // Wi-Fi の書式では \ ; , : " を \ で逃がす
  const wifiEscape = (s) => s.replace(/([\\;,:"])/g, "\\$1");
  function content() {
    if (kind === "wifi") {
      const ssid = $("qrSsid").value;
      if (!ssid) return "";
      const sec = $("qrSec").value;
      return `WIFI:T:${sec};S:${wifiEscape(ssid)};${sec === "nopass" ? "" : `P:${wifiEscape($("qrPass").value)};`}${$("qrHidden").checked ? "H:true;" : ""};`;
    }
    return $("qrText").value;
  }

  function matrix(text) {
    const qr = qrcode(0, ecl);
    qr.addData(text); qr.make();
    return qr;
  }

  const QUIET = 4;
  function svgOf(qr, fg, bg) {
    const n = qr.getModuleCount(), size = n + QUIET * 2;
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + QUIET} ${r + QUIET}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
  }

  function pngOf(qr, fg, bg, px) {
    const n = qr.getModuleCount(), size = n + QUIET * 2, k = Math.max(1, Math.floor(px / size));
    const c = document.createElement("canvas");
    c.width = c.height = size * k;
    const ctx = c.getContext("2d");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = fg;
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) ctx.fillRect((col + QUIET) * k, (r + QUIET) * k, k, k);
    return canvasToBlob(c, "image/png");
  }

  // 色の明るさの差。小さいとカメラで読み取りにくい
  function contrast(a, b) {
    const lum = (hex) => {
      const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
      return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  let current = null;
  function update() {
    const text = content(), fg = $("qrFg").value, bg = $("qrBg").value;
    current = null;
    $("qrSavePng").disabled = $("qrSaveSvg").disabled = true;
    if (!text) { $("qrPreview").innerHTML = '<p class="qr-placeholder">内容を入れると、ここに QR コードが出ます。</p>'; $("qrNote").textContent = ""; return; }
    try {
      const qr = matrix(text);
      current = { qr, fg, bg, text };
      $("qrPreview").innerHTML = svgOf(qr, fg, bg);
      const notes = [`${[...text].length} 文字 · ${qr.getModuleCount()} × ${qr.getModuleCount()} マス`];
      if (contrast(fg, bg) < 3) notes.push("色の差が小さく、読み取りにくいかもしれません");
      // 色のほうが背景より明るい(白抜き)と、読めないアプリがある
      else if (contrast(fg, "#ffffff") < contrast(bg, "#ffffff")) notes.push("明るい地に暗い色のほうが読み取りやすくなります");
      $("qrNote").textContent = notes.join(" · ");
      $("qrSavePng").disabled = $("qrSaveSvg").disabled = !downloads;
    } catch (e) {
      $("qrPreview").innerHTML = '<p class="qr-placeholder">内容が長すぎて QR コードにできません。短くするか、誤り訂正を「低」にしてください。</p>';
      $("qrNote").textContent = "";
    }
  }

  const fileBase = () => {
    const t = current?.text || "";
    if (kind === "wifi") return `qr_wifi_${$("qrSsid").value.replace(/[^\w-]+/g, "") || "network"}`;
    const host = t.match(/^https?:\/\/([^/?#]+)/i)?.[1];
    return host ? `qr_${host.replace(/[^\w.-]+/g, "")}` : `qr_${stampNow()}`;
  };

  $("qrSavePng").onclick = async () => {
    if (!current) return;
    await saveFile(`${fileBase()}.png`, await pngOf(current.qr, current.fg, current.bg, +$("qrPx").value), say);
  };
  $("qrSaveSvg").onclick = async () => {
    if (!current) return;
    await saveFile(`${fileBase()}.svg`, svgOf(current.qr, current.fg, current.bg), say);
  };

  function setKind(k) {
    kind = k;
    document.querySelectorAll("#qrKinds button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === k));
    $("qrTextBox").hidden = k !== "text";
    $("qrWifiBox").hidden = k !== "wifi";
    $("qrPassRow").hidden = k === "wifi" && $("qrSec").value === "nopass";
    update();
  }
  document.querySelectorAll("#qrKinds button").forEach((b) => b.onclick = () => setKind(b.dataset.k));
  document.querySelectorAll("#qrEcl button").forEach((b) => b.onclick = () => {
    ecl = b.dataset.e;
    document.querySelectorAll("#qrEcl button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    update();
  });
  ["qrText", "qrSsid", "qrPass", "qrFg", "qrBg"].forEach((id) => $(id).addEventListener("input", update));
  $("qrHidden").addEventListener("change", update);
  $("qrSec").addEventListener("change", () => setKind("wifi"));
  $("qrSwap").onclick = () => { const f = $("qrFg").value; $("qrFg").value = $("qrBg").value; $("qrBg").value = f; update(); };

  // ---- 読み取り ----
  const readSay = (msg) => { $("qrReadToast").textContent = msg; };

  async function readFiles(files) {
    const img = files.find((f) => IMAGE_RE.test(f.name) || f.type.startsWith("image/"));
    if (!img) { readSay("画像ファイルを選んでください。"); return; }
    readSay(`${img.name || "貼り付けた画像"} を読み取っています…`);
    $("qrResult").hidden = true;
    try {
      await loadScript(JSQR_URL);
      const bmp = await createImageBitmap(await decodeToPng(img));
      // 大きすぎる写真は縮めてから探す(速く、メモリも少なく)
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      bmp.close();
      const data = ctx.getImageData(0, 0, c.width, c.height);
      const hit = jsQR(data.data, c.width, c.height, { inversionAttempts: "attemptBoth" });
      if (!hit) { readSay("QR コードが見つかりませんでした。QR が大きく、まっすぐ写った画像で試してください。"); return; }
      showResult(hit.data);
      readSay("");
    } catch (e) {
      console.error("qr read failed", e);
      readSay(`読み取れませんでした。${e?.message || e}。`);
    }
  }

  function parseWifi(s) {
    if (!/^WIFI:/i.test(s)) return null;
    const get = (k) => s.match(new RegExp(`[:;]${k}:((?:\\\\.|[^;])*)`))?.[1]?.replace(/\\(.)/g, "$1") ?? "";
    return { ssid: get("S"), pass: get("P"), sec: get("T") || "なし" };
  }

  function showResult(text) {
    $("qrResult").hidden = false;
    $("qrResText").textContent = text;
    const url = /^https?:\/\/\S+$/i.test(text.trim()) ? text.trim() : null;
    $("qrResLink").hidden = !url;
    if (url) $("qrResLink").href = url;
    const w = parseWifi(text);
    $("qrResWifi").hidden = !w;
    if (w) $("qrResWifi").textContent = `Wi-Fi「${w.ssid}」 パスワード: ${w.pass || "(なし)"} · 方式: ${w.sec}`;
    $("qrResCopy").onclick = () => {
      navigator.clipboard.writeText(w?.pass || text)
        .then(() => readSay(w?.pass ? "パスワードをコピーしました。" : "コピーしました。"))
        .catch(() => { getSelection().selectAllChildren($("qrResText")); readSay("文字を選択しました。コピーしてください。"); });
    };
    $("qrResCopy").textContent = w?.pass ? "パスワードをコピー" : "コピー";
  }

  wireDrop($("qrReadDrop"), $("qrReadFile"), $("qrReadPick"), readFiles);
  // スクリーンショットを貼り付けても読み取れる(QRポンを開いているときだけ)
  document.addEventListener("paste", (e) => {
    if ($("tool-qr").hidden || /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); readFiles(files); }
  });
  document.addEventListener("downloads-ready", update);
  setKind("text");
})();
