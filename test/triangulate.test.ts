import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { parseMap } from '../src/map/format';
import { pointInRing, ringArea2, side, type Point } from '../src/map/geometry';
import type { Vertex } from '../src/map/map';
import { findRegions, type Region } from '../src/map/regions';
import { triangulate } from '../src/map/triangulate';
import { toCoord } from '../src/map/units';
import { pts } from './helpers';

// Twice the region's area: its perimeter's, less its holes'.
function area2(vertices: readonly Vertex[], region: Region): number {
    const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
    return [region.perimeter, ...region.holes].reduce((sum, c) => sum + ringArea2(ring(c)), 0);
}

// Triangles that cover the region exactly: each clockwise, inside it, adding up to its area.
function expectCovers(vertices: readonly Vertex[], region: Region) {
    const triangles = triangulate(vertices, region);
    let sum = 0;
    for (const [a, b, c] of triangles) {
        const [p, q, r] = [vertices[a]!, vertices[b]!, vertices[c]!];
        const twice = side(p, q, r);
        expect(twice).toBeGreaterThan(0);
        sum += twice;
        // the centroid, scaled by 3 with the rings, lies inside the region
        const scale = (v: Vertex): Point => ({ x: toCoord(v.x * 3), y: toCoord(v.y * 3) });
        const centre: Point = { x: toCoord(p.x + q.x + r.x), y: toCoord(p.y + q.y + r.y) };
        const ring = (cycle: readonly number[]) => cycle.map((v) => scale(vertices[v]!));
        expect(pointInRing(centre, ring(region.perimeter))).toBe('inside');
        for (const hole of region.holes) {
            expect(pointInRing(centre, ring(hole))).toBe('outside');
        }
    }
    expect(sum).toBe(area2(vertices, region));
    return triangles;
}

describe('triangulate', () => {
    it('cuts a square in two', () => {
        const vertices = pts([0, 0], [10, 0], [10, 10], [0, 10]);
        expect(expectCovers(vertices, { perimeter: [0, 1, 2, 3], holes: [] })).toHaveLength(2);
    });

    it('cuts a concave outline', () => {
        // an L, clockwise in plan (x up, y right)
        const vertices = pts([0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]);
        const region = { perimeter: [0, 1, 2, 3, 4, 5], holes: [] };
        expect(expectCovers(vertices, region)).toHaveLength(4);
    });

    it('keeps vertices on a straight run', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]);
        const region = { perimeter: [0, 1, 2, 3, 4, 5, 6, 7], holes: [] };
        const triangles = expectCovers(vertices, region);
        expect(new Set(triangles.flat()).size).toBe(8);
    });

    it('cuts round holes', () => {
        const vertices = pts([0, 0], [100, 0], [100, 100], [0, 100],
            [20, 20], [20, 40], [40, 40], [40, 20],
            [60, 60], [60, 80], [80, 80], [80, 60],
            [60, 20], [60, 40], [80, 40], [80, 20]);
        const region = { perimeter: [0, 1, 2, 3], holes: [[4, 5, 6, 7], [8, 9, 10, 11],
            [12, 13, 14, 15]] };
        // a ring of n vertices and h holes makes n + 2h - 2 triangles
        expect(expectCovers(vertices, region)).toHaveLength(16 + 2 * 3 - 2);
    });

    it('cuts a hole that can only see the outline past another hole', () => {
        // two holes side by side, the inner one boxed in on three sides by a U of the outline
        const vertices = pts([0, 0], [100, 0], [100, 100], [0, 100],
            [10, 45], [10, 55], [20, 55], [20, 45],
            [40, 10], [40, 90], [60, 90], [60, 10]);
        const region = { perimeter: [0, 1, 2, 3], holes: [[4, 5, 6, 7], [8, 9, 10, 11]] };
        expectCovers(vertices, region);
    });

    it('cuts every zone of the demo map', () => {
        const parsed = parseMap(demoText);
        if (!parsed.ok) {
            throw new Error(parsed.errors.join('\n'));
        }
        const { vertices, edges } = parsed.map;
        for (const region of findRegions(vertices, edges).regions) {
            expectCovers(vertices, region);
        }
    });
});
