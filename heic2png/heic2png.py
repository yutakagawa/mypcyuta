#!/usr/bin/env python3
"""HEIC/HEIF 画像を PNG に変換するツール。

使い方:
    python heic2png.py photo.heic                 # photo.png を同じフォルダに出力
    python heic2png.py a.heic b.heic -o out/      # 出力先フォルダを指定
    python heic2png.py photos/ -r                 # フォルダ内を再帰的に一括変換
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
    from pillow_heif import register_heif_opener
except ImportError:
    sys.exit("必要なライブラリがありません: pip install -r requirements.txt")

register_heif_opener()

HEIC_EXTS = {".heic", ".heif", ".hif"}


def collect(inputs, recursive):
    """引数のファイル/フォルダから HEIC ファイルの一覧を (ファイル, 基準フォルダ) で返す。"""
    for p in map(Path, inputs):
        if p.is_dir():
            pattern = "**/*" if recursive else "*"
            for f in sorted(p.glob(pattern)):
                if f.is_file() and f.suffix.lower() in HEIC_EXTS:
                    yield f, p
        elif p.is_file():
            yield p, p.parent
        else:
            print(f"見つかりません: {p}", file=sys.stderr)


def convert(src, dst, overwrite):
    if dst.exists() and not overwrite:
        print(f"スキップ (既に存在): {dst}")
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(src) as img:
        exif = img.info.get("exif")
        icc = img.info.get("icc_profile")
        if img.mode not in ("RGB", "RGBA", "L", "LA"):
            img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        kwargs = {}
        if exif:
            kwargs["exif"] = exif
        if icc:
            kwargs["icc_profile"] = icc
        img.save(dst, "PNG", **kwargs)
    print(f"変換しました: {src} -> {dst}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="HEIC/HEIF 画像を PNG に変換します。")
    ap.add_argument("inputs", nargs="+", help="HEIC ファイルまたはフォルダ")
    ap.add_argument("-o", "--output", help="出力先フォルダ (省略時は元ファイルと同じ場所)")
    ap.add_argument("-r", "--recursive", action="store_true", help="フォルダを再帰的に探索")
    ap.add_argument("-f", "--force", action="store_true", help="既存の PNG を上書き")
    args = ap.parse_args(argv)

    out_dir = Path(args.output) if args.output else None
    ok = failed = 0
    for src, base in collect(args.inputs, args.recursive):
        rel = src.relative_to(base).with_suffix(".png")
        dst = out_dir / rel if out_dir else src.with_suffix(".png")
        try:
            convert(src, dst, args.force)
            ok += 1
        except Exception as e:
            print(f"失敗: {src}: {e}", file=sys.stderr)
            failed += 1

    if ok == 0 and failed == 0:
        print("変換対象の HEIC ファイルがありません。", file=sys.stderr)
        return 1
    print(f"完了: {ok} 件成功, {failed} 件失敗")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
