// ピクポン: 画像の変換と編集(モザイク・トリミング・回転)
const items = [];
document.addEventListener("downloads-ready", () => refresh());

// eval を使わない CSP 対応版の libheif。必要になったときだけ読み込む
const HEIC_LIB_URL = "https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/csp/heic-to.min.js";
let heicLib;
const loadHeicLib = () => (heicLib ??= import(HEIC_LIB_URL).catch((e) => { heicLib = null; throw e; }));

const HEIC_RE = /\.(heic|heif|hif)$/i;
const IMAGE_RE = /\.(heic|heif|hif|jpe?g|jfif|png|apng|webp|avif|gif|bmp|dib|tiff?|svgz?|ico|cur|jxl)$/i;
const extOf = (f) => (f.name.match(/\.([^.]+)$/)?.[1] || "").toUpperCase();
function fileKind(f) {
  if (HEIC_RE.test(f.name) || /heic|heif/.test(f.type)) return "heic";
  if (/\.tiff?$/i.test(f.name) || f.type === "image/tiff") return "tiff";
  if (/\.svgz?$/i.test(f.name) || f.type === "image/svg+xml") return "svg";
  return "other";
}

// TIFF は Safari 以外のブラウザで読めないので、必要になったときだけ UTIF(と圧縮の展開に使う pako)を読み込む
const PAKO_URL = "https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako_inflate.min.js";
const UTIF_URL = "https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js";
let tiffLib;
const loadTiffLib = () => (tiffLib ??= loadScript(PAKO_URL).then(() => loadScript(UTIF_URL)).then(() => window.UTIF)
  .catch((e) => { tiffLib = null; e.libLoad = true; throw e; }));
const pngName = (name) => name.replace(/\.[^.]+$/, "") + ".png";

// ---- 保存形式 ----
const FORMATS = { png: { mime: "image/png", ext: ".png", label: "PNG" }, jpeg: { mime: "image/jpeg", ext: ".jpg", label: "JPEG" }, webp: { mime: "image/webp", ext: ".webp", label: "WebP" } };
const canWebp = (() => { try { return document.createElement("canvas").toDataURL("image/webp").startsWith("data:image/webp"); } catch { return false; } })();
const out = { format: "png", quality: 90, maxSide: 0 };
try { Object.assign(out, JSON.parse(localStorage.getItem("pikupon:out") || "{}")); } catch {}
if (!FORMATS[out.format] || (out.format === "webp" && !canWebp)) out.format = "png";
const fmt = () => FORMATS[out.format];
const encKey = () => `${out.format}:${out.format === "png" ? "" : out.quality}:${out.maxSide}`;
// 長い辺が上限を超えるときだけ縮小する(拡大はしない)
function outDims(item) {
  const k = out.maxSide && Math.max(item.w, item.h) > out.maxSide ? out.maxSide / Math.max(item.w, item.h) : 1;
  return { w: Math.max(1, Math.round(item.w * k)), h: Math.max(1, Math.round(item.h * k)), scaled: k < 1 };
}
const isPassThrough = (item) => out.format === "png" && !outDims(item).scaled;
const cachedBlob = (item) => isPassThrough(item) ? item.png : item.enc?.key === encKey() && item.enc.src === item.png ? item.enc.blob : null;
const outName = (item) => item.out.replace(/\.png$/i, fmt().ext);

// PNG を基準に持ち、保存のときに選んだ形式へ書き出す(canvas を通すので撮影情報は残らない)
async function encode(item) {
  const hit = cachedBlob(item);
  if (hit) return hit;
  const key = encKey(), d = outDims(item);
  const bmp = await createImageBitmap(item.png);
  const c = document.createElement("canvas");
  c.width = d.w; c.height = d.h;
  const ctx = c.getContext("2d");
  // JPEG は透明を持てないので白で塗ってから描く
  if (out.format === "jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height); }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, d.w, d.h);
  bmp.close();
  const blob = await new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error(`${fmt().label} を作れませんでした`)), fmt().mime, out.quality / 100));
  item.enc = { key, src: item.png, blob };
  return blob;
}

// 形式や画質を変えたら、各カードの保存後サイズを順に計算し直す
let sizeRun = 0;
async function updateSizes() {
  const run = ++sizeRun;
  for (const item of items.filter((i) => i.png)) {
    if (run !== sizeRun) return;
    try { await encode(item); } catch {}
    if (run === sizeRun) renderInfo(item);
  }
}

