// edit.ts - the editing operations on a map. Each geometry edit makes a draft of the map's
// vertices and edges, makes it planar (planarize.ts) and rebuilds the zones from it
// (zones.ts); a change of properties leaves the geometry as it is. None changes the document
// it's given.

import type { Edge, PortalMap, Vertex } from './map';
import { planarize, type DraftEdge } from './planarize';
import { findRegions, type Region } from './regions';
import { ANGLE_STEPS, COORD_MAX, isCoord, toCoord } from './units';
import { rebuildZones, zoneStyle, type ZoneStyle } from './zones';

// A map with what's worked out from it: each zone's region, and the construction lines.
export interface Doc {
    map: PortalMap;
    regions: Region[];
    construction: number[];
}

export function docFromMap(map: PortalMap, zoneRegions: Region[]): Doc {
    const { construction } = findRegions(map.vertices, map.edges);
    return { map, regions: zoneRegions, construction };
}

// An edge's properties: all but where it runs.
export type EdgeStyle = Omit<Edge, 'a' | 'b'>;

export interface EditDefaults {
    zone: ZoneStyle;    // for a region with no zone to come from
    edge: EdgeStyle;    // for a new edge
}

export interface EditResult {
    doc: Doc;
    vertexMap: number[];    // each vertex before -> its vertex after, -1 if gone
    added: number[];        // the vertices an operation added, after
    drawn: number[];        // the vertices along a drawn edge, after
}

// Where a drawn edge starts or ends: a vertex, or a new one, perhaps on an edge.
export type Endpoint = { vertex: number } | { at: Vertex; edge?: number };

const TAG_DRAWN = 1;

interface Draft {
    vertices: Vertex[];
    edges: DraftEdge[];
}

function draftOf(map: PortalMap): Draft {
    return {
        vertices: [...map.vertices],
        edges: map.edges.map((e, i) => ({ ...e, source: i, rank: 1, tags: 0 })),
    };
}

