// モジポン: 文字数を数える・全角半角などをまとめて変換する
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const area = $("txArea");
  const say = (msg) => { $("txToast").textContent = msg; };
  const DRAFT_KEY = "ponkit:text";
  let undoStack = [];

  // 絵文字や結合文字も 1 文字として数える
  const seg = typeof Intl.Segmenter === "function" ? new Intl.Segmenter("ja", { granularity: "grapheme" }) : null;
  const countChars = (s) => seg ? [...seg.segment(s)].length : [...s].length;

  // 原稿用紙(20 字 × 20 行)。行ごとに 20 字で折り返して数える
  function genkoSheets(s) {
    if (!s) return 0;
    const lines = s.split("\n").reduce((n, line) => n + Math.max(1, Math.ceil(countChars(line) / 20)), 0);
    return lines / 20;
  }

  function stats() {
    const s = area.value;
    const rows = [
      ["文字数", countChars(s.replace(/\n/g, ""))],
      ["空白・改行を除く", countChars(s.replace(/\s/g, ""))],
      ["改行を含む", countChars(s)],
      ["行数", s ? s.split("\n").length : 0],
      ["原稿用紙(400字)", s ? `${genkoSheets(s).toFixed(1)} 枚` : "0 枚"],
      ["バイト数(UTF-8)", new TextEncoder().encode(s).length],
    ];
    $("txStats").replaceChildren(...rows.map(([k, v]) => {
      const d = document.createElement("div");
      d.innerHTML = "<span></span><b></b>";
      d.querySelector("span").textContent = k;
      d.querySelector("b").textContent = typeof v === "number" ? v.toLocaleString("ja-JP") : v;
      return d;
    }));
    try { localStorage.setItem(DRAFT_KEY, s); } catch {}
  }

  const shift = (s, re, d) => s.replace(re, (c) => String.fromCharCode(c.charCodeAt(0) + d));
  const TRANSFORMS = {
    half: (s) => shift(s, /[！-～]/g, -0xFEE0).replace(/　/g, " "),
    full: (s) => shift(s, /[!-~]/g, 0xFEE0).replace(/ /g, "　"),
    hira: (s) => shift(s, /[ァ-ヶ]/g, -0x60),
    kata: (s) => shift(s, /[ぁ-ゖ]/g, 0x60),
    kana: (s) => s.replace(/[｡-ﾟ]+/g, (m) => m.normalize("NFKC")),
    trim: (s) => s.split("\n").map((l) => l.replace(/^[ \t　]+|[ \t　]+$/g, "")).join("\n"),
    blank: (s) => s.replace(/\n[ \t　]*(\n[ \t　]*)+/g, "\n\n").replace(/^\n+|\n+$/g, ""),
    spaces: (s) => s.replace(/[ \t　]{2,}/g, (m) => m[0]),
    join: (s) => s.replace(/\r?\n+/g, ""),
  };
  const LABELS = {
    half: "英数字・記号を半角に", full: "英数字・記号を全角に", hira: "カタカナをひらがなに", kata: "ひらがなをカタカナに",
    kana: "半角カナを全角に", trim: "行頭・行末の空白を消す", blank: "続く空行を 1 つに", spaces: "続く空白を 1 つに", join: "改行をすべて消す",
  };

  function apply(name) {
    const before = area.value, after = TRANSFORMS[name](before);
    if (after === before) { say(`「${LABELS[name]}」: 変わる所はありませんでした。`); return; }
    undoStack.push(before);
    if (undoStack.length > 30) undoStack.shift();
    area.value = after;
    $("txUndo").disabled = false;
    stats();
    say(`「${LABELS[name]}」を行いました。`);
  }

  document.querySelectorAll("#txTools [data-t]").forEach((b) => b.onclick = () => apply(b.dataset.t));
  $("txUndo").onclick = () => {
    if (!undoStack.length) return;
    area.value = undoStack.pop();
    $("txUndo").disabled = !undoStack.length;
    stats(); say("元に戻しました。");
  };
  $("txCopy").onclick = () => {
    navigator.clipboard.writeText(area.value)
      .then(() => say("コピーしました。"))
      .catch(() => { area.select(); say("文字を選択しました。コピーしてください。"); });
  };
  $("txClear").onclick = () => {
    if (!area.value) return;
    undoStack.push(area.value);
    area.value = ""; $("txUndo").disabled = false;
    stats(); say("消しました。「元に戻す」で戻せます。"); area.focus();
  };
  area.addEventListener("input", stats);

  try { const d = localStorage.getItem(DRAFT_KEY); if (d) area.value = d; } catch {}
  if (!area.value) area.value = "ポンキットは、画像・PDF・音声を この端末の中で処理する道具箱です。\n\nここに文章を貼り付けると、文字数がすぐにわかります。ＡＢＣ１２３ のような全角英数字も、ボタン一つで半角にできます。";
  $("txUndo").disabled = true;
  stats();
})();