function renderInfo(item) {
  const el = item.el?.querySelector(".info");
  if (!el) return;
  if (!item.png) { el.textContent = fmtSize(item.file.size); return; }
  const blob = cachedBlob(item), d = outDims(item);
  el.textContent = `${extOf(item.file) || "画像"} → ${fmt().label} · ${d.w}×${d.h} · ${fmtSize(item.file.size)} → ${blob ? fmtSize(blob.size) : "計算中…"}`;
  item.el.querySelector(".name").textContent = outName(item);
}

function setFormat(f) {
  out.format = f;
  document.querySelectorAll("#formats button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.f === f));
  $("qualityBox").hidden = f === "png";
  try { localStorage.setItem("pikupon:out", JSON.stringify(out)); } catch {}
  items.forEach((i) => i.el && renderCard(i));
  updateSizes();
}

// ファイル内の Exif ブロック(JPEG・HEIC 共通の "Exif\0\0" + TIFF)を探し、GPS の緯度が入っているかだけ調べる
async function detectGps(item) {
  try {
    const buf = new Uint8Array(await item.file.arrayBuffer());
    for (let i = buf.indexOf(0x45); i !== -1 && i < buf.length - 14; i = buf.indexOf(0x45, i + 1)) {
      if (buf[i + 1] !== 0x78 || buf[i + 2] !== 0x69 || buf[i + 3] !== 0x66 || buf[i + 4] || buf[i + 5]) continue;
      if (hasGpsLatitude(new DataView(buf.buffer, i + 6))) { item.gps = true; return; }
    }
  } catch {}
  item.gps = false;
}

function hasGpsLatitude(v) {
  const le = v.getUint16(0) === 0x4949;
  if (!le && v.getUint16(0) !== 0x4d4d) return false;
  const u16 = (o) => v.getUint16(o, le), u32 = (o) => v.getUint32(o, le);
  const findTag = (ifd, tag) => {
    const n = u16(ifd);
    for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (u16(e) === tag) return e; }
    return -1;
  };
  const gpsPtr = findTag(u32(4), 0x8825);
  if (gpsPtr < 0) return false;
  const lat = findTag(u32(gpsPtr + 8), 0x0002);
  if (lat < 0) return false;
  // 緯度は分数 3 つ。全部 0 なら位置情報なしとみなす
  const off = u32(lat + 8);
  for (let k = 0; k < 3; k++) if (u32(off + k * 8) !== 0) return true;
  return false;
}

function toast(msg) { $("toast").textContent = msg; }

function refresh() {
  const done = items.filter((i) => i.png).length;
  const failed = items.filter((i) => i.error).length;
  $("results").hidden = items.length === 0;
  $("empty").hidden = items.length > 0;
  $("mosaicHint").hidden = items.length > 0;
  $("count").textContent = `${items.length} 枚中 ${done} 枚変換済み` + (failed ? ` · ${failed} 枚失敗` : "");
  $("saveAll").disabled = !downloads || done === 0;
  $("saveAll").title = downloads ? "" : "このビューではファイル保存が使えません";
}

function renderCard(item) {
  const card = item.el || document.createElement("article");
  card.className = "card";
  const edits = editLabels(item);
  const status = item.png ? `<span class="pill ok">${[fmt().label, ...edits].join(" · ")}</span>` : item.error ? '<span class="pill err">失敗</span>' : '<span class="pill wait">変換中</span>';
  card.innerHTML = `
    <div class="thumb">${item.url ? "" : item.error ? "" : '<div class="spin"></div>'}<button class="del" type="button" aria-label="この写真を外す" title="外す"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="meta">
      <div class="name"></div>
      <div class="info"></div>
      ${item.gps ? '<div class="gps">位置情報あり → 保存時に削除</div>' : ""}
      ${item.error ? '<div class="err-msg"></div>' : ""}
      <div class="row">${status}<span class="card-actions"><button class="save mosaic" type="button" ${item.png ? "" : "disabled"}>モザイク・編集</button><button class="save dl" type="button" ${item.png && downloads ? "" : "disabled"}>保存</button></span></div>
    </div>`;
  if (item.url) { const img = new Image(); img.src = item.url; img.alt = outName(item); card.querySelector(".thumb").append(img); }
  card.querySelector(".name").textContent = item.file.name;
  item.el = card;
  renderInfo(item);
  if (item.error) card.querySelector(".err-msg").textContent = item.error;
  card.querySelector(".dl").onclick = () => save(item);
  card.querySelector(".mosaic").onclick = () => openEditor(item);
  card.querySelector(".del").onclick = () => removeItem(item);
  return card;
}

