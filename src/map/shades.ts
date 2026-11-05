// shades.ts - the engine's 35-shade catalogue (portalc palette.c): each shade's name, its
// 4x2 dither tile, and the flat colour the editor shows it as.

// The MODE 5 hardware colours, as letters in shade names and tiles.
export const HARDWARE_COLOURS = ['K', 'B', 'R', 'G'] as const;

// Their RGB, as portalc presents them: black, blue, red, green.
export const HARDWARE_RGB: readonly (readonly [number, number, number])[] = [
    [0, 0, 0],
    [0, 0, 255],
    [255, 0, 0],
    [0, 255, 0],
];

// Each shade's name (its four pixels' colours, darkest first) and its tile: the even
// scanline's four pixels, then the odd's. Indexed as the engine indexes them, darkest first.
const TABLE: readonly (readonly [string, string])[] = [
    ['KKKK', 'KKKK KKKK'],    //  0
    ['KKKB', 'BKKK KKBK'],    //  1
    ['KKBB', 'KBKB BKBK'],    //  2
    ['KKKR', 'RKKK KKRK'],    //  3
    ['KBBB', 'BKBB BBBK'],    //  4
    ['KKBR', 'KBKB RKRK'],    //  5
    ['BBBB', 'BBBB BBBB'],    //  6
    ['KBBR', 'KBKB BRBR'],    //  7
    ['KKKG', 'GKKK KKGK'],    //  8
    ['KKRR', 'KRKR RKRK'],    //  9
    ['BBBR', 'RBBB BBRB'],    // 10
    ['KKBG', 'KBKB GKGK'],    // 11
    ['KBRR', 'KRKR RBRB'],    // 12
    ['KBBG', 'KBKB BGBG'],    // 13
    ['BBRR', 'BRBR RBRB'],    // 14
    ['KKRG', 'KRKR GKGK'],    // 15
    ['KRRR', 'RKRR RRRK'],    // 16
    ['BBBG', 'GBBB BBGB'],    // 17
    ['KBRG', 'KBRG RGKB'],    // 18
    ['BRRR', 'RBRR RRRB'],    // 19
    ['BBRG', 'BRBR GBGB'],    // 20
    ['KKGG', 'KGKG GKGK'],    // 21
    ['KRRG', 'KRKR RGRG'],    // 22
    ['RRRR', 'RRRR RRRR'],    // 23
    ['KBGG', 'KGKG GBGB'],    // 24
    ['BRRG', 'BRBR RGRG'],    // 25
    ['BBGG', 'BGBG GBGB'],    // 26
    ['KRGG', 'KGKG GRGR'],    // 27
    ['RRRG', 'GRRR RRGR'],    // 28
    ['BRGG', 'BGBG GRGR'],    // 29
    ['KGGG', 'GKGG GGGK'],    // 30
    ['RRGG', 'RGRG GRGR'],    // 31
    ['BGGG', 'GBGG GGGB'],    // 32
    ['RGGG', 'GRGG GGGR'],    // 33
    ['GGGG', 'GGGG GGGG'],    // 34
];

export const NUM_SHADES = TABLE.length;

const BY_NAME = new Map(TABLE.map(([name], i) => [name, i]));

function entry(shade: number): readonly [string, string] {
    const e = TABLE[shade];
    if (e === undefined) {
        throw new RangeError(`no shade ${shade}`);
    }
    return e;
}

function colourIndex(letter: string): number {
    return HARDWARE_COLOURS.indexOf(letter as (typeof HARDWARE_COLOURS)[number]);
}

// A shade's name, e.g. 'KKBB'.
export function shadeName(shade: number): string {
    return entry(shade)[0];
}

// The shade with this name, or undefined if there is none.
export function shadeFromName(name: string): number | undefined {
    return BY_NAME.get(name);
}

// A shade's tile as hardware colour indices: the even scanline's four pixels, then the odd's.
export function shadeTile(shade: number): number[] {
    return [...entry(shade)[1].replace(' ', '')].map(colourIndex);
}

// The average of a shade's four colours, as RGB.
export function shadeRgb(shade: number): [number, number, number] {
    const rgb: [number, number, number] = [0, 0, 0];
    for (const letter of entry(shade)[0]) {
        const c = HARDWARE_RGB[colourIndex(letter)] ?? [0, 0, 0];
        rgb[0] += c[0] / 4;
        rgb[1] += c[1] / 4;
        rgb[2] += c[2] / 4;
    }
    return rgb;
}

// ---- matching colours ----

// CIELAB (D65) from linear sRGB, each channel 0 to 1.
export function lab([r, g, b]: readonly number[]): [number, number, number] {
    const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    const x = f((0.4124 * r! + 0.3576 * g! + 0.1805 * b!) / 0.95047);
    const y = f(0.2126 * r! + 0.7152 * g! + 0.0722 * b!);
    const z = f((0.0193 * r! + 0.1192 * g! + 0.9505 * b!) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// Each shade as its dither looks from afar: its pixels' light mixed. The hardware colours are
// full on or off, so that's the average of their channels.
const SHADE_LAB = TABLE.map((_, i) => lab(shadeRgb(i).map((c) => c / 255)));

// The shade that looks most like a colour given in linear light (each channel 0 to 1): the
// nearest in CIELAB.
export function nearestShade(linear: readonly [number, number, number]): number {
    const [l, a, b] = lab(linear);
    let best = 0;
    let bestDistance = Infinity;
    SHADE_LAB.forEach(([sl, sa, sb], i) => {
        const d = (sl - l) ** 2 + (sa - a) ** 2 + (sb - b) ** 2;
        if (d < bestDistance) {
            best = i;
            bestDistance = d;
        }
    });
    return best;
}
