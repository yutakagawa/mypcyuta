# ポンキット

画像・PDF・音声を、ブラウザの中だけで処理する道具箱です。ファイルはどこにも送られません。

公開中のページ: https://claude.ai/artifact/AVYNTaWKG7QtnXvbAumcJF

| ツール | できること |
| --- | --- |
| ピクポン(画像) | HEIC・TIFF・AVIF などを PNG / JPEG / WebP に変換。モザイク・ぼかし・黒塗り、トリミング、回転、リサイズ。位置情報は自動で削除 |
| PDFポン(PDF) | PDF と画像をページ単位で並べ替え・回転・削除し、1 冊の PDF / 1 ページずつの PDF / PNG 画像として保存 |
| オトポン(音声) | 音声や動画の音声を MP3 に圧縮(声・会議 / 標準 / 高音質) |

## ファイル構成

| ファイル | 役割 |
| --- | --- |
| `index.html` | 画面とスタイル |
| `common.js` | 各ツール共通の小さな道具(保存、ライブラリの読み込み、ドロップ枠) |
| `tool-image.js` | ピクポン |
| `tool-pdf.js` | PDFポン(pdf-lib, pdf.js) |
| `tool-audio.js` | オトポン(lamejs) |
| `app.js` | ツールの切り替えと「スマホで開く」QR |

外部ライブラリは jsDelivr / cdnjs から、使うときだけ読み込みます。