const KIND_LABELS = { mosaic: "モザイク", blur: "ぼかし", fill: "黒塗り" };
function editLabels(item) {
  const kinds = [...new Set((item.strokes || []).map((st) => st.kind || "mosaic"))].map((k) => KIND_LABELS[k]);
  return [item.turned && "回転", ...kinds, item.crop && "トリミング"].filter(Boolean);
}

// 1 枚だけ一覧から外す(変換中のものは変換が終わっても表示しない)
function removeItem(item) {
  if (ed.item === item) closeEditor();
  const i = items.indexOf(item);
  if (i < 0) return;
  items.splice(i, 1);
  item.removed = true;
  if (item.url) URL.revokeObjectURL(item.url);
  const next = items[i] || items[i - 1];
  item.el?.remove();
  toast(`${item.file.name} を外しました。`);
  refresh();
  (next?.el?.querySelector(".del") || $("pick")).focus();
}

async function convert(item) {
  try {
    item.png = await decodeToPng(item.file);
    item.url = URL.createObjectURL(item.png);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = item.url; });
    item.w = img.naturalWidth; item.h = img.naturalHeight;
    await detectGps(item);
  } catch (e) {
    console.error("convert failed", item.file.name, e);
    item.error = e?.libLoad
      ? "変換ライブラリを読み込めませんでした。通信状況を確認して、もう一度ファイルを選んでください。"
      : `読み込めませんでした。${e?.message || e}。`;
  }
  if (item.removed) return;
  renderCard(item); refresh();
  if (item.png && !isPassThrough(item)) updateSizes();
}

// まずブラウザ自身で読む。読めなければ形式ごとの方法に切り替える
async function decodeToPng(file) {
  const kind = fileKind(file);
  if (kind === "svg") return imgToPng(file, true);
  try { return await nativeToPng(file); } catch {}
  if (kind === "heic") return libToPng(file);
  if (kind === "tiff") return tiffToPng(file);
  try { return await imgToPng(file, false); } catch {}
  const ext = extOf(file);
  // どのブラウザでも読めるはずの形式なら、ファイル自体の問題
  if (/^(JPE?G|JFIF|PNG|GIF|WEBP|BMP|ICO)$/.test(ext) || !ext) throw new Error("ファイルが壊れているか、中身が画像ではありません");
  throw new Error(`${ext} 形式はこのブラウザでは読めません。Safari で開くか、別の形式に書き出してから試してください`);
}

const canvasToPng = (c) => new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("PNG を作れませんでした")), "image/png"));

async function nativeToPng(file) {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  return canvasToPng(c);
}

// <img> でしか読めない形式(SVG など)。SVG は小さいと粗くなるので長い辺 1024px 以上で描く
async function imgToPng(file, isSvg) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("画像として読めませんでした")); i.src = url; });
    let w = img.naturalWidth || 1024, h = img.naturalHeight || 1024;
    if (isSvg && Math.max(w, h) < 1024) { const k = 1024 / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(img, 0, 0, w, h);
    return canvasToPng(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function tiffToPng(file) {
  const UTIF = await loadTiffLib();
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  // 複数ページのときは 1 ページ目
  const page = ifds[0];
  if (!page) throw new Error("TIFF の中に画像が見つかりませんでした");
  UTIF.decodeImage(buf, page, ifds);
  const rgba = UTIF.toRGBA8(page);
  const c = document.createElement("canvas");
  c.width = page.width; c.height = page.height;
  c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.length), page.width, page.height), 0, 0);
  return canvasToPng(c);
}

// ---- 編集(モザイク・トリミング) ----
// 各スタンプは { shape, size, block, pts } として記録し、元画像から再生して描く(元に戻す・やり直しが軽い)
const ed = { item: null, base: null, strokes: [], cur: null, small: new Map(), shape: "circle", kind: "mosaic", drawing: false, mode: "mosaic", crop: null, cropHist: [], ratio: 0, drag: null, turned: false };
const edCanvas = $("edCanvas"), edCtx = edCanvas.getContext("2d"), edRing = $("edRing");
const shortSide = () => Math.min(edCanvas.width, edCanvas.height);
const brushPx = () => Math.max(4, $("edSize").value / 100 * shortSide());
const blockPx = () => Math.max(2, Math.round($("edBlock").value / 100 * shortSide()));

