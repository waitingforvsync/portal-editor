// export.ts - the map as the engine loads it (docs/export.md): convex cells with clockwise
// rings of sides, each side along an edge, as portalc's map.h has them, packed into bytes.
// Only open zones have cells; cell 0 is the outside. The derived bytes - an edge's angle and
// length, a side's quadrant, a portal's entry - are made as portalc's map builder (map.c's
// end_map) and its mapasm tool make them.

import { zoneCells } from './cells';
import type { Doc } from './edit';
import { side } from './geometry';
import type { Vertex } from './map';
import { HEIGHT_STEP } from './units';

export const MAX_ELEMENTS = 256;      // entries a table: elements are known by a byte
export const EYE_STEPS = 10;          // render.h's PT_CAM_HEIGHT: the eye above its floor, in steps
export const MAX_EDGE_LENGTH = 2047;  // an edge's length in 8-unit steps is a byte
export const MAX_Z = 255;             // z steps are a byte
export const HEADER_SIZE = 10;

export interface EngineCell {
    first: number;      // its ring's first side
    floorZ: number;     // z in 8-unit steps, increasing downwards: floorZ > ceilZ
    ceilZ: number;
    floor: number;      // shades
    ceil: number;
    zone: number;       // the zone it's part of, -1 for the outside
}

export interface EngineEdge {
    angle: number;      // its direction within its quadrant, in 1024ths of a turn
    colour: number;     // its top shade + 1, or 0 for a soft edge between cells of one zone
    len8: number;       // its length in 8-unit steps, rounded down
}

export interface EngineSide {
    v: number;          // its start vertex; it ends at the next side's
    edge: number;
    adj: number;        // the cell across, 0 for a wall
    anghi: number;      // the quadrant of its direction
    entry: number;      // a portal's: the side after its twin, in the cell across; a wall's 0
}

export interface EngineMap {
    vertices: Vertex[];
    vertexOf: number[];    // each one's vertex in the map
    cells: EngineCell[];   // 0 the outside
    edges: EngineEdge[];
    sides: EngineSide[];
    start: { x: number; y: number; angle: number; cell: number };
}

export type ExportResult =
    | { ok: true; engine: EngineMap; bytes: Uint8Array<ArrayBuffer> }
    | { ok: false; errors: string[] };

// The quadrant of a direction, as portalc's pt_quadrant: 0 from +x round to before +y, 1 from
// +y, 2 from -x, 3 from -y.
export function quadrant(dx: number, dy: number): number {
    const nx = dx < 0 || (dx === 0 && dy > 0);
    const ny = dy < 0 || (dy === 0 && dx < 0);
    return (Number(ny) << 1) | Number(nx !== ny);
}

// A direction's angle within its quadrant, in 1024ths of a turn rounded down, as map.c's
// angle_byte: the quadrant's start turned to +x, then the angle from there.
export function angleByte(dx: number, dy: number): number {
    for (let q = quadrant(dx, dy); q > 0; q--) {
        [dx, dy] = [dy, -dx];
    }
    return Math.floor(Math.atan2(dy, dx) * (512 / 3.14159265358979323846)) | 0;    // never -0
}

function sideKey(u: number, v: number): number {
    return u * 4294967296 + v;
}

function pairKey(u: number, v: number): number {
    return sideKey(Math.min(u, v), Math.max(u, v));
}

