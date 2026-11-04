// units.ts - the map's whole-number types. Each is a plain number at run time that the type
// checker keeps apart from other numbers, so a value only becomes one through a check that it
// fits: the editor's counterpart of portalc's pt_u16. Arithmetic on them gives plain numbers,
// exact while the inputs are (see geometry.ts), and rounding back is always written out.

declare const coordBrand: unique symbol;
declare const heightBrand: unique symbol;

// A coordinate: a whole unit in 0..COORD_MAX, x up the page and y right, as portalc's map.h.
export type Coord = number & { readonly [coordBrand]: true };

// A height: whole units, up-positive, a multiple of the engine's 8-unit step.
export type Height = number & { readonly [heightBrand]: true };

export const COORD_MAX = 65535;
export const HEIGHT_STEP = 8;

// Angles are in 256ths of a turn, as the engine's camera holds them.
export const ANGLE_STEPS = 256;

export function isCoord(n: number): n is Coord {
    return Number.isInteger(n) && n >= 0 && n <= COORD_MAX;
}

export function isHeight(n: number): n is Height {
    return Number.isSafeInteger(n) && n % HEIGHT_STEP === 0;
}

// n as a coordinate, which it must be: a bad value here is a bug, not bad input.
export function toCoord(n: number): Coord {
    if (!isCoord(n)) {
        throw new RangeError(`${n} isn't a coordinate`);
    }
    return n;
}

// n as a height, which it must be.
export function toHeight(n: number): Height {
    if (!isHeight(n)) {
        throw new RangeError(`${n} isn't a height`);
    }
    return n;
}