// ブロックサイズごとに縮小画像を 1 枚作り、拡大表示するとモザイクになる
function smallFor(b) {
  if (!ed.small.has(b)) {
    const c = document.createElement("canvas");
    c.width = Math.ceil(ed.base.width / b); c.height = Math.ceil(ed.base.height / b);
    c.getContext("2d").drawImage(ed.base, 0, 0, ed.base.width / b, ed.base.height / b);
    ed.small.set(b, c);
  }
  return ed.small.get(b);
}

// モザイクは縮小画像をそのまま拡大、ぼかしは同じ縮小画像をなめらかに拡大、黒塗りは塗りつぶす
function stamp(x, y, st) {
  const kind = st.kind || "mosaic", r = st.size / 2;
  edCtx.save();
  edCtx.beginPath();
  if (st.shape === "circle") edCtx.arc(x, y, r, 0, Math.PI * 2); else edCtx.rect(x - r, y - r, st.size, st.size);
  edCtx.clip();
  if (kind === "fill") {
    edCtx.fillStyle = "#000000";
    edCtx.fillRect(x - r, y - r, st.size, st.size);
  } else {
    const b = st.block, small = smallFor(b);
    // ぼかしは縁がにじむので 1 マス広めに取る
    const m = kind === "blur" ? b : 0;
    const x0 = Math.max(0, Math.floor((x - r - m) / b) * b), y0 = Math.max(0, Math.floor((y - r - m) / b) * b);
    const x1 = Math.min(small.width * b, Math.ceil((x + r + m) / b) * b), y1 = Math.min(small.height * b, Math.ceil((y + r + m) / b) * b);
    if (x1 > x0 && y1 > y0) {
      edCtx.imageSmoothingEnabled = kind === "blur";
      edCtx.imageSmoothingQuality = "high";
      edCtx.drawImage(small, x0 / b, y0 / b, (x1 - x0) / b, (y1 - y0) / b, x0, y0, x1 - x0, y1 - y0);
    }
  }
  edCtx.restore();
}

// 画面に収まるよう表示サイズだけ合わせる(描画は元の解像度のまま)
function fitCanvas() {
  if ($("editor").hidden || !ed.base) return;
  const s = $("edStage").getBoundingClientRect();
  // 四隅のつまみが切れないよう、まわりに少し余白を残す
  const pad = 24;
  const k = Math.min((s.width - pad) / edCanvas.width, (s.height - pad) / edCanvas.height);
  edCanvas.style.width = edCanvas.width * k + "px";
  edCanvas.style.height = edCanvas.height * k + "px";
  layoutCrop();
}
window.addEventListener("resize", fitCanvas);

function redraw() {
  edCtx.drawImage(ed.base, 0, 0);
  for (const st of ed.strokes) for (const [x, y] of st.pts) stamp(x, y, st);
  $("edUndo").disabled = $("edReset").disabled = ed.strokes.length === 0;
}

async function openEditor(item) {
  if (!item.png) return;
  item.basePng ??= item.png;
  const bmp = await createImageBitmap(item.basePng);
  const base = document.createElement("canvas");
  base.width = bmp.width; base.height = bmp.height;
  base.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  Object.assign(ed, { item, base, strokes: (item.strokes || []).slice(), cur: null, drawing: false, crop: item.crop ? { ...item.crop } : null, cropHist: [], drag: null, turned: false });
  ed.small.clear();
  edCanvas.width = base.width; edCanvas.height = base.height;
  $("edTitle").textContent = `編集 · ${outName(item)}`;
  redraw();
  $("editor").hidden = false;
  document.body.style.overflow = "hidden";
  setMode(ed.mode);
  applyRatio(0);
  updateCropUndo();
  $("edDone").focus();
}

function closeEditor() {
  $("editor").hidden = true;
  document.body.style.overflow = "";
  edRing.hidden = true;
  ed.base = null; ed.small.clear();
  ed.item?.el?.querySelector(".mosaic")?.focus();
  ed.item = null;
}

