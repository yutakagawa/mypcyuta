// PDFポン: PDF と画像のページを並べ、1 冊の PDF・ページごとの PDF・画像として保存する
// ブロック内の function はグローバルに漏れるので、関数で包んで他のツールと名前がぶつからないようにする
(() => {
  const PDFLIB_URL = "https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js";
  const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js";
  const PDFJS_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
  const THUMB = 240;

  const sources = new Map(); // id -> { kind: "pdf", name, bytes, pjs } | { kind: "img", name, jpg, w, h }
  let pages = [];            // { id, src, index, rot, thumb }
  let nextId = 1, pageSize = "fit", busy = false, dragId = null;
  const say = (msg) => { $("pdfToast").textContent = msg; };

  async function loadPdfJs() {
    await loadScript(PDFJS_URL);
    const lib = window.pdfjsLib;
    if (!lib.GlobalWorkerOptions.workerPort) {
      // 別のサイトにある worker はそのまま起動できないので、読み込むだけの小さな worker を作る
      const abs = new URL(PDFJS_WORKER_URL, location.href).href;
      lib.GlobalWorkerOptions.workerSrc = abs;
      try {
        lib.GlobalWorkerOptions.workerPort = new Worker(URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(abs)});`], { type: "text/javascript" })));
      } catch {}
    }
    return lib;
  }
  const loadPdfLib = () => loadScript(PDFLIB_URL).then(() => window.PDFLib);

  const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  async function addFiles(files) {
    const ok = files.filter((f) => isPdf(f) || IMAGE_RE.test(f.name) || f.type.startsWith("image/"));
    say(files.length > ok.length ? `${files.length - ok.length} 件は PDF でも画像でもないのでスキップしました。` : "");
    for (const file of ok) {
      try {
        say(`${file.name} を読み込んでいます…`);
        if (isPdf(file)) await addPdf(file); else await addImage(file);
      } catch (e) {
        console.error("pdf add failed", file.name, e);
        say(`${file.name} を読み込めませんでした。${e?.name === "PasswordException" ? "パスワード付きの PDF は開けません" : e?.message || e}。`);
        continue;
      }
      say("");
    }
    render();
    renderThumbs();
  }

  async function addPdf(file) {
    const pdfjs = await loadPdfJs();
    const bytes = await file.arrayBuffer();
    // pdf.js は渡したデータを worker に移すので、写しを渡す
    const pjs = await pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)), isEvalSupported: false, disableFontFace: true }).promise;
    const id = nextId++;
    sources.set(id, { kind: "pdf", name: file.name, bytes, pjs });
    for (let i = 0; i < pjs.numPages; i++) pages.push({ id: nextId++, src: id, index: i, rot: 0, thumb: null });
  }

  // 画像は一度描き直して JPEG にする(撮影情報を落とし、PDF にそのまま入れられる形にする)
  async function addImage(file) {
    const png = await decodeToPng(file);
    const bmp = await createImageBitmap(png);
    const c = document.createElement("canvas");
    c.width = bmp.width; c.height = bmp.height;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0);
    bmp.close();
    const jpg = await canvasToBlob(c, "image/jpeg", 0.92);
    const id = nextId++;
    sources.set(id, { kind: "img", name: file.name, jpg, w: c.width, h: c.height });
    pages.push({ id: nextId++, src: id, index: 0, rot: 0, thumb: URL.createObjectURL(jpg) });
  }

  // サムネイルは 1 枚ずつ順に描く(たくさんのページでもメモリを使いすぎない)
  let thumbRun = 0;
  async function renderThumbs() {
    const run = ++thumbRun;
    for (const p of pages) {
      if (run !== thumbRun) return;
      if (p.thumb) continue;
      const src = sources.get(p.src);
      try {
        const page = await src.pjs.getPage(p.index + 1);
        const vp0 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: THUMB / Math.max(vp0.width, vp0.height) });
        const c = document.createElement("canvas");
        c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        p.thumb = URL.createObjectURL(await canvasToBlob(c, "image/jpeg", 0.8));
      } catch (e) {
        console.error("thumb failed", e);
        p.thumb = "";
      }
      const img = document.querySelector(`[data-page="${p.id}"] .page-thumb img`);
      if (img && p.thumb) img.src = p.thumb;
    }
  }

  function render() {
    const grid = $("pdfGrid");
    grid.replaceChildren(...pages.map((p, i) => pageCard(p, i)));
    $("pdfWork").hidden = pages.length === 0;
    $("pdfEmpty").hidden = pages.length > 0;
    const files = new Set(pages.map((p) => p.src)).size;
    $("pdfCount").textContent = pages.length ? `${pages.length} ページ(${files} ファイルから)` : "";
    ["pdfSave", "pdfSplit", "pdfImages"].forEach((id) => { $(id).disabled = busy || !pages.length || !downloads; });
    $("pdfClear").disabled = busy;
  }

  function pageCard(p, i) {
    const src = sources.get(p.src);
    const el = document.createElement("article");
    el.className = "page";
    el.dataset.page = p.id;
    el.draggable = true;
    const label = src.kind === "pdf" ? `${src.name} p.${p.index + 1}` : src.name;
    el.innerHTML = `
      <div class="page-thumb"><img alt=""></div>
      <div class="page-label"><b>${i + 1}</b><span></span></div>
      <div class="page-tools">
        <button type="button" class="l" aria-label="前へ" title="前へ">←</button>
        <button type="button" class="r" aria-label="後ろへ" title="後ろへ">→</button>
        <button type="button" class="rot" aria-label="右に回転" title="右に回転">↻</button>
        <button type="button" class="x" aria-label="このページを外す" title="外す">×</button>
      </div>`;
    const img = el.querySelector("img");
    img.alt = `${i + 1} ページ目`;
    if (p.thumb) img.src = p.thumb;
    img.style.transform = `rotate(${p.rot}deg)`;
    el.querySelector(".page-label span").textContent = label;
    el.querySelector(".page-label span").title = label;
    el.querySelector(".l").disabled = i === 0;
    el.querySelector(".r").disabled = i === pages.length - 1;
    el.querySelector(".l").onclick = () => move(i, i - 1);
    el.querySelector(".r").onclick = () => move(i, i + 1);
    el.querySelector(".rot").onclick = () => { p.rot = (p.rot + 90) % 360; img.style.transform = `rotate(${p.rot}deg)`; };
    el.querySelector(".x").onclick = () => removePage(i);
    el.addEventListener("dragstart", (e) => { dragId = p.id; el.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(p.id)); });
    el.addEventListener("dragend", () => { dragId = null; el.classList.remove("dragging"); document.querySelectorAll(".page.drop-before").forEach((x) => x.classList.remove("drop-before")); });
    el.addEventListener("dragover", (e) => { if (dragId == null) return; e.preventDefault(); el.classList.add("drop-before"); });
    el.addEventListener("dragleave", () => el.classList.remove("drop-before"));
    el.addEventListener("drop", (e) => {
      if (dragId == null) return;
      e.preventDefault(); e.stopPropagation();
      const from = pages.findIndex((x) => x.id === dragId), to = pages.findIndex((x) => x.id === p.id);
      if (from >= 0 && to >= 0 && from !== to) move(from, from < to ? to - 1 : to);
    });
    return el;
  }

  function move(from, to) {
    if (to < 0 || to >= pages.length) return;
    const [p] = pages.splice(from, 1);
    pages.splice(to, 0, p);
    render();
    document.querySelector(`[data-page="${p.id}"] .${to < from ? "l" : "r"}`)?.focus();
  }

  function removePage(i) {
    const [p] = pages.splice(i, 1);
    if (!pages.some((x) => x.src === p.src)) dropSource(p.src);
    if (p.thumb && sources.get(p.src)?.kind !== "img") URL.revokeObjectURL(p.thumb);
    render();
    say(pages.length ? `${i + 1} ページ目を外しました。` : "");
  }

  function dropSource(id) {
    const s = sources.get(id);
    s?.pjs?.destroy();
    sources.delete(id);
  }

  // 画像ページの用紙サイズ(pt)。「画像に合わせる」は長い辺を A4 の長い辺にそろえる
  function imagePageSize(w, h) {
    if (pageSize === "a4") return h >= w ? [595.28, 841.89] : [841.89, 595.28];
    const k = 841.89 / Math.max(w, h);
    return [w * k, h * k];
  }

  async function buildPdf(list) {
    const { PDFDocument, degrees } = await loadPdfLib();
    const doc = await PDFDocument.create();
    const loaded = new Map();
    for (const p of list) {
      const src = sources.get(p.src);
      if (src.kind === "pdf") {
        if (!loaded.has(p.src)) loaded.set(p.src, await PDFDocument.load(src.bytes, { ignoreEncryption: true }));
        const [page] = await doc.copyPages(loaded.get(p.src), [p.index]);
        page.setRotation(degrees((page.getRotation().angle + p.rot) % 360));
        doc.addPage(page);
      } else {
        const img = await doc.embedJpg(await src.jpg.arrayBuffer());
        const [pw, ph] = imagePageSize(src.w, src.h);
        const page = doc.addPage([pw, ph]);
        const m = pageSize === "a4" ? 24 : 0;
        const k = Math.min((pw - m * 2) / src.w, (ph - m * 2) / src.h);
        const w = src.w * k, h = src.h * k;
        page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        page.setRotation(degrees(p.rot));
      }
    }
    return new Blob([await doc.save()], { type: "application/pdf" });
  }

  // 1 ページを画像にする。PDF は約 144 dpi(長い辺 4000px まで)
  async function pageToPng(p) {
    const src = sources.get(p.src);
    let c;
    if (src.kind === "pdf") {
      const page = await src.pjs.getPage(p.index + 1);
      const vp0 = page.getViewport({ scale: 1 });
      const scale = Math.min(2, 4000 / Math.max(vp0.width, vp0.height));
      const vp = page.getViewport({ scale, rotation: (page.rotate + p.rot) % 360 });
      c = document.createElement("canvas");
      c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
    } else {
      const bmp = await createImageBitmap(src.jpg);
      const turn = p.rot % 180 !== 0;
      c = document.createElement("canvas");
      c.width = turn ? bmp.height : bmp.width; c.height = turn ? bmp.width : bmp.height;
      const ctx = c.getContext("2d");
      ctx.translate(c.width / 2, c.height / 2);
      ctx.rotate(p.rot * Math.PI / 180);
      ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
      bmp.close();
    }
    return canvasToBlob(c, "image/png");
  }

  const baseName = () => {
    const names = [...new Set(pages.map((p) => sources.get(p.src).name))];
    return names.length === 1 ? stemOf(names[0]) : `pdfpon_${stampNow()}`;
  };

  async function run(label, job) {
    if (busy || !pages.length) return;
    busy = true; render();
    try { await job(); }
    catch (e) { console.error(label, e); say(`${label}できませんでした(${e?.message || e})。`); }
    finally { busy = false; render(); renderThumbs(); }
  }

  $("pdfSave").onclick = () => run("PDF を保存", async () => {
    say("PDF を作っています…");
    const blob = await buildPdf(pages);
    const single = new Set(pages.map((p) => p.src)).size === 1;
    await saveFile(`${baseName()}${single ? "_edit" : ""}.pdf`, blob, say);
  });

  $("pdfSplit").onclick = () => run("1 ページずつ保存", async () => {
    const zip = new JSZip(), base = baseName();
    for (let i = 0; i < pages.length; i++) {
      say(`1 ページずつ PDF にしています… ${i + 1} / ${pages.length}`);
      zip.file(`${base}_p${String(i + 1).padStart(3, "0")}.pdf`, await buildPdf([pages[i]]));
    }
    await saveFile(`${base}_pages.zip`, await zip.generateAsync({ type: "blob" }), say);
  });

  $("pdfImages").onclick = () => run("画像で保存", async () => {
    const zip = new JSZip(), base = baseName();
    for (let i = 0; i < pages.length; i++) {
      say(`ページを画像にしています… ${i + 1} / ${pages.length}`);
      zip.file(`${base}_p${String(i + 1).padStart(3, "0")}.png`, await pageToPng(pages[i]));
    }
    await saveFile(`${base}_images.zip`, await zip.generateAsync({ type: "blob", compression: "STORE" }), say);
  });

  $("pdfClear").onclick = () => {
    pages.forEach((p) => p.thumb && URL.revokeObjectURL(p.thumb));
    [...sources.keys()].forEach(dropSource);
    pages = [];
    thumbRun++;
    say("");
    render();
  };

  document.querySelectorAll("#pdfSizes button").forEach((b) => b.onclick = () => {
    pageSize = b.dataset.s;
    document.querySelectorAll("#pdfSizes button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  });
  document.addEventListener("downloads-ready", render);
  wireDrop($("pdfDrop"), $("pdfFile"), $("pdfPick"), addFiles);
  render();
})();
