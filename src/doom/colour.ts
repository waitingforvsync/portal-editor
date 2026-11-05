// colour.ts - a level's surfaces' colours as shades. Doom's colours are dark and mostly near
// grey, while the shades are mixes of black, red, green and blue light: one grey, and the
// rest pure colours, the purest the brightest. So a level's colours are spread over the
// shades' range. A colour is taken as its light (the sum of its channels, as a shade's is the
// share of its pixels lit) and its saturation and hue (its place in the triangle of red, green
// and blue, its hue as the eye sees it). Any colour as saturated as the level's middling ones
// takes its hue at full saturation, as most shades are; lightness goes by rank among the
// level's surfaces; and the colours least like the level's average go towards full light,
// where the pure shades are (the acid among a level's browns, say). Then each surface is lit,
// and takes the nearest shade: floors take all the light, from above; ceilings less; and
// walls more the more squarely they face the light, which comes from the north-west.

import { lab, nearestShade } from '../map/shades';
import type { Linear } from './wad';

export type Direction = [number, number, number];

export interface Surface {
    colour: Linear;          // its texture's or flat's average, in linear light
    normal?: Direction;      // the way it faces, unit length: x up the page, y right, z up;
                             // none for what nothing lights, such as the sky
}

const TINTED = 0.5;          // the share of surfaces less saturated than one at full saturation
const VIVID = 0.9;           // the share less unlike the level's average than one at full light
const GLOW = 4;              // how sharply light rises towards the most saturated
const DARKEST = 0.15;        // the least light a surface is given, before lighting
const CEILING = 0.6;         // the light a ceiling gets
const SHADOW = 0.5;          // the light a wall facing away from the light gets
const LIGHT = [Math.SQRT1_2, -Math.SQRT1_2];    // where walls' light comes from: north-west

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

// The edge of the red-green-blue triangle, finely: the purest colours at full light, from red
// through green and blue back to red, each with its hue.
const EDGE = Array.from({ length: 3 * 128 }, (_, i): { colour: Linear; hue: number } => {
    const t = (i % 128) / 128;
    const side = Math.floor(i / 128);
    const colour: Linear = side === 0 ? [1 - t, t, 0] : side === 1 ? [0, 1 - t, t] : [t, 0, 1 - t];
    return { colour, hue: hue(colour) };
});

// The purest colour, at full light, of a colour's hue.
function purest(colour: Linear): Linear {
    const h = hue(colour);
    const apart = (e: { hue: number }) => Math.min(Math.abs(e.hue - h), 360 - Math.abs(e.hue - h));
    return EDGE.reduce((best, e) => (apart(e) < apart(best) ? e : best)).colour;
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
    const facing = normal[0] * LIGHT[0]! + normal[1] * LIGHT[1]!;    // -1 to 1
    return SHADOW + (1 - SHADOW) * (1 + facing) / 2;
}

// Each surface's shade.
export function shadeSurfaces(surfaces: readonly Surface[]): number[] {
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
    // how far each colour is from the level's average, in the triangle
    const places = surfaces.map((s) => chromaticity(s.colour));
    const average = [0, 1, 2].map((k) => places.reduce((sum, p) => sum + p[k]!, 0) / places.length);
    const unlike = places.map((p) => Math.hypot(...p.map((c, k) => c - average[k]!)));
    const vivid = Math.max(1e-6, percentile(unlike, VIVID));
    return surfaces.map((surface, i) => {
        const tint = Math.min(1, saturations[i]! / tinted);
        const glow = Math.min(1, unlike[i]! / vivid) ** GLOW;
        let light = DARKEST + (1 - DARKEST) * rank(lightnesses[i]!);
        light += (1 - light) * glow;
        light *= lighting(surface.normal);
        const pure = purest(surface.colour);
        const target = pure.map((p) => light * (1 / 3 + tint * (p - 1 / 3)));
        return nearestShade([target[0]!, target[1]!, target[2]!]);
    });
}
