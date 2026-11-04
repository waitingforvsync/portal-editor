import { describe, expect, it } from 'vitest';

import {
    HARDWARE_COLOURS, NUM_SHADES, shadeFromName, shadeName, shadeRgb, shadeTile,
} from '../src/map/shades';

const LUMINANCE = [0, 114, 299, 587];    // Rec. 601, per thousand, as palette.c orders them

describe('shades', () => {
    it('has the 35 mixes of four pixels from four colours, once each', () => {
        expect(NUM_SHADES).toBe(35);
        const names = Array.from({ length: NUM_SHADES }, (_, i) => shadeName(i));
        expect(new Set(names).size).toBe(35);
        for (const name of names) {
            expect(name).toMatch(/^[KBRG]{4}$/);
            const order = [...name].map((c) => HARDWARE_COLOURS.indexOf(c as 'K'));
            expect(order).toEqual([...order].sort((a, b) => a - b));
        }
    });

    it('runs darkest first by summed luminance', () => {
        const lum = (i: number) => [...shadeName(i)]
            .reduce((sum, c) => sum + LUMINANCE[HARDWARE_COLOURS.indexOf(c as 'K')]!, 0);
        for (let i = 1; i < NUM_SHADES; i++) {
            expect(lum(i)).toBeGreaterThanOrEqual(lum(i - 1));
        }
    });

    it('finds each shade by its name, and nothing else', () => {
        for (let i = 0; i < NUM_SHADES; i++) {
            expect(shadeFromName(shadeName(i))).toBe(i);
        }
        expect(shadeFromName('kkkk')).toBeUndefined();
        expect(shadeFromName('KKBK')).toBeUndefined();    // not in canonical order
        expect(shadeFromName('KKK')).toBeUndefined();
        expect(shadeFromName('')).toBeUndefined();
    });

    it('has tiles holding each colour twice as often as the name does', () => {
        for (let i = 0; i < NUM_SHADES; i++) {
            const tile = shadeTile(i);
            expect(tile).toHaveLength(8);
            for (let c = 0; c < 4; c++) {
                const inName = [...shadeName(i)].filter((l) => l === HARDWARE_COLOURS[c]).length;
                expect(tile.filter((t) => t === c).length).toBe(2 * inName);
            }
        }
    });

    it('matches palette.c for a sample of tiles', () => {
        expect(shadeTile(0)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
        expect(shadeTile(1)).toEqual([1, 0, 0, 0, 0, 0, 1, 0]);    // KKKB: BKKK KKBK
        expect(shadeTile(18)).toEqual([0, 1, 2, 3, 2, 3, 0, 1]);   // KBRG: KBRG RGKB
        expect(shadeTile(34)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
    });

    it('shows a shade as the average of its colours', () => {
        expect(shadeRgb(0)).toEqual([0, 0, 0]);
        expect(shadeRgb(34)).toEqual([0, 255, 0]);
        expect(shadeRgb(2)).toEqual([0, 0, 127.5]);              // KKBB
        expect(shadeRgb(18)).toEqual([63.75, 63.75, 63.75]);     // KBRG
    });

    it('throws for a shade that does not exist', () => {
        expect(() => shadeName(-1)).toThrow(RangeError);
        expect(() => shadeName(35)).toThrow(RangeError);
        expect(() => shadeTile(35)).toThrow(RangeError);
        expect(() => shadeRgb(1.5)).toThrow(RangeError);
    });
});
