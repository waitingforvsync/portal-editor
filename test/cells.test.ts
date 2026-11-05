import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { convexCells, fan, MAX_RING, zoneCells } from '../src/map/cells';
import { docFromMap, moveVertices, restyleZones, setStart } from '../src/map/edit';
import { parseMap } from '../src/map/format';
import { ringArea2, side } from '../src/map/geometry';
import type { Vertex } from '../src/map/map';
import type { Region } from '../src/map/regions';
import { zoneStyle } from '../src/map/zones';
import { pts } from './helpers';

// Cells that cut the region exactly: each convex, clockwise and within MAX_RING sides; their
// areas adding up to the region's; every vertex of the region in one; and each side either
// one of the region's own or shared with another cell, the other way round.
function expectCells(vertices: readonly Vertex[], region: Region): number[][] {
    const cells = convexCells(vertices, region);
    const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
    const cycles = [region.perimeter, ...region.holes];
    const outline = new Set<string>();
    for (const cycle of cycles) {
        cycle.forEach((u, k) => outline.add(`${u} ${cycle[(k + 1) % cycle.length]}`));
    }
    const sides = new Set<string>();
    let area = 0;
    for (const cell of cells) {
        expect(cell.length).toBeGreaterThanOrEqual(3);
        expect(cell.length).toBeLessThanOrEqual(MAX_RING);
        const n = cell.length;
        cell.forEach((v, k) => {
            const turn = side(vertices[cell[(k + n - 1) % n]!]!, vertices[v]!,
                vertices[cell[(k + 1) % n]!]!);
            expect(turn).toBeGreaterThanOrEqual(0);
            sides.add(`${v} ${cell[(k + 1) % n]}`);
        });
        area += ringArea2(ring(cell));
    }
    expect(area).toBe(cycles.reduce((sum, c) => sum + ringArea2(ring(c)), 0));
    expect(new Set(cells.flat())).toEqual(new Set(cycles.flat()));
    for (const s of sides) {
        const [u, v] = s.split(' ');
        expect(outline.has(s) || sides.has(`${v} ${u}`)).toBe(true);
    }
    for (const s of outline) {
        expect(sides.has(s)).toBe(true);
    }
    return cells;
}

describe('convexCells', () => {
    it('leaves a convex zone whole', () => {
        const vertices = pts([0, 0], [10, 0], [10, 10], [0, 10]);
        expect(expectCells(vertices, { perimeter: [0, 1, 2, 3], holes: [] })).toEqual([
            expect.arrayContaining([0, 1, 2, 3]),
        ]);
    });

    it('cuts an L in two', () => {
        const vertices = pts([0, 0], [20, 0], [20, 10], [10, 10], [10, 20], [0, 20]);
        expect(expectCells(vertices, { perimeter: [0, 1, 2, 3, 4, 5], holes: [] })).toHaveLength(2);
    });

    it('keeps vertices on a straight run, which a cell may run straight through', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 5], [10, 10], [5, 10], [0, 10], [0, 5]);
        const cells = expectCells(vertices, { perimeter: [0, 1, 2, 3, 4, 5, 6, 7], holes: [] });
        expect(cells).toHaveLength(1);
    });

    it('keeps cells within the engine\'s sides a cell', () => {
        // a square with three vertices along each side: 16 sides in all
        const corners = pts([0, 0], [4, 0], [8, 0], [12, 0], [16, 0], [16, 4], [16, 8], [16, 12],
            [16, 16], [12, 16], [8, 16], [4, 16], [0, 16], [0, 12], [0, 8], [0, 4]);
        const perimeter = corners.map((_, i) => i);
        expect(expectCells(corners, { perimeter, holes: [] }).length).toBeGreaterThan(1);
    });

    it('cuts round a hole', () => {
        const vertices = pts([0, 0], [30, 0], [30, 30], [0, 30], [10, 10], [10, 20], [20, 20],
            [20, 10]);
        const cells = expectCells(vertices, { perimeter: [0, 1, 2, 3], holes: [[4, 5, 6, 7]] });
        expect(cells.length).toBeLessThanOrEqual(5);
    });

    it('cuts every zone of the demo map', () => {
        const parsed = parseMap(demoText);
        if (!parsed.ok) {
            throw new Error(parsed.errors.join('\n'));
        }
        const { vertices, zones } = parsed.map;
        const counts = parsed.zoneRegions.map((region, z) =>
            (zones[z]!.solid ? 0 : expectCells(vertices, region).length));
        // portalc's own demo scene, cut by hand, has 27
        expect(counts.reduce((a, b) => a + b, 0)).toBe(26);
    });
});

describe('fan', () => {
    it('makes triangles across a cell, leaving out any with no area', () => {
        const vertices = pts([0, 0], [5, 0], [10, 0], [10, 10], [0, 10]);
        // from vertex 0, the first triangle (0, 1, 2) lies along a side
        expect(fan(vertices, [0, 1, 2, 3, 4])).toEqual([[0, 2, 3], [0, 3, 4]]);
    });
});

describe('zoneCells', () => {
    const parsed = parseMap(demoText);
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    const doc = docFromMap(parsed.map, parsed.zoneRegions);

    it('keeps the cells through edits that leave the geometry be', () => {
        const cells = zoneCells(doc);
        expect(zoneCells(setStart(doc, 100, 100, 0))).toBe(cells);
        expect(zoneCells(restyleZones(doc, [0], (s) => ({ ...s, solid: true })))).toBe(cells);
    });

    it('works them out again when the geometry changes', () => {
        const defaults = {
            zone: zoneStyle(parsed.map.zones[0]!),
            edge: { topShade: 0, bottomShade: 0 },
        };
        const moved = moveVertices(doc, new Set([0]), 8, 0, defaults).doc;
        expect(zoneCells(moved)).not.toBe(zoneCells(doc));
    });
});
