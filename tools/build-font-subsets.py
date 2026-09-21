"""TekitouPoem から、この用紙で使う文字だけを取り出して、Webフォント（WOFF2）を作る。

TekitouPoem は SIL Open Font License 1.1 のフォントで、加工して配ることが認められている
（Webフォント化も、作者の説明ファイルで明記されている）。元のフォントは 5MB 以上あるので、
そのままサイトに置くと重い。そこで、次の2つのファイルに分ける。

  TekitouPoem-base.woff2   感想のネタで使う文字 + かな + 英数字 + 記号（約70KB）。必ず読み込む
  TekitouPoem-kanji.woff2  JIS第1水準の漢字のうち、上に入っていないもの（約500KB）。
                           お名前欄などで、上にない漢字が使われたときだけ、ブラウザが読み込む

読み込みの切り替えは、fonts/tekitoupoem.css の unicode-range で行う。

使い方:
  python -m venv .venv && .venv/Scripts/pip install fonttools brotli   # 初回のみ
  .venv/Scripts/python tools/build-font-subsets.py --font path/to/TekitouPoem.ttf

reel-data.js に新しい文字が増えたら、もう一度実行して、fonts/ の中身を作り直す。
"""

import argparse
import os
import re
import sys

from fontTools import subset
from fontTools.ttLib import TTFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

KANA = {chr(c) for c in range(0x3041, 0x3097)} | {chr(c) for c in range(0x30A1, 0x30FB)} | set("ー・ヽヾゝゞ")
ASCII = {chr(c) for c in range(0x20, 0x7F)}
PUNCT = set("、。，．・：；？！゛゜´｀¨＾￣＿ー―‐／＼～〜∥｜…‥‘’“”（）〔〕［］｛｝〈〉《》「」『』【】＋－±×÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓")
FULLWIDTH = (
    {chr(c) for c in range(0xFF10, 0xFF1A)}
    | {chr(c) for c in range(0xFF21, 0xFF3B)}
    | {chr(c) for c in range(0xFF41, 0xFF5B)}
)


# 初期のお名前（app.js の DEFAULT_OPTIONS.name）で使う漢字。最初から読み込むほうに入れておく
DEFAULT_NAME_CHARS = set("桶好夫") | {chr(0x3000)}  # 0x3000 は、姓と名のあいだの全角スペース

# フォントファイルの版番号。ブラウザに古いファイルを使い続けられないよう、作り直したら新しい値にする（index.html の ?v= と同じ値にする）
FONT_VERSION = "20260921y"


def reel_chars(reel_data_path):
    """reel-data.js のネタ（REEL_DATA の3本のリール）で使っている文字。公演名は、印刷用の明朝で描くので対象外。"""
    text = open(reel_data_path, encoding="utf-8").read().split("const CONCERT_TITLES")[0]
    items = re.findall(r'^\s+"([^"]+)"', text, flags=re.M)
    return set("".join(items)) | set("が、で、。")


def jis_level1_kanji():
    """JIS X 0208 の第1水準の漢字（EUC-JP の1バイト目が 0xB0〜0xCF）"""
    chars = set()
    for hi in range(0xB0, 0xD0):
        for lo in range(0xA1, 0xFF):
            try:
                chars.add(bytes([hi, lo]).decode("euc_jp"))
            except UnicodeDecodeError:
                pass
    return chars


def to_ranges(chars):
    codepoints = sorted(ord(c) for c in chars)
    ranges, start, prev = [], None, None
    for cp in codepoints:
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            ranges.append((start, prev))
            start = prev = cp
    if start is not None:
        ranges.append((start, prev))
    return ranges


def unicode_range(chars):
    return ", ".join(f"U+{a:X}" if a == b else f"U+{a:X}-{b:X}" for a, b in to_ranges(chars))


def write_subset(src, chars, out_path):
    font = TTFont(src)
    available = set(font.getBestCmap().keys())
    codepoints = sorted(ord(c) for c in chars if ord(c) in available)
    options = subset.Options()
    options.layout_features = ["*"]
    options.name_IDs = ["*"]        # 著作権表示・ライセンスの情報を残す
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.hinting = False
    options.desubroutinize = True
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=codepoints)
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(out_path)
    return {chr(cp) for cp in codepoints}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--font", required=True, help="元の TekitouPoem.ttf のパス")
    parser.add_argument("--data", default=os.path.join(ROOT, "reel-data.js"))
    parser.add_argument("--out", default=os.path.join(ROOT, "fonts"))
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)
    base_wanted = reel_chars(args.data) | DEFAULT_NAME_CHARS | KANA | ASCII | PUNCT | FULLWIDTH
    base_path = os.path.join(args.out, "TekitouPoem-base.woff2")
    base = write_subset(args.font, base_wanted, base_path)

    kanji_path = os.path.join(args.out, "TekitouPoem-kanji.woff2")
    kanji = write_subset(args.font, jis_level1_kanji() - base, kanji_path)

    missing = sorted(base_wanted - base)
    if missing:
        print("警告: 元のフォントに入っていない文字:", "".join(missing), file=sys.stderr)

    css = f"""/* TekitouPoem（SIL Open Font License 1.1 / Copyright (c) 2023 Cockatrice Digital）から、
   必要な文字だけを取り出したフォント。作り方は tools/build-font-subsets.py を参照。
   unicode-range にある文字が使われたときだけ、ブラウザが、そのファイルを読み込む。 */

@font-face {{
    font-family: "TekitouPoem";
    src: url("TekitouPoem-base.woff2?v={FONT_VERSION}") format("woff2");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
    unicode-range: {unicode_range(base)};
}}

@font-face {{
    font-family: "TekitouPoem";
    src: url("TekitouPoem-kanji.woff2?v={FONT_VERSION}") format("woff2");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
    unicode-range: {unicode_range(kanji)};
}}
"""
    with open(os.path.join(args.out, "tekitoupoem.css"), "w", encoding="utf-8", newline="\n") as f:
        f.write(css)

    print(f"base : {len(base)}文字 {os.path.getsize(base_path) / 1024:.0f}KB")
    print(f"kanji: {len(kanji)}文字 {os.path.getsize(kanji_path) / 1024:.0f}KB")


if __name__ == "__main__":
    main()
