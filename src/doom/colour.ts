// colour.ts - the colours an imported level's surfaces want. The shades can't follow Doom's
// colours closely, its browns and greys falling between them, so a level is recoloured in
// what the shades do well: blues, purples and reds (blue and red light mixed), and dark and
// olive greens. A surface's Doom colour sets its family and its lightness, not its exact hue:
// - greenish colours take the greens, bluish ones the blues and strong reds the reds; the
//   rest, greys and browns, a ramp from blue in the dark, through purple, to red in the light;
// - lightness goes by rank among the level's surfaces, kept dark, then lit by the way the
//   surface faces: floors take all the light, from above; ceilings less; and walls more the
//   more squarely they face the light, which comes from the north-west;
// - the greens, blues and reds least like the level's average glow, pure and at full light:
//   E1M1's acid, among its browns, is bright green.
// Which shade each surface gets, its neighbours' in mind, is distinct.ts's to choose.

import type { Want } from '../map/distinct';
import { lab, shadeFromName } from '../map/shades';
import type { Linear } from './wad';

export type Direction = [number, number, number];

export interface Surface {
    colour: Linear;          // its texture's or flat's average, in linear light
    normal?: Direction;      // the way it faces, unit length: x up the page, y right, z up;
                             // none for what nothing lights, such as the sky
}

const DARK = 0.2;            // the light of the level's darkest surfaces, before lighting
const LIGHT = 0.6;           // and of its lightest, unless they glow
const TINTED = 0.5;          // the share of surfaces less saturated than one with a hue
const VIVID = 0.9;           // the share less unlike the level's average than one that glows
const GLOW = 4;              // how sharply glow rises towards the most unlike
const CEILING = 0.6;         // the light a ceiling gets
const SHADOW = 0.5;          // the light a wall facing away from the light gets
const LIGHT_FROM = [Math.SQRT1_2, -Math.SQRT1_2];    // where walls' light comes from: north-west
const WARM = 0.2;            // how much redder a brown's place on the ramp is
// the families' hues, as the eye sees them (CIELAB degrees): pure red is 40, Doom's browns
// 50 to 90, pure green 136 and pure blue 306
const REDS_END = 45;
const GREENS_START = 100;
const BLUES_START = 200;
const REDS_START = 330;

function family(names: string): number[] {
    return names.split(' ').map((name) => shadeFromName(name)!);
}

// The shades of each family: the ramp is every mix of black, blue and red.
const RAMP = family('KKKK KKKB KKBB KBBB BBBB KKKR KKBR KBBR BBBR KKRR KBRR BBRR KRRR BRRR RRRR');
const BLUES = family('KKKB KKBB KBBB BBBB');
const REDS = family('KKKR KKRR KRRR RRRR');
const GREENS = family('KKKG KKRG KKGG KRGG KGGG GGGG');

// Lightness as the eye sees it (CIE L*, 0 to 100) of a colour in linear light.
function lightness([r, g, b]: Linear): number {
    const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : 24389 / 27 * y;
}

// A colour's saturation: 0 for grey, 1 with one channel at nothing.
function saturation([r, g, b]: Linear): number {
    const light = r + g + b;
    return light > 0 ? 1 - 3 * Math.min(r, g, b) / light : 0;
}

// A colour's hue as the eye sees it: its angle in CIELAB, in degrees.
function hue(colour: Linear): number {
    const [, a, b] = lab(colour);
    return (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
}

// A colour's place in the triangle of red, green and blue: its channels as shares of its light.
function chromaticity([r, g, b]: Linear): Linear {
    const light = r + g + b;
    return light > 0 ? [r / light, g / light, b / light] : [1 / 3, 1 / 3, 1 / 3];
}

// The value below which a share of the values lie.
function percentile(values: readonly number[], share: number): number {
    const sorted = [...values].sort((p, q) => p - q);
    return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))] ?? 0;
}

// How much light a surface gets for the way it faces: all of it, facing up or no way.
export function lighting(normal: Direction | undefined): number {
    if (!normal || normal[2] > 0.5) {
        return 1;
    }
    if (normal[2] < -0.5) {
        return CEILING;
    }
    const facing = normal[0] * LIGHT_FROM[0]! + normal[1] * LIGHT_FROM[1]!;    // -1 to 1
    return SHADOW + (1 - SHADOW) * (1 + facing) / 2;
}

// What each surface wants: a colour in its family, and the family's shades.
export function surfaceWants(surfaces: readonly Surface[]): Want[] {
    const lightnesses = surfaces.map((s) => lightness(s.colour));
    const sorted = [...lightnesses].sort((p, q) => p - q);
    const rank = (l: number) => {
        // the share of surfaces darker, and half of those as light
        let below = 0;
        let equal = 0;
        for (const m of sorted) {
            below += Number(m < l);
            equal += Number(m === l);
        }
        return sorted.length > 1 ? (below + equal / 2) / sorted.length : 0.5;
    };
    const saturations = surfaces.map((s) => saturation(s.colour));
    const tinted = Math.max(1e-6, percentile(saturations, TINTED));
    const places = surfaces.map((s) => chromaticity(s.colour));
    const average = [0, 1, 2].map((k) => places.reduce((sum, p) => sum + p[k]!, 0) / places.length);
    const unlike = places.map((p) => Math.hypot(...p.map((c, k) => c - average[k]!)));
    const vivid = Math.max(1e-6, percentile(unlike, VIVID));
    const lowest = DARK * SHADOW;    // the least light a surface can end up with

    return surfaces.map((surface, i): Want => {
        const h = hue(surface.colour);
        const coloured = saturations[i]! >= tinted;
        const warm = h >= REDS_END && h < GREENS_START;    // browns, on the ramp, never glow
        const glow = coloured && !warm ? Math.min(1, unlike[i]! / vivid) ** GLOW : 0;
        let light = DARK + (LIGHT - DARK) * rank(lightnesses[i]!);
        light = (light + (1 - light) * glow) * lighting(surface.normal);
        if (coloured && h >= GREENS_START && h < BLUES_START) {
            // greens: the yellower, the more olive, unless glowing
            const olive = glow > 0.5 ? 0 : Math.min(0.5, Math.max(0, (140 - h) / 50));
            return { colour: [light * olive, light * (1 - olive), 0], rather: GREENS };
        }
        if (coloured && h >= BLUES_START && h < REDS_START) {
            return { colour: [0, 0, light], rather: BLUES };
        }
        if (coloured && (h >= REDS_START || h < REDS_END)) {
            return { colour: [light, 0, 0], rather: REDS };
        }
        // greys and browns: blue in the dark, through purple, to red in the light
        const red = Math.min(1, Math.max(0, (light - lowest) / (LIGHT - lowest)
            + (coloured ? WARM : 0)));
        return { colour: [light * red, 0, light * (1 - red)], rather: RAMP };
    });
}
