import { describe, expect, it } from 'vitest';

import { checkMap } from '../src/map/check';
import {
    addEdge, addVertex, deleteEdges, deleteVertices, docFromMap, moveVertices, restyleEdges,
    restyleZones, setStart, type Doc, type EditDefaults,
} from '../src/map/edit';
import { parseMap } from '../src/map/format';
import { pointInRing } from '../src/map/geometry';
import type { Zone } from '../src/map/map';
import { shadeFromName } from '../src/map/shades';
import { toHeight } from '../src/map/units';
import { mapText, pt } from './helpers';

const DEFAULTS: EditDefaults = {
    zone: {
        solid: false, floor: toHeight(8), ceiling: toHeight(200),
        floorShade: shadeFromName('KKKR')!, ceilingShade: shadeFromName('KBBB')!,
    },
    edge: { topShade: shadeFromName('BBBB')!, bottomShade: shadeFromName('KKBB')! },
};

// A square of the given size at (x, y), as vertices from first and its four edges.
function square(first: number, x: number, y: number, size: number, shade = 'KKKK'): string[] {
    return [
        `v ${x} ${y}`, `v ${x + size} ${y}`, `v ${x + size} ${y + size}`, `v ${x} ${y + size}`,
        ...[0, 1, 2, 3].map((k) => `e ${first + k} ${first + (k + 1) % 4} ${shade}`),
    ];
}

function zoneLine(first: number, floor: number): string {
    return `z ${floor} 160 KRRR KKKB ${first} ${first + 1} ${first + 2} ${first + 3}`;
}

