# fonts/ について

アンケート用紙の、感想とお名前の手書き文字に使うフォント **TekitouPoem** を、必要な文字だけに絞って置いています。

| ファイル | 内容 |
|---|---|
| `TekitouPoem-base.woff2` | 感想のネタで使う文字、かな、英数字、記号（約70KB）。必ず読み込む |
| `TekitouPoem-kanji.woff2` | 上に入っていない、JIS第1水準の漢字（約500KB）。お名前などで、上にない漢字が使われたときだけ読み込む |
| `tekitoupoem.css` | 上の2つを、どの文字で読み込むか（`unicode-range`）を決める。`tools/build-font-subsets.py` が作る |
| `OFL.txt` | ライセンス文（SIL Open Font License 1.1） |

## 出典・ライセンス

- **TekitouPoem** — Copyright (c) 2023 Cockatrice Digital（作者: Hagi42）
- 配布元: https://github.com/Hagi42/TekitouPoem-Font
- ライセンス: SIL Open Font License, Version 1.1（`OFL.txt`）。商用利用・Webフォント化・加工して配ることが認められている。作者の説明ファイルにも「Webフォント化もOKです」と書かれている。
- ここにあるファイルは、元のフォントから文字を取り出した**加工版**。元のフォント（`TekitouPoem.ttf`、約5MB）は、このリポジトリには入れていない。

## 作り直すとき

`reel-data.js` に新しい文字（元のファイルにない漢字など）が増えたら、元のフォントを用意して、次を実行します。

```bash
python -m venv .venv
.venv/Scripts/pip install fonttools brotli
.venv/Scripts/python tools/build-font-subsets.py --font path/to/TekitouPoem.ttf
```

作り直したら、`index.html` の `?v=` の版番号を新しくします。