// Split draft edges at vertices; returns the pieces, which take the edge's place.
function splitEdges(draft: Draft, at: ReadonlyMap<number, readonly number[]>): number[] {
    const pieces: number[] = [];
    for (const [i, splitAt] of at) {
        const e = draft.edges[i]!;
        const a = draft.vertices[e.a]!;
        const b = draft.vertices[e.b]!;
        const along = (v: number) => {
            const p = draft.vertices[v]!;
            return (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
        };
        const chain = [...splitAt].sort((p, q) => along(p) - along(q));
        let from = e.a;
        const ends = [...chain, e.b];
        ends.forEach((v, k) => {
            const piece = { ...e, a: from, b: v };
            if (k === 0) {
                draft.edges[i] = piece;
                pieces.push(i);
            } else {
                pieces.push(draft.edges.length);
                draft.edges.push(piece);
            }
            from = v;
        });
    }
    return pieces;
}

// Make the draft planar, rebuild the zones, and say where everything went.
function finish(
    doc: Doc,
    draft: Draft,
    defaults: EditDefaults,
    dirty: { vertices: Iterable<number>; edges: Iterable<number> } | undefined,
    moved?: { zones: ReadonlySet<number>; edges: ReadonlySet<number> },
): { doc: Doc; vertexMap: number[]; drawn: number[] } {
    const planar = planarize(draft.vertices, draft.edges,
        dirty && new Set(dirty.vertices), dirty && new Set(dirty.edges));
    const edges = planar.edges.map(({ a, b, topShade, bottomShade }) =>
        ({ a, b, topShade, bottomShade }));
    const rebuilt = rebuildZones(planar.vertices, edges, {
        before: doc.map,
        beforeRegions: doc.regions,
        edgeSource: planar.edges.map((e) => e.source),
        movedZones: moved?.zones,
        movedEdges: moved?.edges,
    }, defaults.zone);
    const drawn = new Set<number>();
    for (const e of planar.edges) {
        if (e.tags & TAG_DRAWN) {
            drawn.add(e.a);
            drawn.add(e.b);
        }
    }
    return {
        doc: {
            map: { start: doc.map.start, vertices: planar.vertices, edges, zones: rebuilt.zones },
            regions: rebuilt.zoneRegions,
            construction: rebuilt.construction,
        },
        vertexMap: planar.vertexMap,
        drawn: [...drawn].sort((p, q) => p - q),
    };
}

// The draft vertex for an endpoint, adding it (and splitting its edge) if it's new.
function endpointVertex(draft: Draft, end: Endpoint, splits: Map<number, number[]>): number {
    if ('vertex' in end) {
        return end.vertex;
    }
    const v = draft.vertices.length;
    draft.vertices.push(end.at);
    if (end.edge !== undefined) {
        const list = splits.get(end.edge) ?? [];
        list.push(v);
        splits.set(end.edge, list);
    }
    return v;
}

// Add a vertex, on an edge if one is given (splitting it there), else wherever it falls: on
// an existing vertex it is that vertex, on an edge it splits it.
export function addVertex(
    doc: Doc, at: Vertex, edge: number | undefined, defaults: EditDefaults,
): EditResult {
    const draft = draftOf(doc.map);
    const splits = new Map<number, number[]>();
    const v = endpointVertex(draft, edge === undefined ? { at } : { at, edge }, splits);
    const pieces = splitEdges(draft, splits);
    const done = finish(doc, draft, defaults, { vertices: [v], edges: pieces });
    return {
        ...done,
        vertexMap: done.vertexMap.slice(0, doc.map.vertices.length),
        added: [done.vertexMap[v]!],
    };
}

// Draw an edge between two endpoints, splitting it and whatever it crosses where they cross.
// Where it runs along an existing edge, the existing edge stays.
export function addEdge(
    doc: Doc, from: Endpoint, to: Endpoint, defaults: EditDefaults,
): EditResult {
    const draft = draftOf(doc.map);
    const splits = new Map<number, number[]>();
    const a = endpointVertex(draft, from, splits);
    const b = endpointVertex(draft, to, splits);
    const pieces = splitEdges(draft, splits);
    const edge = draft.edges.length;
    draft.edges.push({ a, b, ...defaults.edge, source: -1, rank: 0, tags: TAG_DRAWN });
    const newVertices = [a, b].filter((v) => v >= doc.map.vertices.length);
    const done = finish(doc, draft, defaults, { vertices: newVertices, edges: [...pieces, edge] });
    return {
        ...done,
        vertexMap: done.vertexMap.slice(0, doc.map.vertices.length),
        added: newVertices.map((v) => done.vertexMap[v]!),
    };
}

// Move vertices by (dx, dy), which must keep them in range. Where they land on vertices they
// merge, where edges cross they split; a moved edge wins over one it comes to lie along.
export function moveVertices(
    doc: Doc, which: ReadonlySet<number>, dx: number, dy: number, defaults: EditDefaults,
): EditResult {
    const { map } = doc;
    const draft = draftOf(map);
    for (const v of which) {
        const p = map.vertices[v]!;
        draft.vertices[v] = { x: toCoord(p.x + dx), y: toCoord(p.y + dy) };
    }
    const dirtyEdges: number[] = [];
    const movedEdges = new Set<number>();
    draft.edges.forEach((e, i) => {
        const ends = Number(which.has(e.a)) + Number(which.has(e.b));
        if (ends > 0) {
            dirtyEdges.push(i);
        }
        if (ends === 2) {
            movedEdges.add(i);
            e.rank = 2;
        }
    });
    const movedZones = new Set<number>();
    map.zones.forEach((z, i) => {
        if (z.perimeter.every((v) => which.has(v))) {
            movedZones.add(i);
        }
    });
    const done = finish(doc, draft, defaults, { vertices: which, edges: dirtyEdges },
        { zones: movedZones, edges: movedEdges });
    return { ...done, added: [] };
}

// Delete edges; their vertices stay.
export function deleteEdges(
    doc: Doc, which: ReadonlySet<number>, defaults: EditDefaults,
): EditResult {
    const draft = draftOf(doc.map);
    draft.edges = draft.edges.filter((e) => !which.has(e.source));
    const done = finish(doc, draft, defaults, { vertices: [], edges: [] });
    return { ...done, added: [] };
}

// Delete vertices, and the edges that end at them.
export function deleteVertices(
    doc: Doc, which: ReadonlySet<number>, defaults: EditDefaults,
): EditResult {
    const { map } = doc;
    const keep: number[] = [];
    const renumber = map.vertices.map((_, v) => (which.has(v) ? -1 : keep.push(v) - 1));
    const draft: Draft = {
        vertices: keep.map((v) => map.vertices[v]!),
        edges: draftOf(map).edges
            .filter((e) => !which.has(e.a) && !which.has(e.b))
            .map((e) => ({ ...e, a: renumber[e.a]!, b: renumber[e.b]! })),
    };
    const done = finish(doc, draft, defaults, { vertices: [], edges: [] });
    return {
        ...done,
        vertexMap: renumber.map((v) => (v < 0 ? -1 : done.vertexMap[v]!)),
        added: [],
    };
}

// Change zones' properties; the geometry stays. Throws if an open zone's floor would end up
// at or above its ceiling.
export function restyleZones(
    doc: Doc, which: Iterable<number>, change: (style: ZoneStyle) => ZoneStyle,
): Doc {
    const zones = [...doc.map.zones];
    for (const z of which) {
        const zone = zones[z]!;
        const style = change(zoneStyle(zone));
        if (style.floor >= style.ceiling) {
            throw new RangeError(
                `zone ${z}'s floor ${style.floor} wouldn't be below its ceiling ${style.ceiling}`);
        }
        zones[z] = { ...style, perimeter: zone.perimeter };
    }
    return { ...doc, map: { ...doc.map, zones } };
}

// Put the start at a point, facing an angle (which wraps round); the geometry stays. Throws if
// the point is off the map.
export function setStart(doc: Doc, x: number, y: number, angle: number): Doc {
    if (!isCoord(x) || !isCoord(y)) {
        throw new RangeError(`the start (${x}, ${y}) would be off the map: coordinates are `
            + `whole numbers in 0..${COORD_MAX}`);
    }
    if (!Number.isInteger(angle)) {
        throw new RangeError(`the start's angle ${angle} isn't a whole number`);
    }
    const turned = ((angle % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS;
    return { ...doc, map: { ...doc.map, start: { x, y, angle: turned } } };
}

// Change edges' properties; the geometry stays.
export function restyleEdges(
    doc: Doc, which: Iterable<number>, change: (style: EdgeStyle) => EdgeStyle,
): Doc {
    const edges = [...doc.map.edges];
    for (const e of which) {
        const { a, b, ...style } = edges[e]!;
        edges[e] = { a, b, ...change(style) };
    }
    return { ...doc, map: { ...doc.map, edges } };
}