function docOf(...lines: string[]): Doc {
    const parsed = parseMap(mapText(...lines));
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

// A doc whose map passes every check, with its regions matching its zones.
function expectValid(doc: Doc) {
    const check = checkMap(doc.map);
    expect(check.errors).toEqual([]);
    expect(doc.regions.map((r) => r.perimeter)).toEqual(check.zoneRegions.map((r) => r.perimeter));
}

// The zone whose region holds the point, if any.
function zoneAt(doc: Doc, x: number, y: number): Zone | undefined {
    const p = pt(x, y);
    const ring = (cycle: number[]) => cycle.map((v) => doc.map.vertices[v]!);
    const i = doc.regions.findIndex((r) => pointInRing(p, ring(r.perimeter)) === 'inside'
        && r.holes.every((h) => pointInRing(p, ring(h)) === 'outside'));
    return i < 0 ? undefined : doc.map.zones[i];
}

function floorAt(doc: Doc, x: number, y: number): number | 'solid' | undefined {
    const z = zoneAt(doc, x, y);
    return z === undefined ? undefined : z.solid ? 'solid' : z.floor;
}

const ROOM = docOf(...square(0, 0, 0, 100), zoneLine(0, 0));

describe('addVertex', () => {
    it('adds a vertex in empty space', () => {
        const result = addVertex(ROOM, pt(200, 200), undefined, DEFAULTS);
        expect(result.added).toEqual([4]);
        expect(result.doc.map.vertices[4]).toEqual(pt(200, 200));
        expect(result.vertexMap).toEqual([0, 1, 2, 3]);
        expectValid(result.doc);
    });

    it('gives back the vertex already at a point', () => {
        const result = addVertex(ROOM, pt(100, 0), undefined, DEFAULTS);
        expect(result.added).toEqual([1]);
        expect(result.doc.map.vertices).toHaveLength(4);
    });

    it('splits an edge it lands on, and the zone keeps its properties', () => {
        const result = addVertex(ROOM, pt(50, 0), undefined, DEFAULTS);
        expect(result.doc.map.edges).toHaveLength(5);
        expect(result.doc.map.zones[0]).toMatchObject({ floor: 0, perimeter: [0, 4, 1, 2, 3] });
        expectValid(result.doc);
    });

    it('splits an edge into pieces with both its shades', () => {
        const style = { topShade: shadeFromName('RRGG')!, bottomShade: shadeFromName('KBBB')! };
        const doc = restyleEdges(ROOM, [0], () => style);
        const { map } = addVertex(doc, pt(50, 0), undefined, DEFAULTS).doc;
        const pieces = map.edges.filter((e) => map.vertices[e.a]!.y === 0
            && map.vertices[e.b]!.y === 0);
        expect(pieces).toHaveLength(2);
        for (const e of pieces) {
            expect(e).toMatchObject(style);
        }
    });

    it('splits the edge it is given at a point beside it', () => {
        const result = addVertex(ROOM, pt(51, 1), 0, DEFAULTS);
        expect(result.doc.map.edges).toHaveLength(5);
        expect(result.doc.map.zones).toHaveLength(1);
        expect(result.doc.map.zones[0]).toMatchObject({ floor: 0 });
        expectValid(result.doc);
    });
});

describe('addEdge', () => {
    it('makes a zone, with the defaults, when it closes an outline in empty space', () => {
        let doc = docOf();
        const corners = [pt(0, 0), pt(50, 0), pt(50, 50)];
        doc = addEdge(doc, { at: corners[0]! }, { at: corners[1]! }, DEFAULTS).doc;
        doc = addEdge(doc, { vertex: 1 }, { at: corners[2]! }, DEFAULTS).doc;
        expect(doc.map.zones).toHaveLength(0);
        const result = addEdge(doc, { vertex: 2 }, { vertex: 0 }, DEFAULTS);
        expect(result.doc.map.zones).toEqual([{ ...DEFAULTS.zone, perimeter: [0, 1, 2] }]);
        for (const e of result.doc.map.edges) {
            expect(e).toMatchObject(DEFAULTS.edge);
        }
        expectValid(result.doc);
    });

    it('splits a zone in two along a chord, both halves keeping its properties', () => {
        const result = addEdge(ROOM, { vertex: 0 }, { vertex: 2 }, DEFAULTS);
        expect(result.doc.map.zones).toHaveLength(2);
        expect(result.doc.map.zones.every((z) => !z.solid && z.floor === 0)).toBe(true);
        expect(result.drawn).toEqual([0, 2]);
        expectValid(result.doc);
    });

    it('splits the edges at its ends and the ones it crosses', () => {
        // from the middle of the bottom wall, across the room and out through the top
        const result = addEdge(ROOM, { at: pt(0, 50), edge: 3 }, { at: pt(150, 50) }, DEFAULTS);
        const { map } = result.doc;
        expect(map.vertices).toHaveLength(7);
        expect(map.vertices[6]).toEqual(pt(100, 50));    // where it crosses the top wall
        expect(result.added).toEqual([4, 5]);
        expect(result.drawn).toEqual([4, 5, 6]);
        expect(map.zones).toHaveLength(2);
        expect(floorAt(result.doc, 50, 25)).toBe(0);
        expect(floorAt(result.doc, 50, 75)).toBe(0);
        expect(result.doc.construction).toHaveLength(1);    // the part sticking out
        expectValid(result.doc);
    });

    it('keeps the existing edge where it runs along one', () => {
        const result = addEdge(ROOM, { at: pt(0, -0) }, { at: pt(150, 0) }, DEFAULTS);
        const { edges } = result.doc.map;
        const along = edges.filter((e) => result.doc.map.vertices[e.a]!.y === 0
            && result.doc.map.vertices[e.b]!.y === 0);
        // the old edge and the new
        expect(along.map((e) => e.topShade).sort()).toEqual([0, DEFAULTS.edge.topShade]);
        expect(result.doc.map.zones[0]).toMatchObject({ floor: 0 });
        expectValid(result.doc);
    });

    it('gives a zone drawn inside another that zone, and the other a hole', () => {
        let doc = ROOM;
        const corners = [pt(40, 40), pt(60, 40), pt(60, 60), pt(40, 60)];
        doc = addEdge(doc, { at: corners[0]! }, { at: corners[1]! }, DEFAULTS).doc;
        doc = addEdge(doc, { vertex: 5 }, { at: corners[2]! }, DEFAULTS).doc;
        doc = addEdge(doc, { vertex: 6 }, { at: corners[3]! }, DEFAULTS).doc;
        doc = addEdge(doc, { vertex: 7 }, { vertex: 4 }, DEFAULTS).doc;
        expect(doc.map.zones).toHaveLength(2);
        expect(floorAt(doc, 50, 50)).toBe(0);
        expect(floorAt(doc, 10, 10)).toBe(0);
        expect(doc.regions.some((r) => r.holes.length === 1)).toBe(true);
        expectValid(doc);
    });

    it('does nothing for an edge from a vertex to itself', () => {
        const result = addEdge(ROOM, { vertex: 0 }, { at: pt(0, 0) }, DEFAULTS);
        expect(result.doc.map).toEqual(ROOM.map);
    });
});

describe('deleteEdges', () => {
    // two rooms side by side, the left one larger, sharing the edge 1-2
    const PAIR = docOf(
        'v 0 0', 'v 100 0', 'v 100 60', 'v 0 60', 'v 0 100', 'v 100 100',
        'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK', 'e 2 5 KKKK', 'e 5 4 KKKK',
        'e 4 3 KKKK',
        'z 0 160 KRRR KKKB 0 1 2 3', 'z 16 160 KRRR KKKB 3 2 5 4',
    );

    it('merges the zones either side, keeping the larger one', () => {
        const result = deleteEdges(PAIR, new Set([2]), DEFAULTS);
        expect(result.doc.map.zones).toHaveLength(1);
        expect(result.doc.map.zones[0]).toMatchObject({ floor: 0 });
        expect(result.vertexMap).toEqual([0, 1, 2, 3, 4, 5]);
        expectValid(result.doc);
    });

    it('loses a zone whose outline it opens', () => {
        const result = deleteEdges(ROOM, new Set([0]), DEFAULTS);
        expect(result.doc.map.zones).toEqual([]);
        expect(result.doc.map.edges).toHaveLength(3);
        expect(result.doc.map.vertices).toHaveLength(4);
        expectValid(result.doc);
    });
});

describe('deleteVertices', () => {
    it('takes their edges with them, and renumbers the rest', () => {
        const doc = docOf(...square(0, 0, 0, 100), zoneLine(0, 0), 'v 200 200');
        const result = deleteVertices(doc, new Set([1]), DEFAULTS);
        expect(result.vertexMap).toEqual([0, -1, 1, 2, 3]);
        expect(result.doc.map.vertices).toHaveLength(4);
        expect(result.doc.map.edges).toHaveLength(2);
        expect(result.doc.map.zones).toEqual([]);
        expectValid(result.doc);
    });
});

describe('moveVertices', () => {
    it('keeps a zone its properties when one corner moves', () => {
        const result = moveVertices(ROOM, new Set([2]), 20, 30, DEFAULTS);
        expect(result.doc.map.vertices[2]).toEqual(pt(120, 130));
        expect(result.doc.map.zones).toEqual([{ ...ROOM.map.zones[0], perimeter: [0, 1, 2, 3] }]);
        expectValid(result.doc);
    });

    it('merges a vertex moved onto another', () => {
        const doc = docOf(...square(0, 0, 0, 100), zoneLine(0, 0), 'v 200 0', 'e 1 4 KKKK');
        const result = moveVertices(doc, new Set([4]), -100, 100, DEFAULTS);
        expect(result.vertexMap[4]).toBe(2);
        expect(result.doc.map.vertices).toHaveLength(4);
        expect(result.doc.map.edges).toHaveLength(4);    // 1-4 became 1-2, already there
        expectValid(result.doc);
    });

    it('gives the overlap to a zone moved onto another, though it is smaller', () => {
        // A (floor 0) at 0..100, B (floor 32, larger) at y 200..400; A moves to overlap B
        const doc = docOf(...square(0, 0, 0, 100), ...square(4, 0, 200, 200),
            zoneLine(0, 0), zoneLine(4, 32));
        const result = moveVertices(doc, new Set([0, 1, 2, 3]), 0, 150, DEFAULTS);
        expect(floorAt(result.doc, 50, 175)).toBe(0);     // A alone
        expect(floorAt(result.doc, 50, 225)).toBe(0);     // the overlap
        expect(floorAt(result.doc, 150, 300)).toBe(32);   // B alone
        expect(result.doc.map.zones).toHaveLength(3);
        expectValid(result.doc);
    });

    it('forgets what a moved zone used to sit in', () => {
        // A (floor 8) sits in the big room C (floor 0); it moves into the small room B (32).
        // B's region now borders A's edges, whose other side was C's: B must stay B.
        const doc = docOf(...square(0, 0, 0, 100), ...square(4, 40, 40, 20),
            'v 400 0', 'v 450 0', 'v 450 100', 'v 400 100',
            'e 8 9 KKKK', 'e 9 10 KKKK', 'e 10 11 KKKK', 'e 11 8 KKKK',
            'z 0 160 KRRR KKKB 0 1 2 3', zoneLine(4, 8), 'z 32 160 KRRR KKKB 8 9 10 11');
        const moved = moveVertices(doc, new Set([4, 5, 6, 7]), 370, 0, DEFAULTS);
        expect(floorAt(moved.doc, 405, 10)).toBe(32);    // B, round A
        expect(floorAt(moved.doc, 420, 50)).toBe(8);     // A
        expect(floorAt(moved.doc, 50, 50)).toBe(0);      // C, its hole gone
        expectValid(moved.doc);
    });

    it('keeps a solid zone solid when moved inside a room, which gains a hole', () => {
        const doc = docOf(...square(0, 0, 0, 100), ...square(4, 200, 200, 20),
            zoneLine(0, 0), 'z solid 0 160 KRRR KKKB 4 5 6 7');
        const result = moveVertices(doc, new Set([4, 5, 6, 7]), -160, -160, DEFAULTS);
        expect(floorAt(result.doc, 50, 50)).toBe('solid');
        expect(floorAt(result.doc, 10, 10)).toBe(0);
        expect(result.doc.regions.find((r) => r.holes.length === 1)).toBeDefined();
        expectValid(result.doc);
    });

    it('lets a moved edge win where it comes to lie along another', () => {
        // two rooms with a gap between; the right one moves left to share a wall
        const doc = docOf(...square(0, 0, 0, 100, 'KKKK'), ...square(4, 0, 150, 100, 'GGGG'),
            zoneLine(0, 0), zoneLine(4, 32));
        const result = moveVertices(doc, new Set([4, 5, 6, 7]), 0, -50, DEFAULTS);
        const { map } = result.doc;
        const atY = (e: { a: number; b: number }, y: number) =>
            map.vertices[e.a]!.y === y && map.vertices[e.b]!.y === y;
        const shared = map.edges.filter((e) => atY(e, 100));
        expect(shared.map((e) => e.topShade)).toEqual([shadeFromName('GGGG')]);
        expect(floorAt(result.doc, 50, 50)).toBe(0);
        expect(floorAt(result.doc, 50, 150)).toBe(32);
        expectValid(result.doc);
    });

    it('rejects a move out of range', () => {
        expect(() => moveVertices(ROOM, new Set([0]), -1, 0, DEFAULTS)).toThrow(RangeError);
    });
});

describe('restyleZones', () => {
    const TWO = docOf(...square(0, 0, 0, 100), ...square(4, 0, 200, 100),
        zoneLine(0, 0), zoneLine(4, 32));

    it('changes the zones given, and nothing else', () => {
        const doc = restyleZones(TWO, [1], (s) => ({ ...s, floor: toHeight(64) }));
        expect(doc.map.zones.map((z) => z.floor)).toEqual([0, 64]);
        expect(doc.map.vertices).toBe(TWO.map.vertices);
        expect(doc.regions).toBe(TWO.regions);
        expect(TWO.map.zones[1]!.floor).toBe(32);
        expectValid(doc);
    });

    it('keeps a solid zone its heights and shades, to have again when it opens', () => {
        const solid = restyleZones(TWO, [0, 1], (s) => ({ ...s, solid: true }));
        expect(solid.map.zones.every((z) => z.solid)).toBe(true);
        const open = restyleZones(solid, [0, 1], (s) => ({ ...s, solid: false }));
        expect(open.map.zones).toEqual(TWO.map.zones);
    });

    it('refuses a floor at or above its ceiling, in any of the zones', () => {
        expect(() => restyleZones(TWO, [0, 1], (s) => ({ ...s, floor: toHeight(s.floor + 128) })))
            .toThrow(/zone 1's floor 160 wouldn't be below its ceiling 160/);
        expect(() => restyleZones(TWO, [0], (s) => ({ ...s, ceiling: toHeight(-8) })))
            .toThrow(RangeError);
    });
});

describe('restyleEdges', () => {
    it('changes the edges given, and nothing else', () => {
        const shade = shadeFromName('RRGG')!;
        const doc = restyleEdges(ROOM, [1, 3], (s) => ({ ...s, bottomShade: shade }));
        expect(doc.map.edges.map((e) => e.bottomShade)).toEqual([0, shade, 0, shade]);
        expect(doc.map.edges.map((e) => e.topShade)).toEqual([0, 0, 0, 0]);
        expect(doc.map.edges.map((e) => [e.a, e.b])).toEqual(ROOM.map.edges.map((e) => [e.a, e.b]));
        expect(ROOM.map.edges[1]!.bottomShade).toBe(0);
        expectValid(doc);
    });
});

describe('setStart', () => {
    it('puts the start, and leaves the rest be', () => {
        const doc = setStart(ROOM, 30, 40, 64);
        expect(doc.map.start).toEqual({ x: 30, y: 40, angle: 64 });
        expect(doc.map.vertices).toBe(ROOM.map.vertices);
        expect(doc.map.zones).toBe(ROOM.map.zones);
        expect(doc.regions).toBe(ROOM.regions);
        expect(ROOM.map.start).not.toEqual(doc.map.start);
    });

    it('wraps the angle round', () => {
        expect(setStart(ROOM, 0, 0, -8).map.start.angle).toBe(248);
        expect(setStart(ROOM, 0, 0, 256 + 3).map.start.angle).toBe(3);
    });

    it('refuses a point off the map, or a part of a step', () => {
        expect(() => setStart(ROOM, -1, 0, 0)).toThrow(/would be off the map/);
        expect(() => setStart(ROOM, 0, 65536, 0)).toThrow(RangeError);
        expect(() => setStart(ROOM, 0, 0, 1.5)).toThrow(/isn't a whole number/);
    });
});
