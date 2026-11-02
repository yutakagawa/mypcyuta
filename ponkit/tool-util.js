// ベンリポン: 割り勘・日付の計算・パスワード作成
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")} 円`;

  // ---- 割り勘 ----
  let roundMode = "up";
  function split() {
    const total = Math.max(0, Math.round(+$("wkTotal").value || 0));
    const people = Math.max(1, Math.floor(+$("wkPeople").value || 1));
    const unit = +$("wkUnit").value;
    const out = $("wkOut");
    if (!total) { out.innerHTML = '<p class="u-note">合計金額を入れてください。</p>'; return; }
    let main, note;
    if (roundMode === "up") {
      // 全員が同じ額を払い、余りは幹事が預かる
      const per = Math.ceil(total / people / unit) * unit;
      main = `1 人 ${yen(per)}`;
      note = `${people} 人で ${yen(per * people)} 集まり、${yen(per * people - total)} 余ります。`;
    } else {
      // 幹事以外は端数を切り捨て、足りない分を幹事が払う
      const per = Math.floor(total / people / unit) * unit;
      const host = total - per * (people - 1);
      main = people > 1 ? `1 人 ${yen(per)} · 幹事 ${yen(host)}` : `1 人 ${yen(total)}`;
      note = people > 1 ? `幹事以外の ${people - 1} 人が ${yen(per)} ずつ、幹事が ${yen(host)} 払うとちょうど ${yen(total)} です。` : "1 人なので全額です。";
    }
    out.innerHTML = '<p class="u-big"></p><p class="u-note"></p>';
    out.querySelector(".u-big").textContent = main;
    out.querySelector(".u-note").textContent = note;
  }
  ["wkTotal", "wkPeople", "wkUnit"].forEach((id) => $(id).addEventListener("input", split));
  document.querySelectorAll("#wkMode button").forEach((b) => b.onclick = () => {
    roundMode = b.dataset.m;
    document.querySelectorAll("#wkMode button").forEach((x) => x.setAttribute("aria-pressed", x === b));
    split();
  });

  // ---- 日付の計算(時差の影響を受けないよう UTC の日付として扱う) ----
  const WEEK = "日月火水木金土";
  const toDay = (v) => { const [y, m, d] = v.split("-").map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
  const fromDay = (n) => { const d = new Date(n * 86400000); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日(${WEEK[d.getUTCDay()]})`; };
  const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

  function between() {
    const a = $("dtFrom").value, b = $("dtTo").value, out = $("dtBetweenOut");
    if (!a || !b) { out.textContent = "2 つの日付を選んでください。"; return; }
    let n = toDay(b) - toDay(a);
    const sign = n < 0 ? -1 : 1;
    n = Math.abs(n) + ($("dtInclude").checked ? 1 : 0);
    const w = Math.floor(n / 7), r = n % 7;
    out.innerHTML = '<p class="u-big"></p><p class="u-note"></p>';
    out.querySelector(".u-big").textContent = `${n.toLocaleString("ja-JP")} 日${sign < 0 ? "(さかのぼり)" : ""}`;
    out.querySelector(".u-note").textContent = `${w} 週と ${r} 日${$("dtInclude").checked ? " · 初日を含めた日数" : ""}`;
  }
  function after() {
    const a = $("dtBase").value, n = Math.trunc(+$("dtDays").value || 0), out = $("dtAfterOut");
    if (!a) { out.textContent = "基準の日を選んでください。"; return; }
    out.innerHTML = '<p class="u-big"></p><p class="u-note"></p>';
    out.querySelector(".u-big").textContent = fromDay(toDay(a) + n);
    out.querySelector(".u-note").textContent = `${fromDay(toDay(a))} の ${Math.abs(n).toLocaleString("ja-JP")} 日${n < 0 ? "前" : "後"}`;
  }
  ["dtFrom", "dtTo", "dtInclude"].forEach((id) => $(id).addEventListener("input", between));
  ["dtBase", "dtDays"].forEach((id) => $(id).addEventListener("input", after));

  // ---- パスワード作成(crypto の乱数を使い、偏りが出ないよう捨てながら選ぶ) ----
  const SETS = { upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ", lower: "abcdefghijklmnopqrstuvwxyz", digit: "0123456789", symbol: "!#$%&*+-=?@^_" };
  const AMBIGUOUS = /[0O1lI|]/g;
  function randInt(n) {
    const lim = Math.floor(0x100000000 / n) * n, a = new Uint32Array(1);
    do crypto.getRandomValues(a); while (a[0] >= lim);
    return a[0] % n;
  }
  function makePassword() {
    const len = +$("pwLen").value;
    const groups = Object.keys(SETS).filter((k) => $(`pw_${k}`).checked)
      .map((k) => $("pwPlain").checked ? SETS[k].replace(AMBIGUOUS, "") : SETS[k]);
    if (!groups.length) return { pw: "", bits: 0 };
    const pool = groups.join("");
    // 選んだ種類が必ず 1 文字は入るようにしてから、残りを埋めて混ぜる
    const chars = groups.map((g) => g[randInt(g.length)]);
    while (chars.length < len) chars.push(pool[randInt(pool.length)]);
    for (let i = chars.length - 1; i > 0; i--) { const j = randInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
    return { pw: chars.join(""), bits: Math.round(len * Math.log2(pool.length)) };
  }
  function regen() {
    $("pwLenVal").textContent = $("pwLen").value;
    const { pw, bits } = makePassword();
    $("pwOut").textContent = pw || "文字の種類を 1 つ以上選んでください。";
    $("pwCopy").disabled = !pw;
    const level = bits >= 100 ? ["とても強い", "ok"] : bits >= 70 ? ["強い", "ok"] : bits >= 50 ? ["ふつう", "warn"] : ["弱い", "err"];
    $("pwStrength").textContent = pw ? `強さ: ${level[0]}(約 ${bits} ビット)` : "";
    $("pwStrength").dataset.level = level[1];
  }
  ["pwLen", "pw_upper", "pw_lower", "pw_digit", "pw_symbol", "pwPlain"].forEach((id) => $(id).addEventListener("input", regen));
  $("pwNew").onclick = regen;
  $("pwCopy").onclick = () => {
    navigator.clipboard.writeText($("pwOut").textContent)
      .then(() => { $("pwCopy").textContent = "コピーしました"; })
      .catch(() => { getSelection().selectAllChildren($("pwOut")); $("pwCopy").textContent = "選択しました"; });
    setTimeout(() => { $("pwCopy").textContent = "コピー"; }, 2000);
  };

  // 開いたときから結果が見えるよう、例の値を入れておく
  $("dtFrom").value = $("dtBase").value = todayStr();
  { const d = new Date(); $("dtTo").value = `${d.getFullYear()}-12-31`; }
  split(); between(); after(); regen();
})();
