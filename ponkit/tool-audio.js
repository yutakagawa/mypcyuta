// オトポン: 音声(動画の音声も)を MP3 に圧縮する
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const LAME_URL = "https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js";
  const PRESETS = {
    voice: { label: "声・会議", channels: 1, rate: 22050, kbps: 48 },
    std: { label: "標準", channels: 2, rate: 44100, kbps: 128 },
    high: { label: "高音質", channels: 2, rate: 44100, kbps: 192 },
  };
  const AUDIO_RE = /\.(wav|wave|m4a|aac|mp3|ogg|oga|opus|flac|aif|aiff|caf|mp4|m4v|mov|webm|3gp)$/i;

  const tracks = []; // { file, el, state: "wait"|"work"|"done"|"err", progress, mp3, url, duration, key, error }
  let preset = "std";
  try { if (PRESETS[localStorage.getItem("ponkit:audio")]) preset = localStorage.getItem("ponkit:audio"); } catch {}
  const say = (msg) => { $("auToast").textContent = msg; };
  const fmtTime = (s) => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60; return (h ? `${h}:${pad2(m)}` : `${m}`) + `:${pad2(s % 60)}`; };
  const outName = (t) => `${stemOf(t.file.name)}.mp3`;
  const yieldTick = () => new Promise((r) => setTimeout(r, 0));

  function addFiles(files) {
    const ok = files.filter((f) => AUDIO_RE.test(f.name) || /^(audio|video)\//.test(f.type));
    say(files.length > ok.length ? `${files.length - ok.length} 件は音声や動画ではないのでスキップしました。` : "");
    for (const file of ok) {
      const t = { file, state: "wait", progress: 0 };
      tracks.push(t);
      $("auList").append(renderTrack(t));
    }
    refreshList();
    runQueue();
  }

  function renderTrack(t) {
    const el = t.el || document.createElement("article");
    el.className = "track";
    const p = PRESETS[preset];
    const est = t.duration ? `約 ${fmtSize(t.duration * p.kbps * 1000 / 8)}` : "";
    const info = {
      wait: `${fmtSize(t.file.size)} · 待っています`,
      work: `${fmtSize(t.file.size)} → ${est || "…"} · 圧縮中 ${Math.round(t.progress * 100)}%`,
      done: `${t.duration ? fmtTime(t.duration) + " · " : ""}${fmtSize(t.file.size)} → ${t.mp3 ? fmtSize(t.mp3.size) : ""} · ${p.label}`,
      err: fmtSize(t.file.size),
    }[t.state];
    el.innerHTML = `
      <div class="t-name"></div>
      <div class="t-info"></div>
      <div class="t-act">
        <button class="save dl" type="button" ${t.state === "done" && downloads ? "" : "disabled"}>保存</button>
        <button class="save x" type="button" aria-label="この音声を外す">外す</button>
      </div>
      ${t.state === "work" ? '<div class="bar"><i></i></div>' : ""}
      ${t.state === "err" ? '<div class="err-msg"></div>' : ""}`;
    el.querySelector(".t-name").textContent = t.state === "done" ? outName(t) : t.file.name;
    el.querySelector(".t-info").textContent = info;
    if (t.state === "work") el.querySelector(".bar i").style.width = `${Math.round(t.progress * 100)}%`;
    if (t.state === "err") el.querySelector(".err-msg").textContent = t.error;
    if (t.state === "done" && t.url) {
      // 試し聞き。この画面で再生できないときは出さない
      const a = document.createElement("audio");
      a.controls = true; a.preload = "none"; a.src = t.url;
      a.onerror = () => a.remove();
      el.append(a);
    }
    el.querySelector(".dl").onclick = () => saveTracks([t]);
    el.querySelector(".x").onclick = () => removeTrack(t);
    t.el = el;
    return el;
  }

  function refreshList() {
    const done = tracks.filter((t) => t.state === "done");
    $("auWork").hidden = tracks.length === 0;
    $("auEmpty").hidden = tracks.length > 0;
    const total = done.reduce((n, t) => n + t.mp3.size, 0), before = done.reduce((n, t) => n + t.file.size, 0);
    $("auCount").textContent = tracks.length
      ? `${tracks.length} 件中 ${done.length} 件完了` + (done.length ? ` · ${fmtSize(before)} → ${fmtSize(total)}` : "")
      : "";
    $("auSaveAll").disabled = !downloads || done.length === 0;
  }

  function removeTrack(t) {
    const i = tracks.indexOf(t);
    if (i < 0) return;
    tracks.splice(i, 1);
    t.removed = true;
    if (t.url) URL.revokeObjectURL(t.url);
    t.el?.remove();
    refreshList();
  }

  // 1 件ずつ順に圧縮する。設定が変わったら作り直す
  let running = false;
  async function runQueue() {
    if (running) return;
    running = true;
    try {
      for (;;) {
        const t = tracks.find((x) => x.state === "wait");
        if (!t) break;
        await compress(t);
      }
    } finally {
      running = false;
    }
  }

  async function compress(t) {
    const p = PRESETS[preset], key = preset;
    t.state = "work"; t.progress = 0; renderTrack(t);
    try {
      await loadScript(LAME_URL);
      const decoded = await decode(t.file);
      t.duration = decoded.duration;
      const ch = Math.min(p.channels, decoded.numberOfChannels);
      // 指定のサンプリング周波数とチャンネル数に作り直す(モノラルは左右を混ぜる)
      const off = new OfflineAudioContext(ch, Math.max(1, Math.ceil(decoded.duration * p.rate)), p.rate);
      const node = off.createBufferSource();
      node.buffer = decoded; node.connect(off.destination); node.start();
      const pcm = await off.startRendering();
      const toInt16 = (f) => { const o = new Int16Array(f.length); for (let i = 0; i < f.length; i++) { const v = Math.max(-1, Math.min(1, f[i])); o[i] = v < 0 ? v * 0x8000 : v * 0x7fff; } return o; };
      const L = toInt16(pcm.getChannelData(0)), R = ch > 1 ? toInt16(pcm.getChannelData(1)) : null;
      const enc = new lamejs.Mp3Encoder(ch, p.rate, p.kbps);
      const parts = [], step = 1152 * 40;
      for (let i = 0; i < L.length; i += step) {
        if (t.removed || key !== preset) return;
        const l = L.subarray(i, i + step);
        const buf = R ? enc.encodeBuffer(l, R.subarray(i, i + step)) : enc.encodeBuffer(l);
        if (buf.length) parts.push(new Uint8Array(buf));
        t.progress = i / L.length;
        if ((i / step) % 20 === 0) { renderTrack(t); await yieldTick(); }
      }
      const tail = enc.flush();
      if (tail.length) parts.push(new Uint8Array(tail));
      if (t.removed) return;
      if (t.url) URL.revokeObjectURL(t.url);
      t.mp3 = new Blob(parts, { type: "audio/mpeg" });
      t.url = URL.createObjectURL(t.mp3);
      t.key = key; t.state = "done";
    } catch (e) {
      console.error("audio failed", t.file.name, e);
      t.state = "err";
      t.error = e?.libLoad ? e.message + "。" : "音声を読み込めませんでした。このブラウザが読めない形式か、ファイルが壊れている可能性があります。";
    }
    if (t.removed) return;
    if (t.state === "work") t.state = "wait"; // 途中で設定が変わった
    renderTrack(t); refreshList();
  }

  // AudioContext を作らずに読む(ボタンを押す前でも使える)
  function decode(file) {
    return file.arrayBuffer().then((buf) => new Promise((res, rej) => {
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const p = ctx.decodeAudioData(buf, res, rej);
      if (p?.then) p.then(res, rej);
    }));
  }

  async function saveTracks(list) {
    const done = list.filter((t) => t.state === "done");
    if (!done.length) return;
    const zip = new JSZip();
    uniqueList(done.map(outName)).forEach((name, i) => zip.file(name, done[i].mp3));
    const data = await zip.generateAsync({ type: "blob", compression: "STORE" });
    await saveFile(done.length === 1 ? `${stemOf(done[0].file.name)}_mp3.zip` : `otopon_${stampNow()}.zip`, data, say);
  }

  function setPreset(p) {
    preset = p;
    try { localStorage.setItem("ponkit:audio", p); } catch {}
    document.querySelectorAll("#auPresets button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.p === p));
    let changed = false;
    tracks.forEach((t) => { if ((t.state === "done" && t.key !== p) || t.state === "work") { t.state = "wait"; changed = true; } renderTrack(t); });
    refreshList();
    if (changed) { say(`「${PRESETS[p].label}」で作り直しています…`); runQueue().then(() => say("")); }
  }

  document.querySelectorAll("#auPresets button").forEach((b) => b.onclick = () => setPreset(b.dataset.p));
  $("auSaveAll").onclick = () => saveTracks(tracks);
  $("auClear").onclick = () => { [...tracks].forEach(removeTrack); say(""); };
  document.addEventListener("downloads-ready", () => { tracks.forEach(renderTrack); refreshList(); });
  wireDrop($("auDrop"), $("auFile"), $("auPick"), addFiles);
  setPreset(preset);
})();
