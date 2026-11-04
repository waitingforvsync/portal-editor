import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { parseMap } from '../src/map/format';
import { canonicalCycle, findRegions } from '../src/map/regions';
import { joins, pts } from './helpers';

// x up the page, y right. An outer square 0..30 and an inner one 10..20.
const OUTER = pts([0, 0], [30, 0], [30, 30], [0, 30]);
const INNER = pts([10, 10], [20, 10], [20, 20], [10, 20]);
const OUTER_EDGES = joins([0, 1], [1, 2], [2, 3], [3, 0]);
const INNER_EDGES = joins([4, 5], [5, 6], [6, 7], [7, 4]);

describe('canonicalCycle', () => {
    it('gives every rotation of a cycle the same form', () => {
        expect(canonicalCycle([3, 1, 2])).toEqual([1, 2, 3]);
        expect(canonicalCycle([1, 2, 3])).toEqual([1, 2, 3]);
        expect(canonicalCycle([2, 3, 1])).toEqual([1, 2, 3]);
        expect(canonicalCycle([3, 2, 1])).toEqual([1, 3, 2]);    // reversed is another cycle
    });

    it('picks the smallest rotation when a vertex repeats', () => {
        expect(canonicalCycle([2, 1, 3, 1, 4])).toEqual([1, 3, 1, 4, 2]);
        expect(canonicalCycle([1, 4, 2, 1, 3])).toEqual([1, 3, 1, 4, 2]);
    });

    it('handles the empty and single cycles', () => {
        expect(canonicalCycle([])).toEqual([]);
        expect(canonicalCycle([7])).toEqual([7]);
    });
});

describe('findRegions', () => {
    it('finds nothing in no edges', () => {
        expect(findRegions(OUTER, [])).toEqual({ regions: [], outside: [], construction: [] });
    });

    it('finds a square, clockwise, with its outline outside', () => {
        const found = findRegions(OUTER, OUTER_EDGES);
        expect(found.regions).toEqual([{ perimeter: [0, 1, 2, 3], holes: [] }]);
        expect(found.outside).toEqual([[0, 3, 2, 1]]);
        expect(found.construction).toEqual([]);
    });

    it('finds the same regions whichever way the edges run', () => {
        const found = findRegions(OUTER, joins([1, 0], [2, 1], [2, 3], [0, 3]));
        expect(found.regions).toEqual([{ perimeter: [0, 1, 2, 3], holes: [] }]);
    });

    it('splits a square in two along a diagonal', () => {
        const found = findRegions(OUTER, [...OUTER_EDGES, ...joins([0, 2])]);
        const perimeters = found.regions.map((r) => r.perimeter).sort();
        expect(perimeters).toEqual([[0, 1, 2], [0, 2, 3]]);
        expect(found.outside).toEqual([[0, 3, 2, 1]]);
    });

    it('gives a ring its hole, and the hole its own region', () => {
        const found = findRegions([...OUTER, ...INNER], [...OUTER_EDGES, ...INNER_EDGES]);
        expect(found.regions).toHaveLength(2);
        const outer = found.regions.find((r) => r.perimeter[0] === 0)!;
        const inner = found.regions.find((r) => r.perimeter[0] === 4)!;
        expect(outer.holes).toEqual([[4, 7, 6, 5]]);
        expect(inner.holes).toEqual([]);
        expect(found.outside).toEqual([[0, 3, 2, 1]]);
    });

    it('gives a hole to the smallest region round it', () => {
        const middle = pts([5, 5], [25, 5], [25, 25], [5, 25]);
        const found = findRegions(
            [...OUTER, ...INNER, ...middle],
            [...OUTER_EDGES, ...INNER_EDGES, ...joins([8, 9], [9, 10], [10, 11], [11, 8])],
        );
        const byFirst = (v: number) => found.regions.find((r) => r.perimeter[0] === v)!;
        expect(byFirst(0).holes).toEqual([[8, 11, 10, 9]]);
        expect(byFirst(8).holes).toEqual([[4, 7, 6, 5]]);
        expect(byFirst(4).holes).toEqual([]);
    });

    it('treats a dangling edge as a construction line', () => {
        const found = findRegions([...OUTER, ...pts([15, 15])], [...OUTER_EDGES, ...joins([0, 4])]);
        expect(found.construction).toEqual([4]);
        expect(found.regions).toEqual([{ perimeter: [0, 1, 2, 3], holes: [] }]);
    });

    it('treats an edge bridging a hole to its outline as a construction line', () => {
        const found = findRegions(
            [...OUTER, ...INNER],
            [...OUTER_EDGES, ...INNER_EDGES, ...joins([0, 4])],
        );
        expect(found.construction).toEqual([8]);
        const outer = found.regions.find((r) => r.perimeter[0] === 0)!;
        expect(outer.holes).toEqual([[4, 7, 6, 5]]);
    });

    it('treats a lone edge as a construction line', () => {
        const found = findRegions(OUTER, joins([0, 1]));
        expect(found).toEqual({ regions: [], outside: [], construction: [0] });
    });

    it('keeps separate pieces separate', () => {
        const far = pts([40, 40], [50, 40], [50, 50], [40, 50]);
        const farEdges = joins([4, 5], [5, 6], [6, 7], [7, 4]);
        const found = findRegions([...OUTER, ...far], [...OUTER_EDGES, ...farEdges]);
        expect(found.regions).toHaveLength(2);
        expect(found.outside).toHaveLength(2);
        expect(found.regions.every((r) => r.holes.length === 0)).toBe(true);
    });

    it('finds the demo map as 15 regions, with its three holes where they belong', () => {
        const parsed = parseMap(demoText);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) {
            return;
        }
        const { vertices, edges } = parsed.map;
        const found = findRegions(vertices, edges);
        expect(found.regions).toHaveLength(15);
        expect(found.outside).toHaveLength(1);
        expect(found.construction).toEqual([]);
        const holesOf = (first: number, second: number) =>
            found.regions.find((r) => r.perimeter[0] === first && r.perimeter[1] === second)!.holes;
        // the pit in the pentagon ring, the pillar in the second room, the stepped pit in the
        // end room
        expect(holesOf(0, 1)).toEqual([[5, 8, 7, 6]]);
        expect(holesOf(11, 14)).toEqual([[17, 20, 19, 18]]);
        expect(holesOf(39, 40)).toEqual([[45, 50, 48, 47, 49, 46]]);
        const holed = found.regions.filter((r) => r.holes.length > 0);
        expect(holed).toHaveLength(3);
    });
});
