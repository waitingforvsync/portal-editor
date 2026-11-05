import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { docFromMap, type Doc } from '../src/map/edit';
import {
    angleByte, encode, exportMap, EYE_STEPS, HEADER_SIZE, quadrant, type EngineMap,
} from '../src/map/export';
import { parseMap } from '../src/map/format';
import { mapText } from './helpers';

function docOf(text: string): Doc {
    const parsed = parseMap(text);
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

const DEMO = docOf(demoText);

// The tables back from the bytes, as the engine would read them: a count of 0 is 256.
function decode(bytes: Uint8Array) {
    const count = (n: number) => n || 256;
    const [V, C, E, S] = [0, 1, 2, 3].map((i) => count(bytes[i]!)) as
        [number, number, number, number];
    let at = HEADER_SIZE;
    const take = (n: number) => {
        const t = [...bytes.slice(at, at + n)];
        at += n;
        return t;
    };
    const word = (lo: number[], hi: number[]) => lo.map((l, i) => l + 256 * hi[i]!);
    const x = word(take(V), take(V));
    const y = word(take(V), take(V));
    const first = take(C + 1);
    const t = {
        V, C, E, S, x, y, first,
        floorZ: take(C), ceilZ: take(C), floor: take(C), ceil: take(C),
        angle: take(E), colour: take(E), len8: take(E),
        v: take(S), edge: take(S), adj: take(S), anghi: take(S), entry: take(S),
        start: {
            x: bytes[4]! + 256 * bytes[5]!, y: bytes[6]! + 256 * bytes[7]!, angle: bytes[8]!,
            cell: bytes[9]!,
        },
    };
    expect(at).toBe(bytes.length);
    return t;
}

type Tables = ReturnType<typeof decode>;

// portalc's map.c pt_map_validate, on the tables: rings that close with one twin a portal,
// edges named once a wall and twice a portal, angles right, rings clockwise and convex, soft
// edges between cells alike, centres inside; and the entries, heights and start.
function validate(m: Tables): string[] {
    const problems: string[] = [];
    const end = (c: number) => (c + 1 < m.C ? m.first[c + 1]! : m.S);
    const next = (c: number, s: number) => (s + 1 === end(c) ? m.first[c]! : s + 1);
    const v1 = (c: number, s: number) => m.v[next(c, s)]!;
    const cellOf = (s: number) => {
        for (let c = 1; c < m.C; c++) {
            if (s >= m.first[c]! && s < end(c)) {
                return c;
            }
        }
        return 0;
    };
    if (m.first[m.C]! !== (m.S & 255)) {
        problems.push('the rings don\'t end where the sides do');
    }
    const named = new Array<number>(m.E).fill(0);
    const wall = new Array<boolean>(m.E).fill(false);
    for (let c = 1; c < m.C; c++) {
        const n = end(c) - m.first[c]!;
        if (n < 3 || n > 8) {
            problems.push(`cell ${c} has ${n} sides`);
        }
        if (m.floorZ[c]! <= m.ceilZ[c]! || m.floorZ[c]! < EYE_STEPS) {
            problems.push(`cell ${c}'s heights`);
        }
        let cx = 0;
        let cy = 0;
        for (let s = m.first[c]!; s < end(c); s++) {
            cx += m.x[m.v[s]!]!;
            cy += m.y[m.v[s]!]!;
        }
        cx = Math.floor(cx / n);
        cy = Math.floor(cy / n);
        for (let s = m.first[c]!; s < end(c); s++) {
            const e = m.edge[s]!;
            named[e]!++;
            wall[e] = m.adj[s] === 0;
            const [ax, ay] = [m.x[m.v[s]!]!, m.y[m.v[s]!]!];
            const [bx, by] = [m.x[v1(c, s)]!, m.y[v1(c, s)]!];
            const [dx, dy] = [bx - ax, by - ay];
            if (m.adj[s]) {
                const d = m.adj[s]!;
                const twins = [];
                for (let t = m.first[d]!; t < end(d); t++) {
                    if (m.edge[t] === e) {
                        twins.push(t);
                    }
                }
                const t = twins[0]!;
                if (twins.length !== 1 || m.adj[t] !== c || m.v[t] !== v1(c, s)
                    || v1(d, t) !== m.v[s]) {
                    problems.push(`side ${s}'s twin`);
                }
                if (m.entry[s] !== next(d, t)) {
                    problems.push(`side ${s}'s entry`);
                }
                if (m.colour[e] === 0 && (m.floorZ[c] !== m.floorZ[d] || m.ceilZ[c] !== m.ceilZ[d]
                    || m.floor[c] !== m.floor[d] || m.ceil[c] !== m.ceil[d])) {
                    problems.push(`soft side ${s} between cells unalike`);
                }
            } else if (m.colour[e] === 0) {
                problems.push(`wall side ${s} is soft`);
            }
            if (m.anghi[s] !== quadrant(dx, dy)) {
                problems.push(`side ${s}'s quadrant`);
            }
            let true1024 = Math.atan2(dy, dx) * (512 / Math.PI);
            if (true1024 < 0) {
                true1024 += 1024;
            }
            let diff = ((m.anghi[s]! << 8) | m.angle[e]!) - true1024;
            if (diff > 512) {
                diff -= 1024;
            }
            if (diff < -1 - 1e-9 || diff > 1e-9) {
                problems.push(`side ${s}'s angle`);
            }
            if (m.len8[e] !== Math.floor(Math.hypot(dx, dy) / 8)) {
                problems.push(`edge ${e}'s length`);
            }
            const sn = next(c, s);
            const [px, py] = [m.x[m.v[sn]!]!, m.y[m.v[sn]!]!];
            const [qx, qy] = [m.x[v1(c, sn)]!, m.y[v1(c, sn)]!];
            if ((px - ax) * (qy - py) - (py - ay) * (qx - px) < 0) {
                problems.push(`cell ${c} isn't clockwise and convex at side ${s}`);
            }
            if (dx * (cy - ay) - dy * (cx - ax) <= 0) {
                problems.push(`cell ${c}'s centre isn't inside side ${s}`);
            }
        }
    }
    for (let e = 0; e < m.E; e++) {
        if (named[e] !== (wall[e] ? 1 : 2)) {
            problems.push(`edge ${e} is named ${named[e]} times`);
        }
    }
    const { start } = m;
    for (let s = m.first[start.cell]!; s < end(start.cell); s++) {
        const [ax, ay] = [m.x[m.v[s]!]!, m.y[m.v[s]!]!];
        const [bx, by] = [m.x[v1(start.cell, s)]!, m.y[v1(start.cell, s)]!];
        if ((bx - ax) * (start.y - ay) - (by - ay) * (start.x - ax) < 0) {
            problems.push('the start isn\'t in its cell');
        }
    }
    if (start.cell === 0 || cellOf(m.first[start.cell]!) !== start.cell) {
        problems.push('no start cell');
    }
    return problems;
}

function exported(doc: Doc): { engine: EngineMap; tables: Tables } {
    const result = exportMap(doc);
    if (!result.ok) {
        throw new Error(result.errors.join('\n'));
    }
    return { engine: result.engine, tables: decode(result.bytes) };
}

describe('quadrant and angleByte', () => {
    it('put each axis at its quadrant\'s start', () => {
        expect([[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => quadrant(x!, y!)))
            .toEqual([0, 1, 2, 3]);
        expect([[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => angleByte(x!, y!)))
            .toEqual([0, 0, 0, 0]);
    });

    it('serve an edge either way round', () => {
        expect(angleByte(3, 1)).toBe(angleByte(-3, -1));
        expect(angleByte(1, 1)).toBe(128);
        expect(quadrant(-3, -1)).toBe((quadrant(3, 1) + 2) % 4);
    });
});

describe('exportMap: the demo', () => {
    const { engine, tables } = exported(DEMO);

    it('passes portalc\'s map validation', () => {
        expect(validate(tables)).toEqual([]);
    });

    it('holds the open zones\' cells and what they use', () => {
        expect(tables.V).toBe(55);
        expect(tables.C).toBe(27);    // 26 cells and the outside
        expect(engine.cells.slice(1).every((c) => !DEMO.map.zones[c.zone]!.solid)).toBe(true);
        const size = HEADER_SIZE + 4 * tables.V + (tables.C + 1) + 4 * tables.C + 3 * tables.E
            + 5 * tables.S;
        expect(encode(engine).length).toBe(size);
    });

    it('keeps the heights apart as the editor has them, z downwards, the top at 0', () => {
        const zoneZ = (z: number) => engine.cells.find((c) => c.zone === z)!;
        // the main floor 0 and its ceiling 160; the pit's floor -24; the end room's ceiling 224
        expect(zoneZ(1).floorZ - zoneZ(1).ceilZ).toBe(160 / 8);
        expect(zoneZ(0).floorZ - zoneZ(1).floorZ).toBe(24 / 8);
        expect(Math.min(...engine.cells.slice(1).map((c) => c.ceilZ))).toBe(0);
        expect(zoneZ(10).ceilZ).toBe(0);
    });

    it('colours map edges by their shade, and soft edges 0 within a zone', () => {
        for (const [s, side] of engine.sides.entries()) {
            const e = engine.edges[side.edge]!;
            const cell = engine.cells.findIndex((c, i) => i > 0 && s >= c.first
                && (i + 1 === engine.cells.length || s < engine.cells[i + 1]!.first));
            const sameZone = side.adj !== 0
                && engine.cells[side.adj]!.zone === engine.cells[cell]!.zone;
            expect(e.colour === 0).toBe(sameZone);
        }
    });

    it('starts in the pentagon, facing as the map says', () => {
        expect(tables.start).toMatchObject({ x: 1756, y: 1536, angle: 128 });
        expect(engine.cells[tables.start.cell]!.zone).toBe(1);
    });
});

describe('exportMap: what it refuses', () => {
    const room = (size: number, floor: number, ceiling: number, start = 'start 5 5 0') =>
        ['portalmap 1', start, 'v 0 0', `v ${size} 0`, `v ${size} ${size}`, `v 0 ${size}`,
            'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK',
            `z ${floor} ${ceiling} KRRR KKKB 0 1 2 3`].join('\n');

    const errors = (text: string) => {
        const result = exportMap(docOf(text));
        return result.ok ? [] : result.errors;
    };

    it('a start outside every open zone', () => {
        expect(errors(room(100, 0, 160, 'start 500 500 0'))).toEqual([
            'the start (500, 500) isn\'t inside an open zone',
        ]);
    });

    it('an edge too long for its length byte', () => {
        expect(errors(room(2048, 0, 160)).join('\n')).toContain('edge 0 (vertex 0 to 1) is 2048');
        expect(errors(room(2047, 0, 160))).toEqual([]);
    });

    it('heights spanning more than a byte of steps', () => {
        expect(errors(room(100, -1920, 120))).toEqual([]);    // 2040 down from 120: 255 steps
        expect(errors(room(100, -1928, 120)).join('\n')).toContain('the heights span 256');
    });

    it('more than 256 of anything', () => {
        // a row of rooms sharing walls: 4 sides each, 2 more vertices each
        const lines = ['v 0 0', 'v 0 10'];
        const zones: string[] = [];
        for (let i = 1; i <= 70; i++) {
            lines.push(`v ${i * 10} 0`, `v ${i * 10} 10`);
            const [a, b, c, d] = [2 * i - 2, 2 * i, 2 * i + 1, 2 * i - 1];
            lines.push(`e ${a} ${b} KKKK`, `e ${b} ${c} KKKK`, `e ${c} ${d} KKKK`);
            if (i === 1) {
                lines.push(`e ${d} ${a} KKKK`);
            }
            zones.push(`z 0 160 KRRR KKKB ${a} ${b} ${c} ${d}`);
        }
        const text = mapText(...lines, ...zones);
        expect(errors(text)).toEqual(['280 sides: a byte knows at most 256']);
    });
});

describe('encode', () => {
    it('writes a count of 256 as 0', () => {
        const vertices = Array.from({ length: 256 }, (_, i) => ({ x: i, y: i }));
        const engine = {
            vertices, vertexOf: [], cells: [], edges: [], sides: [],
            start: { x: 0, y: 0, angle: 0, cell: 0 },
        } as unknown as EngineMap;
        expect(encode(engine)[0]).toBe(0);
    });
});
