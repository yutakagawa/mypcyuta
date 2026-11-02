// ポンキット共通: 各ツールから使う小さな道具
const $ = (id) => document.getElementById(id);
const fmtSize = (n) => n < 1024 ? n + " B" : n < 1024 * 1024 ? (n / 1024).toFixed(0) + " KB" : (n / 1024 / 1024).toFixed(1) + " MB";
const pad2 = (x) => String(x).padStart(2, "0");
const stampNow = () => { const d = new Date(); return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(d.getMinutes())}`; };
const stemOf = (name) => name.replace(/\.[^.]+$/, "");

// 外部ライブラリは使うときだけ読み込む(同じ URL は 1 回だけ)
const scriptCache = new Map();
function loadScript(src) {
  if (!scriptCache.has(src)) {
    scriptCache.set(src, new Promise((res, rej) => {
      const el = document.createElement("script");
      el.src = src; el.onload = res;
      el.onerror = () => { scriptCache.delete(src); el.remove(); rej(Object.assign(new Error("部品を読み込めませんでした。通信状況を確認してください"), { libLoad: true })); };
      document.head.append(el);
    }));
  }
  return scriptCache.get(src);
}

const canvasToBlob = (c, type = "image/png", quality) =>
  new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("画像を作れませんでした")), type, quality));

// ファイル保存は viewer の downloads 機能を通す。使えない画面では null のまま
let downloads = null;
(window.claude?.use ? window.claude.use("downloads") : Promise.resolve(null))
  .then((d) => { downloads = d; document.dispatchEvent(new Event("downloads-ready")); })
  .catch(() => {});

// 保存して結果を say(文言) で知らせる。成功なら true
async function saveFile(filename, data, say) {
  if (!downloads) { say("この画面ではファイルを保存できません。"); return false; }
  try {
    await downloads.save({ filename, data });
    say(`${filename} を保存しました。`);
    return true;
  } catch (e) {
    if (e?.code === "declined") say("保存をキャンセルしました。");
    else if (e?.code === "rate_limited") say("保存の確認画面が開いています。閉じてからもう一度押してください。");
    else if (e?.code === "too_large") say("ファイルが大きすぎて保存できませんでした。");
    else say("この画面ではファイルを保存できません。");
    return false;
  }
}

// 同じ名前が重なったら「名前 (2).ext」にする
function uniqueList(names) {
  const used = new Set();
  return names.map((name) => {
    const m = name.match(/^(.*?)(\.[^.]+)?$/);
    let n = 2, out = name;
    while (used.has(out.toLowerCase())) out = `${m[1]} (${n++})${m[2] || ""}`;
    used.add(out.toLowerCase());
    return out;
  });
}

// ドロップ枠・ボタン・file input をまとめてつなぐ
function wireDrop(dropEl, inputEl, pickBtn, onFiles) {
  pickBtn.onclick = (e) => { e.stopPropagation(); inputEl.click(); };
  dropEl.onclick = () => inputEl.click();
  dropEl.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputEl.click(); } };
  inputEl.onchange = () => { onFiles([...inputEl.files]); inputEl.value = ""; };
  ["dragenter", "dragover"].forEach((t) => dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => dropEl.addEventListener(t, (e) => { e.preventDefault(); dropEl.classList.remove("over"); }));
  dropEl.addEventListener("drop", (e) => onFiles([...e.dataTransfer.files]));
}
