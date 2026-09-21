(() => {
    'use strict';

    // Xに投稿するときに、感想の下に付けるハッシュタグ
    const SHARE_HASHTAG = '#ご感想ジェネレータ';

    const STORAGE_KEY = 'orchestra-happening:sound';
    const REEL_KEYS = ['reel1', 'reel2', 'reel3'];
    // 各リールの文章のあとに続ける文字（リール3は文末なし）
    const REEL_SUFFIXES = ['が、', '、', ''];

    // 1つめ → 2つめ → 3つめ → アンケート用紙が開く、までの間隔は、すべて同じ（STOP_INTERVAL_MS）にする。
    const FIRST_STOP_MS = 1600;
    const STOP_INTERVAL_MS = 800;
    // 各リールの回転時間(ms)と、その間に流れる行数。上→中→下の順に止まる。
    const SPIN_MS = [0, 1, 2].map((i) => FIRST_STOP_MS + i * STOP_INTERVAL_MS);
    const SPIN_ROWS = [14, 22, 30];
    const EASE_POWER = 1.8;
    const BLUR_SPEED = 9; // この速さ(行/秒)を超えている間だけ残像をつける
    const TICK_INTERVAL_MS = 50;

    // ---------- ユーティリティ ----------

    const pick = (list) => list[Math.floor(Math.random() * list.length)];

    // excluded に含まれないものから選ぶ（候補が尽きたら全体から選ぶ）
    const pickExcept = (list, ...excluded) => {
        const candidates = list.filter((text) => !excluded.includes(text));
        return pick(candidates.length > 0 ? candidates : list);
    };

    const storage = {
        get() {
            try {
                return localStorage.getItem(STORAGE_KEY);
            } catch (e) {
                return null;
            }
        },
        set(value) {
            try {
                localStorage.setItem(STORAGE_KEY, value);
            } catch (e) {
                // 保存できなくても動作には影響しない
            }
        },
    };

    // ---------- サウンド（音源ファイルなし。WebAudioで鳴らす） ----------

    const Sound = (() => {
        let ctx = null;
        let master = null;
        let noiseBuffer = null;
        let enabled = false;

        const ensure = () => {
            if (!enabled) return null;
            if (!ctx) {
                const AudioCtx = window.AudioContext || window.webkitAudioContext;
                if (!AudioCtx) return null;
                ctx = new AudioCtx();
                master = ctx.createGain();
                master.gain.value = 0.6;
                master.connect(ctx.destination);
            }
            if (ctx.state === 'suspended') ctx.resume();
            return ctx;
        };

        const envelope = (gain, t, attack, peak, decay) => {
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(peak, t + attack);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
        };

        const tone = (freq, { type = 'triangle', delay = 0, attack = 0.004, decay = 0.3, peak = 0.2, lowpass = 0, bend = 0 } = {}) => {
            const c = ensure();
            if (!c) return;
            const t = c.currentTime + delay;
            const osc = c.createOscillator();
            const gain = c.createGain();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            if (bend) osc.frequency.exponentialRampToValueAtTime(bend, t + decay);
            envelope(gain, t, attack, peak, decay);
            if (lowpass) {
                const filter = c.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = lowpass;
                osc.connect(filter);
                filter.connect(gain);
            } else {
                osc.connect(gain);
            }
            gain.connect(master);
            osc.start(t);
            osc.stop(t + attack + decay + 0.05);
        };

        const noise = ({ delay = 0, attack = 0.002, decay = 0.1, peak = 0.1, type = 'highpass', freq = 4000 } = {}) => {
            const c = ensure();
            if (!c) return;
            if (!noiseBuffer) {
                noiseBuffer = c.createBuffer(1, c.sampleRate, c.sampleRate);
                const data = noiseBuffer.getChannelData(0);
                for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            }
            const t = c.currentTime + delay;
            const src = c.createBufferSource();
            const filter = c.createBiquadFilter();
            const gain = c.createGain();
            src.buffer = noiseBuffer;
            filter.type = type;
            filter.frequency.value = freq;
            envelope(gain, t, attack, peak, decay);
            src.connect(filter);
            filter.connect(gain);
            gain.connect(master);
            src.start(t);
            src.stop(t + attack + decay + 0.05);
        };

        // 停止音は D メジャーのアルペジオ（D→F#→A）のピチカート
        const STOP_NOTES = [587.33, 739.99, 880.0];
        // 結果音は D メジャーの和音
        const CHORD = [146.83, 293.66, 369.99, 440.0, 587.33];

        return {
            setEnabled(value) {
                enabled = value;
                if (enabled) ensure();
            },
            unlock() {
                ensure();
            },
            preview() {
                tone(STOP_NOTES[0], { decay: 0.4, peak: 0.25, lowpass: 3000 });
            },
            tick() {
                tone(1200 + Math.random() * 200, { type: 'sine', decay: 0.03, peak: 0.05 });
            },
            stop(index) {
                const note = STOP_NOTES[index % STOP_NOTES.length];
                tone(note, { decay: 0.45, peak: 0.28, lowpass: 3000 });
                tone(note * 2, { type: 'sine', decay: 0.2, peak: 0.06 });
                noise({ decay: 0.03, peak: 0.08, type: 'bandpass', freq: 1500 });
            },
            result() {
                tone(110, { type: 'sine', decay: 0.6, peak: 0.35, bend: 70 });
                CHORD.forEach((freq) => {
                    tone(freq, { type: 'sawtooth', delay: 0.02, attack: 0.03, decay: 1.4, peak: 0.045, lowpass: 1400 });
                });
                noise({ delay: 0.02, attack: 0.01, decay: 0.9, peak: 0.05, type: 'highpass', freq: 6000 });
            },
        };
    })();

    // ---------- リール ----------

    // 1行に収まらないときだけ、収まるまで文字を縮める（データを短く書くのが基本）
    const fitItem = (item) => {
        const span = item.firstElementChild;
        span.style.fontSize = '';
        const available = item.clientWidth;
        const actual = span.offsetWidth;
        if (available > 0 && actual > available) {
            const size = parseFloat(getComputedStyle(span).fontSize);
            span.style.fontSize = `${size * (available / actual) * 0.98}px`;
        }
    };

    // suffix（「が、」「、」）は、文章の一部として、同じ色のまま同じ行に並べる
    const makeItem = (text, suffix = '', placeholder = false) => {
        const item = document.createElement('div');
        item.className = placeholder ? 'item placeholder' : 'item';
        const span = document.createElement('span');
        span.textContent = placeholder ? text : text + suffix;
        item.append(span);
        return item;
    };

    class Reel {
        constructor(index, row) {
            this.index = index;
            this.data = REEL_DATA[REEL_KEYS[index]];
            this.card = row.querySelector('.card');
            this.strip = row.querySelector('.strip');
            this.suffix = REEL_SUFFIXES[index];
            this.value = '？';
            this.placeholder = true;
            this.rest();
        }

        // 1行だけ表示した静止状態にする
        rest() {
            this.strip.replaceChildren(makeItem(this.value, this.suffix, this.placeholder));
            this.strip.style.transform = 'none';
            this.card.classList.remove('fast');
            fitItem(this.strip.lastElementChild);
        }

        refit() {
            fitItem(this.strip.lastElementChild);
        }

        spin(result, duration, rows) {
            // 上から下へ「止まる結果 … 途中の文章 … 今表示している文章」の順に並べ、
            // 下へ向かって流すことで、文字が上から下へ回転して見える。
            const sequence = [this.value];
            for (let i = 1; i < rows; i++) {
                sequence.push(pickExcept(this.data, sequence[i - 1], i === rows - 1 ? result : undefined));
            }
            sequence.push(result);
            sequence.reverse();

            this.strip.replaceChildren(
                ...sequence.map((text, i) => makeItem(text, this.suffix, i === rows && this.placeholder))
            );
            fitItem(this.strip.firstElementChild);
            const rowHeight = this.strip.firstElementChild.offsetHeight;
            // 最初は一番下（今表示している文章）に合わせておく
            this.strip.style.transform = `translateY(${-rows * rowHeight}px)`;

            return new Promise((resolve) => {
                const start = performance.now();
                let lastRow = 0;
                let lastTick = 0;

                const frame = (now) => {
                    const t = Math.min(1, (now - start) / duration);
                    const remaining = 1 - t;
                    const position = rows * (1 - Math.pow(remaining, EASE_POWER));
                    const speed = (rows * EASE_POWER * Math.pow(remaining, EASE_POWER - 1) * 1000) / duration;

                    this.strip.style.transform = `translateY(${(position - rows) * rowHeight}px)`;
                    this.card.classList.toggle('fast', speed > BLUR_SPEED);

                    const row = Math.floor(position);
                    if (row !== lastRow && t < 1) {
                        lastRow = row;
                        if (now - lastTick >= TICK_INTERVAL_MS) {
                            lastTick = now;
                            Sound.tick();
                        }
                    }

                    if (t < 1) {
                        requestAnimationFrame(frame);
                        return;
                    }

                    this.value = result;
                    this.placeholder = false;
                    this.rest();
                    this.card.classList.remove('thud');
                    void this.card.offsetWidth; // アニメーションを再始動させる
                    this.card.classList.add('thud');
                    Sound.stop(this.index);
                    resolve();
                };

                requestAnimationFrame(frame);
            });
        }
    }

    // ---------- 結果カード（演奏会のアンケート用紙をCanvasで描く） ----------

    const CARD_W = 1080;
    const CARD_H = 1350;
    // 印刷された部分は明朝、書き込まれた感想は手書き風のフォントにする
    const PRINT_FONT = '"Shippori Mincho B1", "Yu Mincho", "Hiragino Mincho ProN", "Noto Serif JP", serif';
    // 手書き風のフォント。TekitouPoem（fonts/ に置いてある）を使い、そこにない珍しい文字だけ Yomogi で描く。
    const HAND_FONT = '"TekitouPoem", "Yomogi", "Yu Kyokasho", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif';
    // サイトに置いているのは、TekitouPoem の Regular だけ。別の太さを指定すると、ブラウザが無理に太らせて字がつぶれるので、400 にそろえる。
    const HAND_WEIGHT = 400;
    const CARD_COLORS = {
        paper: '#f4f1e5',
        ink: '#161616',
        accent: '#161616',
        muted: '#5a5a5a',
        rule: '#9b9b9b',
        edge: '#d2d2d2',
        pen: '#1f3a8a',
    };
    // リールの結果につなぐ文字。画面のリールと同じ。
    const CARD_CONNECTORS = ['が、', '、', '。'];
    // アンケート用紙の印刷文言
    // カード下部に入れるアプリ名（ページの見出しと同じ）
    const CARD_APP_NAME = 'ご感想ジェネレータ　～オーケストラ版～';
    // （演奏会の名前は、ネタとして reel-data.js の CONCERT_TITLES から選ぶ）
    const CARD_TEXT = {
        title: '来場者アンケート',
        visits: 'ご来場回数',
        age: 'ご年代',
        satisfaction: '本日の満足度',
        satisfactionNote: '1＝低い　5＝高い',
        free: 'ご意見・ご感想',
        name: 'お名前（任意）',
        footnote: 'ご協力ありがとうございます。いただいたご意見は、今後の参考にいたします。',
    };
    const CARD_VISITS = ['初めて', '2〜5回', '6回以上'];
    const CARD_AGES = ['〜20代', '30代', '40代', '50代', '60代〜'];

    // 字間をあけて中央寄せで描く
    const drawSpaced = (ctx, text, centerX, y, spacing) => {
        const chars = [...text];
        const widths = chars.map((ch) => ctx.measureText(ch).width);
        const total = widths.reduce((sum, w) => sum + w, 0) + spacing * (chars.length - 1);
        let x = centerX - total / 2;
        ctx.textAlign = 'left';
        chars.forEach((ch, i) => {
            ctx.fillText(ch, x, y);
            x += widths[i] + spacing;
        });
        ctx.textAlign = 'center';
    };

    // ---- 感想の折り返し（Canvasは自動で折り返さないので自前で行う） ----

    // 行頭・行末に置かない文字（簡易的な禁則処理）
    const NO_LINE_START = '、。，．」』）〕】！？ー・…';
    const NO_LINE_END = '「『（〔【';

    const handFont = (size) => `${HAND_WEIGHT} ${size}px ${HAND_FONT}`;

    // group が同じ文字は「まとまり」として、できるだけ途中で折り返さない
    const toChars = (text, group) => [...text].map((ch) => ({ ch, group }));

    const charWidth = (ctx, ch, size) => {
        ctx.font = handFont(size);
        return ctx.measureText(ch).width;
    };

    const measureChars = (ctx, chars, size) => chars.reduce((sum, c) => sum + charWidth(ctx, c.ch, size), 0);

    // まとまりの切れ目で折り返す。1行に収まらないまとまりだけ文字単位で折り返し、split を true にする。
    const wrapChars = (ctx, chars, size, maxWidth) => {
        const groups = [];
        for (const c of chars) {
            const last = groups[groups.length - 1];
            if (last && last.id === c.group) last.chars.push(c);
            else groups.push({ id: c.group, chars: [c] });
        }

        const lines = [];
        let line = [];
        let width = 0;
        let split = false;
        const breakLine = () => {
            if (line.length > 0) lines.push(line);
            line = [];
            width = 0;
        };

        for (const group of groups) {
            const groupWidth = measureChars(ctx, group.chars, size);
            if (groupWidth <= maxWidth) {
                if (width + groupWidth > maxWidth) breakLine();
                line.push(...group.chars);
                width += groupWidth;
                continue;
            }

            split = true;
            for (const c of group.chars) {
                const w = charWidth(ctx, c.ch, size);
                if (line.length > 0 && width + w > maxWidth && !NO_LINE_START.includes(c.ch)) {
                    const last = line[line.length - 1];
                    if (line.length > 1 && NO_LINE_END.includes(last.ch)) {
                        // 開きかっこが行末に残らないよう、次の行へ送る
                        line.pop();
                        lines.push(line);
                        line = [last];
                        width = charWidth(ctx, last.ch, size);
                    } else {
                        breakLine();
                    }
                }
                line.push(c);
                width += w;
            }
        }
        breakLine();
        return { lines, split };
    };

    // ---- 用紙の部品 ----

    const jitter = (amount) => (Math.random() * 2 - 1) * amount;

    // ペンで付けたチェックマーク
    const drawCheckMark = (ctx, x, y, size) => {
        ctx.save();
        ctx.strokeStyle = CARD_COLORS.pen;
        ctx.lineWidth = 5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(x + size * 0.12, y + size * 0.5);
        ctx.lineTo(x + size * 0.42, y + size * 0.85);
        ctx.lineTo(x + size * 1.15, y - size * 0.3);
        ctx.stroke();
        ctx.restore();
    };

    // ラベルと、チェック欄つきの選択肢を1行に並べる
    const drawChoiceRow = (ctx, label, options, checkedIndex, y) => {
        const boxSize = 24;
        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 26px ${PRINT_FONT}`;
        ctx.fillText(label, 90, y);

        ctx.font = `700 24px ${PRINT_FONT}`;
        let x = 280;
        options.forEach((option, i) => {
            ctx.strokeStyle = CARD_COLORS.ink;
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y - boxSize / 2, boxSize, boxSize);
            if (i === checkedIndex) drawCheckMark(ctx, x, y - boxSize / 2, boxSize);
            ctx.fillStyle = CARD_COLORS.ink;
            ctx.fillText(option, x + boxSize + 8, y);
            x += boxSize + 8 + ctx.measureText(option).width + 28;
        });
        ctx.textAlign = 'center';
    };

    // ペンでぐるっと囲んだ、手書きの丸。1周より少し多く回して、書き終わりが書き始めの外側に重なる。
    // 線の太さは、書き始めと書き終わりで細く、途中で太くする。形は、描くたびに少し変わる。
    const drawHandCircle = (ctx, cx, cy, rx, ry) => {
        const steps = 64;
        const turns = 1.1 + Math.random() * 0.08;
        const start = Math.PI * 0.5 + jitter(0.25); // 真下あたりから書き始める
        const tilt = -0.1 + jitter(0.1);
        const p1 = Math.random() * 6.28;
        const p2 = Math.random() * 6.28;
        const point = (i) => {
            const t = i / steps;
            const angle = start + t * turns * Math.PI * 2; // 右回り（真下から、左、上、右の順）
            const scale = 0.9 + 0.2 * t + 0.035 * Math.sin(2 * angle + p1) + 0.025 * Math.sin(3 * angle + p2);
            const x = rx * scale * Math.cos(angle);
            const y = ry * scale * Math.sin(angle);
            return [cx + x * Math.cos(tilt) - y * Math.sin(tilt), cy + x * Math.sin(tilt) + y * Math.cos(tilt)];
        };
        ctx.save();
        ctx.strokeStyle = CARD_COLORS.pen;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        let prev = point(0);
        for (let i = 1; i <= steps; i++) {
            const cur = point(i);
            ctx.lineWidth = 2.6 + 2.6 * Math.pow(Math.sin(Math.PI * (i / steps)), 0.6) + jitter(0.25);
            ctx.beginPath();
            ctx.moveTo(prev[0], prev[1]);
            ctx.lineTo(cur[0], cur[1]);
            ctx.stroke();
            prev = cur;
        }
        ctx.restore();
    };

    // 1〜5の数字。選んだ番号には、ペンで手書きの丸を付ける（印刷された丸は付けない）
    const drawSatisfactionRow = (ctx, label, note, chosen, y) => {
        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 26px ${PRINT_FONT}`;
        ctx.fillText(label, 90, y);

        ctx.textAlign = 'center';
        ctx.font = `700 26px ${PRINT_FONT}`;
        for (let n = 1; n <= 5; n++) {
            const cx = 310 + (n - 1) * 92;
            ctx.fillStyle = CARD_COLORS.ink;
            ctx.fillText(String(n), cx, y + 1);

            if (n === chosen) drawHandCircle(ctx, cx, y, 34, 30);
        }

        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.muted;
        ctx.font = `700 20px ${PRINT_FONT}`;
        ctx.fillText(note, 790, y);
        ctx.textAlign = 'center';
    };

    // Webフォントは文字ごとに分割配信されるので、カードに使う文字を指定して先に読み込む。
    // 回線が遅いときに待ちすぎないよう、6秒で諦めて代替フォントで描く。
    // TekitouPoem は、使う文字が入っているファイルだけが読み込まれる（お名前に、通常のファイルにない漢字が
    // あるときだけ、漢字のファイルも読み込む）。それでも足りない文字は Yomogi で描くので、お名前の分だけ読み込む。
    const loadCardFonts = (printText, handText, nameText) =>
        Promise.race([
            Promise.all([
                document.fonts.load(`800 40px ${PRINT_FONT}`, printText),
                document.fonts.load(`700 40px ${PRINT_FONT}`, printText),
                document.fonts.load(`${HAND_WEIGHT} 40px "TekitouPoem"`, handText),
                ...(nameText ? [document.fonts.load(`${HAND_WEIGHT} 40px "Yomogi"`, nameText)] : []),
            ]).catch(() => {}),
            new Promise((resolve) => setTimeout(resolve, 6000)),
        ]);

    // TekitouPoem で描ける文字か（fonts/tekitoupoem.css の unicode-range を、そのまま使って調べる）
    let tekitouRanges = null;
    const tekitouCovers = (ch) => {
        if (!tekitouRanges) {
            tekitouRanges = [...document.fonts]
                .filter((face) => face.family.replace(/["']/g, '') === 'TekitouPoem')
                .flatMap((face) => face.unicodeRange.split(','))
                .map((part) => part.trim().replace(/^U\+/i, '').split('-').map((hex) => parseInt(hex, 16)))
                .map(([from, to]) => [from, to === undefined ? from : to]);
        }
        const codePoint = ch.codePointAt(0);
        return tekitouRanges.some(([from, to]) => codePoint >= from && codePoint <= to);
    };

    // オプション画面の値。'none'（無回答）ならどれにも印を付けない（-1）。
    // そうでなければ、選択肢の番号（満足度は1〜5の数字）。
    const NO_ANSWER = 'none';
    const answerOf = (value) => (value === NO_ANSWER ? -1 : Number(value));

    const renderCard = async (parts, options, concert) => {
        const sentence = parts.map((text, i) => text + CARD_CONNECTORS[i]).join('');
        await loadCardFonts(
            `0123456789${Object.values(CARD_TEXT).join('')}${concert}${CARD_APP_NAME}`,
            sentence + options.name,
            [...options.name].filter((ch) => !tekitouCovers(ch)).join('')
        );

        const canvas = document.createElement('canvas');
        canvas.width = CARD_W;
        canvas.height = CARD_H;
        const ctx = canvas.getContext('2d');
        const cx = CARD_W / 2;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 紙（コピー用紙のような、飾りのない、ほんのり黄みがかった白）。
        // 画像の縁が背景に溶けないよう、ごく薄い縁も付ける
        ctx.fillStyle = CARD_COLORS.paper;
        ctx.fillRect(0, 0, CARD_W, CARD_H);
        ctx.strokeStyle = CARD_COLORS.edge;
        ctx.lineWidth = 2;
        ctx.strokeRect(1, 1, CARD_W - 2, CARD_H - 2);

        // 見出し
        // 演奏会の名前。長いときは、幅に収まるまで文字を小さくする。
        const concertSpacing = 8;
        let concertSize = 36;
        const concertWidth = () => {
            ctx.font = `800 ${concertSize}px ${PRINT_FONT}`;
            return [...concert].reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + concertSpacing * (concert.length - 1);
        };
        while (concertSize > 18 && concertWidth() > CARD_W - 200) concertSize -= 2;
        ctx.fillStyle = CARD_COLORS.accent;
        ctx.font = `800 ${concertSize}px ${PRINT_FONT}`;
        drawSpaced(ctx, concert, cx, 108, concertSpacing);
        // 「来場者アンケート」の題字
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 45px ${PRINT_FONT}`;
        drawSpaced(ctx, CARD_TEXT.title, cx, 172, 16);
        ctx.strokeStyle = CARD_COLORS.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - 330, 224);
        ctx.lineTo(cx + 330, 224);
        ctx.stroke();

        // 選択式の設問（回答はオプション画面の設定。無回答なら印を付けない）
        drawChoiceRow(ctx, CARD_TEXT.visits, CARD_VISITS, answerOf(options.visits), 306);
        drawChoiceRow(ctx, CARD_TEXT.age, CARD_AGES, answerOf(options.age), 376);
        drawSatisfactionRow(ctx, CARD_TEXT.satisfaction, CARD_TEXT.satisfactionNote, answerOf(options.satisfaction), 448);

        // 自由記述欄
        const boxLeft = 90;
        const boxRight = CARD_W - 90;
        const boxTop = 548;
        // 罫線は4行。上の文言を減らした分、行の間隔を広げて、用紙全体に余白が偏らないようにしてある。
        const lineGap = 124;
        const lineCount = 4;
        const boxBottom = boxTop + lineGap * lineCount + 20;

        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 28px ${PRINT_FONT}`;
        ctx.fillText(CARD_TEXT.free, boxLeft, boxTop - 34);
        ctx.textAlign = 'center';

        ctx.strokeStyle = CARD_COLORS.ink;
        ctx.lineWidth = 3;
        ctx.strokeRect(boxLeft, boxTop, boxRight - boxLeft, boxBottom - boxTop);
        ctx.strokeStyle = CARD_COLORS.rule;
        ctx.lineWidth = 2;
        for (let k = 1; k <= lineCount; k++) {
            const y = boxTop + lineGap * k;
            ctx.beginPath();
            ctx.moveTo(boxLeft + 14, y);
            ctx.lineTo(boxRight - 14, y);
            ctx.stroke();
        }

        // 感想（手書き風）。罫線の上に、1文字ずつ少しだけ傾けて書く。
        const chars = parts.flatMap((text, i) => toChars(text + CARD_CONNECTORS[i], i));
        const textLeft = boxLeft + 34;
        const textWidth = boxRight - boxLeft - 68;
        const candidates = [];
        for (let size = 68; size >= 40; size -= 4) {
            const { lines, split } = wrapChars(ctx, chars, size, textWidth);
            candidates.push({ size, lines, split });
        }
        const fitsLines = (c) => c.lines.length <= lineCount;
        const { size, lines } =
            candidates.find((c) => fitsLines(c) && !c.split) ||
            candidates.find(fitsLines) ||
            candidates[candidates.length - 1];

        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.pen;
        lines.forEach((line, row) => {
            const baseY = boxTop + lineGap * (row + 1) - size * 0.5 - 8;
            let x = textLeft;
            for (const c of line) {
                ctx.font = handFont(size);
                ctx.save();
                ctx.translate(x, baseY + jitter(2.5));
                ctx.rotate(jitter(0.03));
                ctx.fillText(c.ch, 0, 0);
                ctx.restore();
                x += ctx.measureText(c.ch).width;
            }
        });
        ctx.textAlign = 'center';

        // 名前欄（空欄）と注意書き
        ctx.textAlign = 'left';
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 26px ${PRINT_FONT}`;
        ctx.fillText(CARD_TEXT.name, boxLeft, boxBottom + 58);
        ctx.strokeStyle = CARD_COLORS.ink;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(boxLeft + 260, boxBottom + 74);
        ctx.lineTo(boxRight, boxBottom + 74);
        ctx.stroke();
        if (options.name) {
            // 入力した名前は、下線の真ん中に書く
            ctx.save();
            ctx.fillStyle = CARD_COLORS.pen;
            ctx.font = handFont(40);
            ctx.textAlign = 'center';
            ctx.translate((boxLeft + 260 + boxRight) / 2, boxBottom + 56);
            ctx.rotate(jitter(0.02));
            ctx.fillText(options.name, 0, 0);
            ctx.restore();
        }
        ctx.textAlign = 'center';
        ctx.fillStyle = CARD_COLORS.muted;
        ctx.font = `700 22px ${PRINT_FONT}`;
        ctx.fillText(CARD_TEXT.footnote, cx, boxBottom + 122);

        // 足もと
        ctx.fillStyle = CARD_COLORS.ink;
        ctx.font = `800 28px ${PRINT_FONT}`;
        drawSpaced(ctx, CARD_APP_NAME, cx, boxBottom + 176, 4);

        return new Promise((resolve, reject) => {
            canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
        });
    };

    // ---------- 画面 ----------

    const spinButton = document.getElementById('spin-button');
    const cardButton = document.getElementById('card-button');
    const soundToggle = document.getElementById('sound-toggle');
    const soundGate = document.getElementById('sound-gate');
    const cardModal = document.getElementById('card-modal');
    const cardImage = document.getElementById('card-image');
    const cardSave = document.getElementById('card-save');
    const cardShare = document.getElementById('card-share');
    const cardClose = document.getElementById('card-close');
    const optionsButton = document.getElementById('options-button');
    const optionsModal = document.getElementById('options-modal');
    const optionName = document.getElementById('option-name');
    const optionsClose = document.getElementById('options-close');

    const reels = Array.from(document.querySelectorAll('.reel-row')).map((row, i) => new Reel(i, row));

    let spinning = false;
    let currentParts = null;
    let currentConcert = '';
    let currentSentence = '';
    let cardUrl = '';

    const buildSentence = ([a, b, c]) => `${a}が、${b}、${c}。`;
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    // ---------- オプション（アンケート用紙の記入欄） ----------

    const OPTIONS_KEY = 'orchestra-happening:options';
    const NAME_MAX_LENGTH = 10;
    // 初期値は、どれも真ん中の選択肢（2〜5回、40代、満足度3）と、お名前「拍手 喝采」
    const DEFAULT_OPTIONS = { visits: '1', age: '2', satisfaction: '3', name: '桶　好夫' };
    // 選択肢の並びは、カードに描く選択肢（CARD_VISITS など）と同じ
    const OPTION_FIELDS = [
        { key: 'visits', labels: CARD_VISITS },
        { key: 'age', labels: CARD_AGES },
        { key: 'satisfaction', labels: ['1', '2', '3', '4', '5'] },
    ];
    // 来場回数・年代は選択肢の番号（0始まり）、満足度は 1〜5 の数字を値にする
    const optionValue = (field, index) => String(field.key === 'satisfaction' ? index + 1 : index);

    // 保存されていた値が壊れていても、使える値だけ取り出す
    const sanitizeOptions = (raw) => {
        const result = { ...DEFAULT_OPTIONS };
        if (!raw || typeof raw !== 'object') return result;
        for (const field of OPTION_FIELDS) {
            const allowed = [NO_ANSWER, ...field.labels.map((_, i) => optionValue(field, i))];
            if (allowed.includes(raw[field.key])) result[field.key] = raw[field.key];
        }
        if (typeof raw.name === 'string') result.name = raw.name.slice(0, NAME_MAX_LENGTH);
        return result;
    };

    const loadOptions = () => {
        try {
            return sanitizeOptions(JSON.parse(localStorage.getItem(OPTIONS_KEY)));
        } catch (e) {
            return { ...DEFAULT_OPTIONS };
        }
    };

    let options = loadOptions();
    let optionsChanged = false;

    const saveOptions = () => {
        try {
            localStorage.setItem(OPTIONS_KEY, JSON.stringify(options));
        } catch (e) {
            // 保存できなくても動作には影響しない
        }
    };

    // 選択肢のボタンを作る
    OPTION_FIELDS.forEach((field) => {
        const container = optionsModal.querySelector(`.option-group[data-option="${field.key}"] .option-choices`);
        const choices = [{ value: NO_ANSWER, label: '無回答' }, ...field.labels.map((label, i) => ({ value: optionValue(field, i), label }))];
        for (const { value, label } of choices) {
            const chip = document.createElement('label');
            chip.className = 'chip';
            const input = document.createElement('input');
            input.type = 'radio';
            input.name = `option-${field.key}`;
            input.value = value;
            input.dataset.key = field.key;
            const text = document.createElement('span');
            text.textContent = label;
            chip.append(input, text);
            container.append(chip);
        }
    });

    // 現在のオプションを、画面の入力欄に反映する
    const syncOptionInputs = () => {
        optionsModal.querySelectorAll('input[type="radio"]').forEach((input) => {
            input.checked = options[input.dataset.key] === input.value;
        });
        optionName.value = options.name;
    };
    optionName.maxLength = NAME_MAX_LENGTH;
    syncOptionInputs();

    // ---------- 結果カード ----------

    const setCardBlob = (blob) => {
        if (cardUrl) URL.revokeObjectURL(cardUrl);
        cardUrl = URL.createObjectURL(blob);
    };

    const openCard = () => {
        if (!cardUrl) return;
        cardImage.src = cardUrl;
        cardImage.alt = currentSentence;
        cardModal.hidden = false;
        cardSave.focus();
    };

    const closeCard = () => {
        if (cardModal.hidden) return;
        cardModal.hidden = true;
        spinButton.focus();
    };

    const openOptions = () => {
        optionsChanged = false;
        optionsModal.hidden = false;
        optionsClose.focus();
    };

    // 閉じるとき、オプションを変えていて結果が出ていれば、新しい設定でカードを描き直して見せる
    const closeOptions = async () => {
        if (optionsModal.hidden) return;
        optionsModal.hidden = true;
        optionsButton.focus();
        if (!optionsChanged || !currentParts || spinning) return;
        optionsChanged = false;
        try {
            setCardBlob(await renderCard(currentParts, options, currentConcert));
            openCard();
        } catch (e) {
            // 描き直せなくても、前のカードはそのまま見られる
        }
    };

    const spin = async () => {
        if (spinning) return;
        spinning = true;
        Sound.unlock();

        spinButton.disabled = true;
        optionsButton.disabled = true; // カードは回転中に描くので、その間はオプションを変えさせない
        cardButton.hidden = true;

        const results = REEL_KEYS.map((key) => pick(REEL_DATA[key]));
        currentParts = results;
        currentConcert = pick(CONCERT_TITLES);
        currentSentence = buildSentence(results);

        // 結果は回す前に決まっているので、カードはリールが回っている間に描いておく。
        // 失敗しても、リールの結果はそのまま見られる。
        const cardBlob = renderCard(results, options, currentConcert).catch(() => null);

        await Promise.all(reels.map((reel, i) => reel.spin(results[i], SPIN_MS[i], SPIN_ROWS[i])));

        // 3つめが止まってから、リールどうしの間隔と同じだけ待って、
        // 結果の効果音（チャーン）を鳴らし、カードを開く。
        // 画面を描き替える処理（カードを開く）で音が遅れないよう、音を先に鳴らす。
        await wait(STOP_INTERVAL_MS);
        const blob = await cardBlob;
        Sound.result();
        if (blob) {
            setCardBlob(blob);
            cardButton.hidden = false;
            openCard();
        } else {
            cardUrl = '';
        }

        spinButton.disabled = false;
        optionsButton.disabled = false;
        spinning = false;
    };

    const saveCard = () => {
        if (!cardUrl) return;
        const link = document.createElement('a');
        link.href = cardUrl;
        link.download = 'orchestra-survey.png';
        document.body.append(link);
        link.click();
        link.remove();
    };

    // Xの投稿画面を開く。文章は「公演名の感想 + 感想 + ハッシュタグ」で、URLは付けない。
    // 画像は付けられないので、「画像を保存」した画像を、投稿画面で自分で添付してもらう。
    const share = () => {
        if (!currentSentence) return;
        const title = currentConcert ? `${currentConcert}の感想

` : '';
        const text = `${title}${currentSentence}
${SHARE_HASHTAG}`;
        window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    };

    const applySound = (on) => {
        Sound.setEnabled(on);
        soundToggle.textContent = on ? '音あり' : '音なし';
        storage.set(on ? 'on' : 'off');
    };

    // 初回だけ音あり／なしを聞く。以降は保存した設定を使う。
    const stored = storage.get();
    if (stored === 'on' || stored === 'off') {
        Sound.setEnabled(stored === 'on');
        soundToggle.textContent = stored === 'on' ? '音あり' : '音なし';
    } else {
        soundGate.hidden = false;
        soundGate.querySelector('button').focus();
    }

    soundGate.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-sound]');
        if (!button) return;
        const on = button.dataset.sound === 'on';
        applySound(on);
        if (on) Sound.preview();
        soundGate.hidden = true;
        spinButton.focus();
    });

    soundToggle.addEventListener('click', () => {
        const on = soundToggle.textContent !== '音あり';
        applySound(on);
        if (on) Sound.preview();
    });

    spinButton.addEventListener('click', spin);
    cardButton.addEventListener('click', openCard);
    cardSave.addEventListener('click', saveCard);
    cardShare.addEventListener('click', share);
    cardClose.addEventListener('click', closeCard);
    cardModal.addEventListener('click', (event) => {
        if (event.target === cardModal) closeCard();
    });

    optionsButton.addEventListener('click', openOptions);
    optionsClose.addEventListener('click', closeOptions);
    optionsModal.addEventListener('click', (event) => {
        if (event.target === optionsModal) closeOptions();
    });
    optionsModal.addEventListener('change', (event) => {
        const input = event.target;
        if (!input.matches('input[type="radio"]')) return;
        options[input.dataset.key] = input.value;
        optionsChanged = true;
        saveOptions();
    });
    optionName.addEventListener('input', () => {
        options.name = optionName.value.slice(0, NAME_MAX_LENGTH);
        optionsChanged = true;
        saveOptions();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!optionsModal.hidden) closeOptions();
        else closeCard();
    });

    // 用紙を描くときに、手書き風フォントの読み込みを待たされないよう、
    // 感想に使う文字のフォントを、ページを開いたあとに先に読み込んでおく（失敗しても動作には影響しない）。
    const prefetchHandFont = () => {
        const chars = new Set(CARD_CONNECTORS.join(''));
        for (const list of Object.values(REEL_DATA)) {
            for (const text of list) [...text].forEach((ch) => chars.add(ch));
        }
        document.fonts.load(`${HAND_WEIGHT} 40px "TekitouPoem"`, [...chars].join('')).catch(() => {});
    };
    const prefetchWhenIdle = () => {
        if ('requestIdleCallback' in window) requestIdleCallback(prefetchHandFont, { timeout: 4000 });
        else setTimeout(prefetchHandFont, 1500);
    };
    if (document.readyState === 'complete') prefetchWhenIdle();
    else window.addEventListener('load', prefetchWhenIdle);

    window.addEventListener('resize', () => {
        if (!spinning) reels.forEach((reel) => reel.refit());
    });
})();