async function finishEditor() {
  const item = ed.item;
  if (!item) return;
  $("edDone").disabled = true;
  try {
    const crop = isFullCrop(ed.crop) ? null : ed.crop;
    const toPng = (c) => new Promise((res, rej) => c.toBlob((b) => b ? res(b) : rej(new Error("PNG を作れませんでした")), "image/png"));
    // 回転・反転は元画像そのものに反映し、次に開いたときの基準にする
    if (ed.turned) { item.basePng = await toPng(ed.base); item.turned = true; }
    let result = edCanvas;
    if (crop) {
      result = document.createElement("canvas");
      result.width = crop.w; result.height = crop.h;
      result.getContext("2d").drawImage(edCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
    }
    const blob = ed.strokes.length || crop ? await toPng(result) : item.basePng;
    URL.revokeObjectURL(item.url);
    item.png = blob; item.url = URL.createObjectURL(blob); item.strokes = ed.strokes.slice(); item.crop = crop;
    item.w = result.width; item.h = result.height;
    closeEditor();
    renderCard(item); refresh();
    const edits = editLabels(item);
    if (!isPassThrough(item)) updateSizes();
    toast(edits.length ? `${outName(item)} に${edits.join("・")}を反映しました。` : `${outName(item)} を元の画像に戻しました。`);
  } catch (e) {
    toast(`編集を保存できませんでした (${e?.message || e})。`);
  } finally {
    $("edDone").disabled = false;
  }
}

function toImage(e) {
  const r = edCanvas.getBoundingClientRect();
  return [(e.clientX - r.left) * edCanvas.width / r.width, (e.clientY - r.top) * edCanvas.height / r.height];
}

function moveRing(e) {
  const c = edCanvas.getBoundingClientRect(), s = $("edStage").getBoundingClientRect();
  const d = brushPx() * c.width / edCanvas.width;
  Object.assign(edRing.style, {
    width: d + "px", height: d + "px", borderRadius: ed.shape === "circle" ? "50%" : "2px",
    transform: `translate(${e.clientX - s.left - d / 2}px, ${e.clientY - s.top - d / 2}px)`,
  });
  edRing.hidden = false;
}

edCanvas.addEventListener("pointerdown", (e) => {
  if (ed.mode !== "mosaic") return;
  e.preventDefault();
  edCanvas.setPointerCapture(e.pointerId);
  moveRing(e);
  const [x, y] = toImage(e);
  ed.cur = { kind: ed.kind, shape: ed.shape, size: brushPx(), block: blockPx(), pts: [[x, y]] };
  ed.strokes.push(ed.cur);
  ed.drawing = true;
  stamp(x, y, ed.cur);
  $("edUndo").disabled = $("edReset").disabled = false;
});
edCanvas.addEventListener("pointermove", (e) => {
  if (ed.mode !== "mosaic") return;
  moveRing(e);
  if (!ed.drawing) return;
  const [x, y] = toImage(e), st = ed.cur, [lx, ly] = st.pts[st.pts.length - 1];
  const dist = Math.hypot(x - lx, y - ly), step = st.size * 0.3;
  for (let t = step; t <= dist; t += step) {
    const p = [lx + (x - lx) * t / dist, ly + (y - ly) * t / dist];
    st.pts.push(p); stamp(p[0], p[1], st);
  }
});
const endStroke = () => { ed.drawing = false; ed.cur = null; };
edCanvas.addEventListener("pointerup", endStroke);
edCanvas.addEventListener("pointercancel", endStroke);
edCanvas.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") edRing.hidden = true; });

function setShape(shape) {
  ed.shape = shape;
  $("shapeCircle").setAttribute("aria-pressed", shape === "circle");
  $("shapeSquare").setAttribute("aria-pressed", shape === "square");
}
$("shapeCircle").onclick = () => setShape("circle");
$("shapeSquare").onclick = () => setShape("square");
function setKind(kind) {
  ed.kind = kind;
  document.querySelectorAll("#kinds button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.k === kind));
  $("blockBox").hidden = kind === "fill";
  $("blockLbl").textContent = kind === "blur" ? "強さ" : "粗さ";
}
document.querySelectorAll("#kinds button").forEach((b) => b.onclick = () => setKind(b.dataset.k));

// ---- 回転・反転 ----
// 元画像を回し、記録済みのスタンプとトリミング枠の座標も同じように動かす
function turn(kind) {
  if (!ed.base) return;
  const W = ed.base.width, H = ed.base.height;
  const map = kind === "cw" ? ([x, y]) => [H - y, x] : kind === "ccw" ? ([x, y]) => [y, W - x] : ([x, y]) => [W - x, y];
  const c = document.createElement("canvas");
  [c.width, c.height] = kind === "flip" ? [W, H] : [H, W];
  const ctx = c.getContext("2d");
  if (kind === "cw") { ctx.translate(H, 0); ctx.rotate(Math.PI / 2); }
  else if (kind === "ccw") { ctx.translate(0, W); ctx.rotate(-Math.PI / 2); }
  else { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(ed.base, 0, 0);
  const mapRect = (r) => {
    if (!r) return r;
    const [ax, ay] = map([r.x, r.y]), [bx, by] = map([r.x + r.w, r.y + r.h]);
    return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
  };
  ed.strokes = ed.strokes.map((st) => ({ ...st, pts: st.pts.map(map) }));
  ed.crop = mapRect(ed.crop);
  ed.cropHist = ed.cropHist.map(mapRect);
  ed.base = c; ed.small.clear(); ed.turned = true;
  edCanvas.width = c.width; edCanvas.height = c.height;
  if (ed.ratio && kind !== "flip") applyRatio(0);
  redraw();
  fitCanvas();
}
$("rotL").onclick = () => turn("ccw");
$("rotR").onclick = () => turn("cw");
$("flipH").onclick = () => turn("flip");

$("edUndo").onclick = () => { ed.strokes.pop(); redraw(); };
$("edReset").onclick = () => { ed.strokes = []; redraw(); };
// ---- トリミング ----
// 枠は元画像の座標 {x, y, w, h} で持ち、表示のたびに画面座標へ変換する
const cropBox = $("cropBox");
const isFullCrop = (c) => !c || (c.x === 0 && c.y === 0 && c.w === edCanvas.width && c.h === edCanvas.height);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const HINTS = {
  mosaic: "隠したい所をタップしてスタンプ。なぞると続けてかけられます。モザイク・ぼかし・黒塗りから選べます。",
  crop: "枠をドラッグして移動、四隅をドラッグして大きさを変えます。",
};

function setMode(mode) {
  ed.mode = mode;
  $("modeMosaic").setAttribute("aria-pressed", mode === "mosaic");
  $("modeCrop").setAttribute("aria-pressed", mode === "crop");
  $("mosaicTools").hidden = mode !== "mosaic";
  $("cropTools").hidden = mode !== "crop";
  $("edStage").classList.toggle("cropping", mode === "crop");
  $("edHint").textContent = HINTS[mode];
  edRing.hidden = true;
  if (mode === "crop" && !ed.crop) ed.crop = { x: 0, y: 0, w: edCanvas.width, h: edCanvas.height };
  fitCanvas();
}

function layoutCrop() {
  const show = ed.crop && (ed.mode === "crop" || !isFullCrop(ed.crop));
  cropBox.hidden = !show;
  $("cropSize").textContent = ed.crop ? `${ed.crop.w} × ${ed.crop.h} px` : "";
  if (!show) return;
  const c = edCanvas.getBoundingClientRect(), s = $("edStage").getBoundingClientRect(), k = c.width / edCanvas.width;
  Object.assign(cropBox.style, {
    width: ed.crop.w * k + "px", height: ed.crop.h * k + "px",
    transform: `translate(${c.left - s.left + ed.crop.x * k}px, ${c.top - s.top + ed.crop.y * k}px)`,
  });
}

// 縦横比を指定したら、今の枠の中心に収まる最大の枠にする
function applyRatio(r) {
  ed.ratio = r;
  document.querySelectorAll("#ratios button").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.r === r));
  if (!r) return layoutCrop();
  const W = edCanvas.width, H = edCanvas.height, c = ed.crop;
  let w = c.w, h = Math.round(w / r);
  if (h > c.h) { h = c.h; w = Math.round(h * r); }
  const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
  ed.crop = { x: Math.round(clamp(cx - w / 2, 0, W - w)), y: Math.round(clamp(cy - h / 2, 0, H - h)), w, h };
  layoutCrop();
}

cropBox.addEventListener("pointerdown", (e) => {
  if (ed.mode !== "crop") return;
  e.preventDefault();
  cropBox.setPointerCapture(e.pointerId);
  pushCrop();
  ed.drag = { kind: e.target.dataset.h || "move", start: toImage(e), rect: { ...ed.crop } };
});
cropBox.addEventListener("pointermove", (e) => {
  const d = ed.drag;
  if (!d) return;
  const W = edCanvas.width, H = edCanvas.height, [px, py] = toImage(e), r0 = d.rect;
  if (d.kind === "move") {
    ed.crop = { ...r0, x: Math.round(clamp(r0.x + px - d.start[0], 0, W - r0.w)), y: Math.round(clamp(r0.y + py - d.start[1], 0, H - r0.h)) };
  } else {
    // 掴んだ角の反対側を固定して広げる・縮める
    const ax = d.kind.includes("w") ? r0.x + r0.w : r0.x, ay = d.kind.includes("n") ? r0.y + r0.h : r0.y;
    const dx = d.kind.includes("w") ? -1 : 1, dy = d.kind.includes("n") ? -1 : 1;
    const min = Math.max(16, Math.round(Math.min(W, H) * 0.03));
    let w = clamp((px - ax) * dx, min, dx > 0 ? W - ax : ax);
    let h = clamp((py - ay) * dy, min, dy > 0 ? H - ay : ay);
    if (ed.ratio) { if (w / h > ed.ratio) w = h * ed.ratio; else h = w / ed.ratio; }
    w = Math.round(w); h = Math.round(h);
    ed.crop = { x: dx > 0 ? ax : ax - w, y: dy > 0 ? ay : ay - h, w, h };
  }
  layoutCrop();
});
const endDrag = () => { ed.drag = null; };
cropBox.addEventListener("pointerup", endDrag);
cropBox.addEventListener("pointercancel", endDrag);
// トリミング枠の「元に戻す」: 変える直前の枠を積んでおく
function pushCrop() {
  if (!ed.crop) return;
  const last = ed.cropHist[ed.cropHist.length - 1];
  if (!last || ["x", "y", "w", "h"].some((k) => last[k] !== ed.crop[k])) ed.cropHist.push({ ...ed.crop });
  if (ed.cropHist.length > 50) ed.cropHist.shift();
  updateCropUndo();
}
const updateCropUndo = () => { $("cropUndo").disabled = ed.cropHist.length === 0; };
// 動かさずに離したときは履歴を積みすぎないよう、同じ枠なら取り除く
const endDragCheck = () => {
  const last = ed.cropHist[ed.cropHist.length - 1];
  if (last && ed.crop && ["x", "y", "w", "h"].every((k) => last[k] === ed.crop[k])) { ed.cropHist.pop(); updateCropUndo(); }
};
cropBox.addEventListener("pointerup", endDragCheck);
document.querySelectorAll("#ratios button").forEach((b) => b.onclick = () => { pushCrop(); applyRatio(+b.dataset.r); endDragCheck(); });
$("cropReset").onclick = () => { pushCrop(); ed.crop = { x: 0, y: 0, w: edCanvas.width, h: edCanvas.height }; applyRatio(0); endDragCheck(); };
$("cropUndo").onclick = () => { const prev = ed.cropHist.pop(); if (prev) ed.crop = prev; updateCropUndo(); layoutCrop(); };
$("modeMosaic").onclick = () => setMode("mosaic");
$("modeCrop").onclick = () => setMode("crop");

$("edCancel").onclick = closeEditor;
$("edDone").onclick = finishEditor;
document.addEventListener("keydown", (e) => {
  if ($("editor").hidden) return;
  if (e.key === "Escape") closeEditor();
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $(ed.mode === "crop" ? "cropUndo" : "edUndo").click(); }
});