// The map as the engine holds it, or the reasons it can't be.
export function buildEngineMap(doc: Doc): { engine: EngineMap } | { errors: string[] } {
    const { map } = doc;
    const errors: string[] = [];
    const cellRings = zoneCells(doc);

    // the open zones' cells, zone by zone
    const open = map.zones.filter((z) => !z.solid);
    if (!open.length) {
        return { errors: ['there are no open zones, so no cells'] };
    }
    const rings: { zone: number; ring: number[] }[] = [];
    map.zones.forEach((z, i) => {
        if (!z.solid) {
            rings.push(...cellRings[i]!.map((ring) => ({ zone: i, ring })));
        }
    });

    // z down from the top: the highest ceiling or eye at 0
    const top = Math.max(...open.map((z) =>
        Math.max(z.ceiling, z.floor + EYE_STEPS * HEIGHT_STEP)));
    const zOf = (height: number) => (top - height) / HEIGHT_STEP;
    const lowest = Math.min(...open.map((z) => z.floor));
    if (zOf(lowest) > MAX_Z) {
        errors.push(`the heights span ${zOf(lowest)} steps of ${HEIGHT_STEP}, from the lowest `
            + `floor (${lowest}) to the highest ceiling or eye (${top}): z is a byte, so at `
            + `most ${MAX_Z}`);
    }

    // the vertices the cells use, in the map's order
    const vertexOf = [...new Set(rings.flatMap((r) => r.ring))].sort((a, b) => a - b);
    const engineVertex = new Map(vertexOf.map((v, i) => [v, i]));

    // the cells, and their sides, ring by ring
    const cells: EngineCell[] = [{ first: 0, floorZ: 0, ceilZ: 0, floor: 0, ceil: 0, zone: -1 }];
    const ends: [number, number][] = [];       // each side's map vertices
    const cellOf: number[] = [];               // each side's cell
    const sideAt = new Map<number, number>();
    for (const { zone, ring } of rings) {
        const z = map.zones[zone]!;
        cells.push({
            first: ends.length, floorZ: zOf(z.floor), ceilZ: zOf(z.ceiling),
            floor: z.floorShade, ceil: z.ceilingShade, zone,
        });
        ring.forEach((u, k) => {
            const v = ring[(k + 1) % ring.length]!;
            sideAt.set(sideKey(u, v), ends.length);
            ends.push([u, v]);
            cellOf.push(cells.length - 1);
        });
    }
    const ringEnd = (c: number) => (c + 1 < cells.length ? cells[c + 1]!.first : ends.length);
    const ringNext = (s: number) => (s + 1 === ringEnd(cellOf[s]!) ? cells[cellOf[s]!]!.first
        : s + 1);

    // an edge for each wall, and for each portal the first time a side names it
    const mapEdge = new Map(map.edges.map((e, i) => [pairKey(e.a, e.b), i]));
    const edges: EngineEdge[] = [];
    const sides: EngineSide[] = [];
    ends.forEach(([u, v], s) => {
        const a = map.vertices[u]!;
        const b = map.vertices[v]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const twin = sideAt.get(sideKey(v, u));
        const adj = twin === undefined ? 0 : cellOf[twin]!;
        let edge: number;
        if (twin !== undefined && twin < s) {
            edge = sides[twin]!.edge;
        } else {
            // across a cell of the same zone, a soft edge; else an edge of the map
            const soft = adj !== 0 && cells[adj]!.zone === cells[cellOf[s]!]!.zone;
            const e = mapEdge.get(pairKey(u, v));
            if (!soft && e === undefined) {
                throw new Error(`a cell's side from vertex ${u} to ${v} runs along no edge`);
            }
            const length = Math.hypot(dx, dy);
            if (length > MAX_EDGE_LENGTH) {
                const what = soft ? `the soft edge in zone ${cells[cellOf[s]!]!.zone} from vertex `
                    + `${u} to ${v}` : `edge ${e} (vertex ${u} to ${v})`;
                errors.push(`${what} is ${Math.floor(length)} units long: an edge's length in `
                    + `steps of 8 is a byte, so at most ${MAX_EDGE_LENGTH}`);
            }
            edge = edges.length;
            edges.push({
                angle: angleByte(dx, dy),
                colour: soft ? 0 : map.edges[e!]!.topShade + 1,
                len8: Math.floor(length / 8),
            });
        }
        sides.push({ v: engineVertex.get(u)!, edge, adj, anghi: quadrant(dx, dy), entry: 0 });
    });
    sides.forEach((sd, s) => {
        if (sd.adj !== 0) {
            const [u, v] = ends[s]!;
            sd.entry = ringNext(sideAt.get(sideKey(v, u))!);
        }
    });

    // the cell holding the start: on the inside of every side, as pt_map_find_cell has it
    const { start } = map;
    let startCell = 0;
    for (let c = 1; c < cells.length && !startCell; c++) {
        let inside = true;
        for (let s = cells[c]!.first; s < ringEnd(c); s++) {
            const [u, v] = ends[s]!;
            inside &&= side(map.vertices[u]!, map.vertices[v]!, start) >= 0;
        }
        startCell = inside ? c : 0;
    }
    if (!startCell) {
        errors.push(`the start (${start.x}, ${start.y}) isn't inside an open zone`);
    }

    const counts: [string, number][] = [['vertices', vertexOf.length],
        ['cells (counting the outside)', cells.length], ['edges', edges.length],
        ['sides', sides.length]];
    for (const [what, n] of counts) {
        if (n > MAX_ELEMENTS) {
            errors.push(`${n} ${what}: a byte knows at most ${MAX_ELEMENTS}`);
        }
    }

    if (errors.length) {
        return { errors };
    }
    return {
        engine: {
            vertices: vertexOf.map((v) => map.vertices[v]!), vertexOf, cells, edges, sides,
            start: { x: start.x, y: start.y, angle: start.angle, cell: startCell },
        },
    };
}

// The bytes: a header, then a table a field, end to end (docs/export.md).
export function encode(engine: EngineMap): Uint8Array<ArrayBuffer> {
    const { vertices, cells, edges, sides, start } = engine;
    const out: number[] = [
        vertices.length & 255, cells.length & 255, edges.length & 255, sides.length & 255,
        start.x & 255, start.x >> 8, start.y & 255, start.y >> 8, start.angle, start.cell,
    ];
    const table = (values: readonly number[]) => out.push(...values.map((n) => n & 255));
    table(vertices.map((p) => p.x));
    table(vertices.map((p) => p.x >> 8));
    table(vertices.map((p) => p.y));
    table(vertices.map((p) => p.y >> 8));
    table([...cells.map((c) => c.first), sides.length]);
    table(cells.map((c) => c.floorZ));
    table(cells.map((c) => c.ceilZ));
    table(cells.map((c) => c.floor));
    table(cells.map((c) => c.ceil));
    table(edges.map((e) => e.angle));
    table(edges.map((e) => e.colour));
    table(edges.map((e) => e.len8));
    table(sides.map((s) => s.v));
    table(sides.map((s) => s.edge));
    table(sides.map((s) => s.adj));
    table(sides.map((s) => s.anghi));
    table(sides.map((s) => s.entry));
    return Uint8Array.from(out);
}

export function exportMap(doc: Doc): ExportResult {
    const built = buildEngineMap(doc);
    if ('errors' in built) {
        return { ok: false, errors: built.errors };
    }
    return { ok: true, engine: built.engine, bytes: encode(built.engine) };
}
