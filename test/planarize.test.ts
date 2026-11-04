import { describe, expect, it } from 'vitest';

import { checkMap } from '../src/map/check';
import type { PortalMap } from '../src/map/map';
import { planarize, type DraftEdge } from '../src/map/planarize';
import { pt, pts } from './helpers';

function drafts(...pairs: [number, number][]): DraftEdge[] {
    return pairs.map(([a, b], i) => ({ a, b, shade: i, source: i, rank: 1, tags: 0 }));
}

// The result's edges as [a, b] pairs, in order.
function pairs(result: ReturnType<typeof planarize>): [number, number][] {
    return result.edges.map((e) => [e.a, e.b]);
}

// The result passes the map checks for edges and vertices (no zones needed).
function expectPlanar(result: ReturnType<typeof planarize>) {
    const map: PortalMap = {
        start: { ...pt(0, 0), angle: 0 },
        vertices: result.vertices,
        edges: result.edges.map(({ a, b, shade }) => ({ a, b, shade: shade % 35 })),
        zones: [],
    };
    const errors = checkMap(map).errors.filter((e) => !e.startsWith('no zone'));
    expect(errors).toEqual([]);
}

describe('planarize', () => {
    it('leaves planar edges as they are', () => {
        const square = pts([0, 0], [10, 0], [10, 10], [0, 10]);
        const result = planarize(square, drafts([0, 1], [1, 2], [2, 3], [3, 0]));
        expect(result.vertices).toEqual(square);
        expect(pairs(result)).toEqual([[0, 1], [1, 2], [2, 3], [3, 0]]);
        expect(result.vertexMap).toEqual([0, 1, 2, 3]);
    });

    it('merges vertices at one point, and drops the edges between them', () => {
        const vertices = pts([0, 0], [10, 0], [0, 0], [5, 5]);
        const result = planarize(vertices, drafts([0, 1], [2, 3], [0, 2]));
        expect(result.vertices).toEqual(pts([0, 0], [10, 0], [5, 5]));
        expect(result.vertexMap).toEqual([0, 1, 0, 2]);
        expect(pairs(result)).toEqual([[0, 1], [0, 2]]);
    });

    it('splits an edge at a vertex on it, both pieces keeping its source and direction', () => {
        const result = planarize(pts([0, 0], [10, 0], [5, 0]), drafts([1, 0]));
        expect(pairs(result)).toEqual([[1, 2], [2, 0]]);
        expect(result.edges.map((e) => e.source)).toEqual([0, 0]);
    });

    it('splits crossing edges where they cross', () => {
        const result = planarize(pts([0, 0], [10, 10], [0, 10], [10, 0]), drafts([0, 1], [2, 3]));
        expect(result.vertices[4]).toEqual(pt(5, 5));
        expect(pairs(result)).toEqual([[0, 4], [4, 1], [2, 4], [4, 3]]);
        expect(result.edges.map((e) => e.source)).toEqual([0, 0, 1, 1]);
    });

    it('rounds a crossing to whole units', () => {
        // these cross at (5, 1.5)
        const result = planarize(pts([0, 0], [10, 3], [0, 3], [10, 0]), drafts([0, 1], [2, 3]));
        expect(result.vertices[4]).toEqual(pt(5, 2));
        expect(result.edges).toHaveLength(4);
        expectPlanar(result);
    });

    it('splits an edge at several crossings in order along it', () => {
        // a long edge up x at y 5, crossed at x 30, 10 and 20
        const vertices = pts([0, 5], [40, 5], [30, 0], [30, 10], [10, 0], [10, 10],
            [20, 0], [20, 10]);
        const result = planarize(vertices, drafts([0, 1], [2, 3], [4, 5], [6, 7]));
        const pieces = result.edges.filter((e) => e.source === 0);
        const along = pieces.map((e) => result.vertices[e.b]!.x);
        expect(along).toEqual([10, 20, 30, 40]);
        expectPlanar(result);
    });

    it('meets three edges through one point at one vertex', () => {
        const result = planarize(pts([0, 0], [10, 10], [0, 10], [10, 0], [5, 0], [5, 10]),
            drafts([0, 1], [2, 3], [4, 5]));
        expect(result.vertices).toHaveLength(7);
        expect(result.vertices[6]).toEqual(pt(5, 5));
        expect(result.edges).toHaveLength(6);
        expectPlanar(result);
    });

    it('keeps one edge where two overlap, the higher rank, with both tags', () => {
        const edges: DraftEdge[] = [
            { a: 0, b: 1, shade: 1, source: 0, rank: 1, tags: 1 },
            { a: 2, b: 3, shade: 2, source: -1, rank: 2, tags: 2 },
        ];
        const result = planarize(pts([0, 0], [0, 10], [0, 5], [0, 15]), edges);
        expect(result.edges).toHaveLength(3);
        const middle = result.edges.find((e) => e.a + e.b === 3 && e.a * e.b === 2)!;    // 1-2
        expect(middle).toMatchObject({ shade: 2, source: -1, tags: 3 });
        expectPlanar(result);
    });

    it('only tests what is dirty, and finds the same as testing everything', () => {
        // a square, and an edge moved to start on its side and cross it
        const vertices = pts([0, 0], [10, 0], [10, 10], [0, 10], [5, 0], [5, 20]);
        const edges = drafts([0, 1], [1, 2], [2, 3], [3, 0], [4, 5]);
        const full = planarize(vertices, edges);
        const limited = planarize(vertices, edges, new Set([4, 5]), new Set([4]));
        expect(limited).toEqual(full);
        expectPlanar(full);
    });

    it('finds a vertex that a crossing lands on another edge', () => {
        // the crossing of the first two edges is at (5, 5), on the third, which isn't dirty
        const vertices = pts([0, 0], [10, 10], [0, 10], [10, 0], [5, 0], [5, 10]);
        const edges = drafts([0, 1], [2, 3], [4, 5]);
        const result = planarize(vertices, edges, new Set(), new Set([0, 1]));
        expect(result.edges).toHaveLength(6);
        expectPlanar(result);
    });
});
