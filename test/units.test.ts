import { describe, expect, it } from 'vitest';

import { isCoord, isHeight, toCoord, toHeight } from '../src/map/units';

describe('units', () => {
    it('takes whole numbers in 0..65535 as coordinates', () => {
        expect(isCoord(0)).toBe(true);
        expect(isCoord(65535)).toBe(true);
        expect(isCoord(-1)).toBe(false);
        expect(isCoord(65536)).toBe(false);
        expect(isCoord(1.5)).toBe(false);
        expect(isCoord(NaN)).toBe(false);
        expect(isCoord(Infinity)).toBe(false);
        expect(toCoord(1234)).toBe(1234);
        expect(() => toCoord(0.5)).toThrow(RangeError);
        expect(() => toCoord(-1)).toThrow(RangeError);
    });

    it('takes whole multiples of 8 as heights, either sign', () => {
        expect(isHeight(0)).toBe(true);
        expect(isHeight(-24)).toBe(true);
        expect(isHeight(2040)).toBe(true);
        expect(isHeight(4)).toBe(false);
        expect(isHeight(8.5)).toBe(false);
        expect(isHeight(NaN)).toBe(false);
        expect(isHeight(2 ** 60)).toBe(false);    // past exact integers
        expect(toHeight(-32)).toBe(-32);
        expect(() => toHeight(12)).toThrow(RangeError);
    });
});