async function libToPng(file) {
  let lib;
  try { lib = await loadHeicLib(); } catch (e) { e.libLoad = true; throw e; }
  return lib.heicTo({ blob: file, type: "image/png" });
}

// 見本の画像(架空の名札と車のナンバー)を作って、そのまま編集画面を開く
async function trySample() {
  const c = document.createElement("canvas");
  c.width = 1600; c.height = 1000;
  const ctx = c.getContext("2d");
  const sky = ctx.createLinearGradient(0, 0, 0, 1000);
  sky.addColorStop(0, "#9cc8ef"); sky.addColorStop(1, "#e9f2f8");
  ctx.fillStyle = sky; ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = "#6b8f5a"; ctx.fillRect(0, 720, 1600, 280);
  // 名札
  ctx.fillStyle = "#ffffff"; ctx.fillRect(160, 220, 560, 320);
  ctx.strokeStyle = "#e9542a"; ctx.lineWidth = 14; ctx.strokeRect(160, 220, 560, 320);
  ctx.fillStyle = "#1d2a3a"; ctx.font = "bold 72px sans-serif"; ctx.fillText("見本 太郎", 220, 360);
  ctx.font = "44px sans-serif"; ctx.fillText("000-0000-0000", 220, 460);
  // 車とナンバー
  ctx.fillStyle = "#c0392b"; ctx.fillRect(900, 520, 560, 220);
  ctx.fillStyle = "#333333"; ctx.beginPath(); ctx.arc(1000, 750, 60, 0, Math.PI * 2); ctx.arc(1360, 750, 60, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(1060, 610, 240, 90);
  ctx.fillStyle = "#1a7f4b"; ctx.font = "bold 40px sans-serif"; ctx.fillText("見本 00-00", 1075, 670);
  const file = new File([await canvasToBlob(c)], "見本.png", { type: "image/png" });
  await addFiles([file]);
  const item = items.find((i) => i.file === file);
  if (item?.png) openEditor(item);
}
$("trySample").onclick = trySample;

async function addFiles(list) {
  const files = [...list];
  const images = files.filter((f) => IMAGE_RE.test(f.name) || f.type.startsWith("image/"));
  const skipped = files.length - images.length;
  toast(skipped ? `${skipped} 件は画像ではないのでスキップしました。` : "");
  for (const file of images) {
    const item = { file, out: pngName(file.name) };
    items.push(item);
    $("grid").append(renderCard(item));
  }
  refresh();
  for (const item of items.filter((i) => !i.png && !i.error && !i.started)) { item.started = true; await convert(item); }
}

async function save(item) {
  if (!downloads || !item.png) return false;
  try {
    const name = outName(item);
    await downloads.save({ filename: name, data: await encode(item) });
    toast(`${name} を保存しました。`);
    return true;
  } catch (e) {
    if (e?.code === "declined") toast("保存をキャンセルしました。");
    else if (e?.code === "rate_limited") toast("保存の確認画面が開いています。閉じてからもう一度押してください。");
    else toast("このビューではファイルを保存できません。");
    return false;
  }
}

// 同名ファイルが重なったら IMG_0001 (2).png のように番号を付ける
function uniqueNames(list) {
  const used = new Set();
  return list.map((item) => {
    const first = outName(item), ext = fmt().ext;
    let name = first, n = 2;
    while (used.has(name.toLowerCase())) name = first.slice(0, -ext.length) + ` (${n++})${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

$("saveAll").onclick = async () => {
  const done = items.filter((i) => i.png);
  if (!downloads || done.length === 0) return;
  const btn = $("saveAll");
  btn.disabled = true;
  toast(`${done.length} 枚を ZIP にまとめています…`);
  try {
    const zip = new JSZip();
    const names = uniqueNames(done);
    for (let i = 0; i < done.length; i++) {
      toast(`${fmt().label} に書き出しています… ${i + 1} / ${done.length}`);
      zip.file(names[i], await encode(done[i]));
    }
    // 画像は圧縮済みなので無圧縮で格納して速くする
    const data = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const d = new Date(), pad = (x) => String(x).padStart(2, "0");
    const filename = `pikupon_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
    await downloads.save({ filename, data });
    toast(`${done.length} 枚を ${filename} に保存しました。`);
  } catch (e) {
    if (e?.code === "declined") toast("保存をキャンセルしました。");
    else if (e?.code === "rate_limited") toast("保存の確認画面が開いています。閉じてからもう一度押してください。");
    else if (e?.code) toast("このビューではファイルを保存できません。");
    else toast(`ZIP を作れませんでした (${e?.message || e})。`);
  } finally {
    refresh();
  }
};
document.querySelectorAll("#formats button").forEach((b) => {
  if (b.dataset.f === "webp" && !canWebp) { b.disabled = true; b.title = "このブラウザは WebP の書き出しに対応していません"; }
  b.onclick = () => setFormat(b.dataset.f);
});
$("maxSide").value = String(out.maxSide);
if ($("maxSide").value !== String(out.maxSide)) { out.maxSide = 0; $("maxSide").value = "0"; }
$("maxSide").onchange = () => { out.maxSide = +$("maxSide").value; setFormat(out.format); };
$("quality").value = out.quality; $("qVal").textContent = out.quality;
$("quality").oninput = () => { $("qVal").textContent = $("quality").value; };
$("quality").onchange = () => { out.quality = +$("quality").value; setFormat(out.format); };
setFormat(out.format);

$("clear").onclick = () => {
  items.forEach((i) => i.url && URL.revokeObjectURL(i.url));
  if (!$("editor").hidden) closeEditor();
  items.length = 0; $("grid").replaceChildren(); toast(""); refresh();
};

const drop = $("drop"), input = $("file");
$("pick").onclick = (e) => { e.stopPropagation(); input.click(); };
drop.onclick = () => input.click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } };
input.onchange = () => { addFiles(input.files); input.value = ""; };
["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

refresh();
