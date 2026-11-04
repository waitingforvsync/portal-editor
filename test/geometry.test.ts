import { describe, expect, it } from 'vitest';

import {
    compareDirections, onSegmentInterior, pointInRing, ringArea2, segmentsCross, side,
} from '../src/map/geometry';
import { pt, pts } from './helpers';

// x up the page, y right: (0,0) bottom left, (10,0) top left, (10,10) top right.
const SQUARE = pts([0, 0], [10, 0], [10, 10], [0, 10]);

describe('side', () => {
    it('is positive on the right of a line, as seen in plan', () => {
        expect(side(pt(0, 0), pt(10, 0), pt(5, 5))).toBeGreaterThan(0);    // up, point to the right
        expect(side(pt(0, 0), pt(10, 0), pt(5, 0))).toBe(0);
        expect(side(pt(10, 0), pt(0, 0), pt(5, 5))).toBeLessThan(0);
    });

    it('is exact at the extremes of the coordinate range', () => {
        const [a, b, p] = [pt(0, 0), pt(65535, 65534), pt(65534, 65533)];
        const exact = (65535n - 0n) * (65533n - 0n) - (65534n - 0n) * (65534n - 0n);
        expect(BigInt(side(a, b, p))).toBe(exact);
        expect(side(pt(1, 0), pt(65535, 65534), pt(65535, 65535))).toBe(65534);
    });
});

describe('ringArea2', () => {
    it('is positive for a clockwise ring, negative reversed, twice the area', () => {
        expect(ringArea2(SQUARE)).toBe(200);
        expect(ringArea2([...SQUARE].reverse())).toBe(-200);
        expect(ringArea2(pts([0, 0], [5, 5], [10, 10]))).toBe(0);
        expect(ringArea2([])).toBe(0);
    });

    it('is exact over the whole coordinate range', () => {
        const whole = pts([0, 0], [65535, 0], [65535, 65535], [0, 65535]);
        expect(ringArea2(whole)).toBe(2 * 65535 * 65535);
    });
});

describe('onSegmentInterior', () => {
    it('finds points strictly inside a segment only', () => {
        expect(onSegmentInterior(pt(0, 0), pt(10, 10), pt(5, 5))).toBe(true);
        expect(onSegmentInterior(pt(0, 0), pt(10, 10), pt(0, 0))).toBe(false);
        expect(onSegmentInterior(pt(0, 0), pt(10, 10), pt(10, 10))).toBe(false);
        expect(onSegmentInterior(pt(0, 0), pt(10, 10), pt(11, 11))).toBe(false);
        expect(onSegmentInterior(pt(1, 1), pt(10, 10), pt(0, 0))).toBe(false);
        expect(onSegmentInterior(pt(0, 0), pt(10, 10), pt(5, 6))).toBe(false);
        expect(onSegmentInterior(pt(0, 0), pt(0, 10), pt(0, 5))).toBe(true);
    });
});

describe('segmentsCross', () => {
    it('finds proper crossings only', () => {
        const [o, d] = [pt(0, 0), pt(10, 10)];
        expect(segmentsCross(o, d, pt(0, 10), pt(10, 0))).toBe(true);
        expect(segmentsCross(o, d, pt(5, 5), pt(10, 0))).toBe(false);      // touches
        expect(segmentsCross(o, d, pt(10, 10), pt(20, 0))).toBe(false);    // shares an end
        expect(segmentsCross(o, d, pt(5, 5), pt(15, 15))).toBe(false);     // overlaps
        expect(segmentsCross(o, pt(10, 0), pt(0, 1), pt(10, 1))).toBe(false);    // parallel
        expect(segmentsCross(o, pt(1, 1), pt(5, 0), pt(0, 5))).toBe(false);      // short of it
    });
});

describe('pointInRing', () => {
    it('tells inside, outside and boundary', () => {
        expect(pointInRing(pt(5, 5), SQUARE)).toBe('inside');
        expect(pointInRing(pt(15, 5), SQUARE)).toBe('outside');
        expect(pointInRing(pt(5, 15), SQUARE)).toBe('outside');
        expect(pointInRing(pt(10, 5), SQUARE)).toBe('boundary');
        expect(pointInRing(pt(0, 0), SQUARE)).toBe('boundary');
        expect(pointInRing(pt(5, 5), [...SQUARE].reverse())).toBe('inside');
    });

    it('counts a ray through a vertex once', () => {
        const diamond = pts([0, 5], [5, 10], [10, 5], [5, 0]);
        expect(pointInRing(pt(5, 2), diamond)).toBe('inside');
        expect(pointInRing(pt(5, 1), diamond)).toBe('inside');
        expect(pointInRing(pt(10, 1), diamond)).toBe('outside');    // level with the top vertex
        expect(pointInRing(pt(0, 1), diamond)).toBe('outside');     // level with the bottom one
    });

    it('handles a concave ring', () => {
        // a U opening upward (in plan): the notch is outside
        const u = pts([0, 0], [10, 0], [10, 3], [3, 3], [3, 7], [10, 7], [10, 10], [0, 10]);
        expect(pointInRing(pt(8, 5), u)).toBe('outside');
        expect(pointInRing(pt(2, 5), u)).toBe('inside');
        expect(pointInRing(pt(8, 1), u)).toBe('inside');
        expect(pointInRing(pt(3, 5), u)).toBe('boundary');
    });
});

describe('compareDirections', () => {
    it('orders directions as atan2 does, from +x', () => {
        const dirs: [number, number][] = [
            [-1, -1], [1, 0], [0, -1], [-1, 1], [1, -1], [0, 1], [-1, 0], [1, 1],
        ];
        const sorted = [...dirs].sort((p, q) => compareDirections(p[0], p[1], q[0], q[1]));
        const byAtan = [...dirs].sort((p, q) => {
            const angle = (d: [number, number]) =>
                (Math.atan2(d[1], d[0]) + 2 * Math.PI) % (2 * Math.PI);
            return angle(p) - angle(q);
        });
        expect(sorted).toEqual(byAtan);
        expect(sorted[0]).toEqual([1, 0]);
    });

    it('tells opposite directions apart, and near ones exactly', () => {
        expect(compareDirections(1, 0, -1, 0)).toBeLessThan(0);
        expect(compareDirections(-1, 0, 1, 0)).toBeGreaterThan(0);
        expect(compareDirections(0, 1, 0, -1)).toBeLessThan(0);
        expect(compareDirections(65535, 65534, 65534, 65533)).toBeGreaterThan(0);
        expect(compareDirections(65534, 65533, 65535, 65534)).toBeLessThan(0);
    });
});
