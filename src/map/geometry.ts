// geometry.ts - exact predicates on whole-unit points. Coordinates fit 16 bits, so every
// product here (and a ring's area, summed over up to 2^20 vertices) fits a double's 53-bit
// mantissa, and the results are exact.
//
// Orientation follows the engine (portalc map.h): seen in plan, x up the page and y right,
// rings run clockwise, with their interior on the right of each side.

import type { Coord } from './units';

export interface Point {
    readonly x: Coord;
    readonly y: Coord;
}

// Which side of the line a->b point p is on: positive on the right (a ring's interior, as
// portalc's pt_map_edge_side), negative on the left, 0 on the line. Twice the triangle's area.
export function side(a: Point, b: Point, p: Point): number {
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

// Twice a ring's signed area: positive when it runs clockwise.
export function ringArea2(ring: readonly Point[]): number {
    let sum = 0;
    for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const q = ring[(i + 1) % ring.length]!;
        sum += p.x * q.y - q.x * p.y;
    }
    return sum;
}

// True when p lies strictly between a and b on the segment joining them.
export function onSegmentInterior(a: Point, b: Point, p: Point): boolean {
    if (side(a, b, p) !== 0) {
        return false;
    }
    const along = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    const back = (p.x - b.x) * (a.x - b.x) + (p.y - b.y) * (a.y - b.y);
    return along > 0 && back > 0;
}

// True when segments a-b and c-d cross at a point inside both. Touching at an end, or lying
// along each other, isn't crossing: onSegmentInterior finds those.
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
    return (
        Math.sign(side(a, b, c)) * Math.sign(side(a, b, d)) < 0 &&
        Math.sign(side(c, d, a)) * Math.sign(side(c, d, b)) < 0
    );
}

export type Containment = 'inside' | 'outside' | 'boundary';

// Where p lies against a ring (either winding).
export function pointInRing(p: Point, ring: readonly Point[]): Containment {
    let inside = false;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const s = side(a, b, p);
        if (s === 0 && Math.min(a.x, b.x) <= p.x && p.x <= Math.max(a.x, b.x)
            && Math.min(a.y, b.y) <= p.y && p.y <= Math.max(a.y, b.y)) {
            return 'boundary';
        }
        // a ray from p toward +y crosses a-b where a-b spans p's x (half-open), on p's
        // +y side: there, side() and the run in x have opposite signs
        if ((a.x > p.x) !== (b.x > p.x) && Math.sign(s) !== Math.sign(b.x - a.x)) {
            inside = !inside;
        }
    }
    return inside ? 'inside' : 'outside';
}

// Orders directions as atan2(dy, dx) does, from +x round: in plan, clockwise from straight
// up. For sorting a vertex's edges round it. Exact; dx and dy aren't both 0.
export function compareDirections(dx0: number, dy0: number, dx1: number, dy1: number): number {
    const half0 = dy0 > 0 || (dy0 === 0 && dx0 > 0) ? 0 : 1;
    const half1 = dy1 > 0 || (dy1 === 0 && dx1 > 0) ? 0 : 1;
    if (half0 !== half1) {
        return half0 - half1;
    }
    return -(dx0 * dy1 - dy0 * dx1);
}
