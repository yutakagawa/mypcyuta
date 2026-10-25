# heic2png

iPhone などで撮影した HEIC/HEIF 画像を PNG に変換するコマンドラインツールです。
EXIF 情報と ICC カラープロファイルは PNG に引き継がれます。

## インストール

```bash
pip install -r requirements.txt
```

## 使い方

```bash
# 1 ファイルを変換 (同じフォルダに photo.png が作られます)
python heic2png.py photo.heic

# 複数ファイルを指定フォルダに出力
python heic2png.py a.heic b.heic -o converted/

# フォルダ内の HEIC をまとめて変換 (-r でサブフォルダも)
python heic2png.py ~/Pictures/iphone -r -o ~/Pictures/png

# 既存の PNG を上書き
python heic2png.py photo.heic -f
```

| オプション | 説明 |
| --- | --- |
| `-o, --output` | 出力先フォルダ (省略時は元ファイルと同じ場所) |
| `-r, --recursive` | フォルダをサブフォルダまで探索 |
| `-f, --force` | 同名の PNG があっても上書き |

対応拡張子: `.heic` `.heif` `.hif` (大文字小文字は問いません)
