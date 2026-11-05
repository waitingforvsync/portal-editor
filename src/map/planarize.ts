// planarize.ts - making a draft of a map's edges planar again after an edit: vertices at one
// point merged, edges split where they cross or pass through a vertex, and edges that
// coincide or have no length removed. A crossing point rounds to whole units, which can put a
// small kink in the edges it splits.

import type { Edge, Vertex } from './map';
import { onSegmentInterior, segmentsCross, side } from './geometry';
import { toCoord } from './units';

// An edge in a draft. source is the edge it came from in the map before the edit (-1 for a
// new one); every piece of it keeps that, and runs the same way. rank decides which of two
// coinciding edges survives, the higher. tags are bits carried to every piece, merged when
// edges coincide.
export interface DraftEdge extends Edge {
    source: number;
    rank: number;
    tags: number;
}

export interface Planar {
    vertices: Vertex[];
    edges: DraftEdge[];
    vertexMap: number[];    // draft vertex -> its vertex in the result
}

// Rounding can, rarely, make new crossings; this many passes is far more than that needs.
const MAX_PASSES = 32;

interface WorkEdge extends DraftEdge {
    dirty: boolean;    // new or changed: to be tested against everything
}

// Where segments a-b and c-d cross, to the nearest whole unit. They must cross.
function crossing(a: Vertex, b: Vertex, c: Vertex, d: Vertex): Vertex {
    const sa = side(c, d, a);
    const sb = side(c, d, b);
    const t = sa / (sa - sb);
    return {
        x: toCoord(Math.round(a.x + t * (b.x - a.x))),
        y: toCoord(Math.round(a.y + t * (b.y - a.y))),
    };
}

function boxesOverlap(a: Vertex, b: Vertex, c: Vertex, d: Vertex): boolean {
    return Math.max(a.x, b.x) >= Math.min(c.x, d.x) && Math.max(c.x, d.x) >= Math.min(a.x, b.x)
        && Math.max(a.y, b.y) >= Math.min(c.y, d.y) && Math.max(c.y, d.y) >= Math.min(a.y, b.y);
}

// Make a draft planar. Only the dirty vertices and edges (draft indices) can have broken
// planarity; the rest are taken to be planar among themselves. Leave both out to test all.
export function planarize(
    draftVertices: readonly Vertex[],
    draftEdges: readonly DraftEdge[],
    dirtyVertices?: ReadonlySet<number>,
    dirtyEdges?: ReadonlySet<number>,
): Planar {
    // vertices at one point become one
    const vertices: Vertex[] = [];
    const vertexAt = new Map<number, number>();
    const vertexFor = (p: Vertex): number => {
        const key = p.x * 65536 + p.y;
        let v = vertexAt.get(key);
        if (v === undefined) {
            v = vertices.length;
            vertices.push(p);
            vertexAt.set(key, v);
        }
        return v;
    };
    const vertexMap = draftVertices.map(vertexFor);

    let dirtyV = new Set<number>(dirtyVertices
        ? [...dirtyVertices].map((v) => vertexMap[v]!)
        : vertices.keys());
    let work: WorkEdge[] = [];
    draftEdges.forEach((e, i) => {
        const a = vertexMap[e.a]!;
        const b = vertexMap[e.b]!;
        if (a !== b) {
            work.push({ ...e, a, b, dirty: dirtyEdges ? dirtyEdges.has(i) : true });
        }
    });

    for (let pass = 0; pass < MAX_PASSES; pass++) {
        const splits = new Map<number, Set<number>>();    // edge -> vertices to split it at
        const addSplit = (i: number, v: number) => {
            const e = work[i]!;
            if (v !== e.a && v !== e.b) {
                let at = splits.get(i);
                if (at === undefined) {
                    at = new Set();
                    splits.set(i, at);
                }
                at.add(v);
            }
        };

        // vertices lying on edges: a dirty edge against every vertex, the rest against the
        // dirty vertices
        work.forEach((e, i) => {
            const a = vertices[e.a]!;
            const b = vertices[e.b]!;
            const candidates = e.dirty ? vertices.keys() : dirtyV.values();
            for (const v of candidates) {
                if (v !== e.a && v !== e.b && onSegmentInterior(a, b, vertices[v]!)) {
                    addSplit(i, v);
                }
            }
        });

        // crossings: each dirty edge against every other, each pair once
        const created = new Set<number>();
        work.forEach((e, i) => {
            if (!e.dirty) {
                return;
            }
            const a = vertices[e.a]!;
            const b = vertices[e.b]!;
            work.forEach((f, j) => {
                if (j === i || (f.dirty && j < i)) {
                    return;
                }
                const c = vertices[f.a]!;
                const d = vertices[f.b]!;
                if (boxesOverlap(a, b, c, d) && segmentsCross(a, b, c, d)) {
                    const count = vertices.length;
                    const v = vertexFor(crossing(a, b, c, d));
                    if (v === count) {
                        created.add(v);
                    }
                    addSplit(i, v);
                    addSplit(j, v);
                }
            });
        });

        if (splits.size === 0) {
            break;
        }
        const next: WorkEdge[] = [];
        work.forEach((e, i) => {
            const at = splits.get(i);
            if (at === undefined) {
                next.push({ ...e, dirty: false });
                return;
            }
            const a = vertices[e.a]!;
            const b = vertices[e.b]!;
            const along = (v: number) => {
                const p = vertices[v]!;
                return (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
            };
            let from = e.a;
            for (const v of [...[...at].sort((p, q) => along(p) - along(q)), e.b]) {
                if (v !== from) {
                    next.push({ ...e, a: from, b: v, dirty: true });
                }
                from = v;
            }
        });
        work = next;
        dirtyV = created;
    }

    // edges between the same two vertices become one: the higher rank's, with both's tags
    const edges: DraftEdge[] = [];
    const edgeBetween = new Map<number, number>();
    for (const { dirty: _, ...e } of work) {
        const key = Math.min(e.a, e.b) * 4294967296 + Math.max(e.a, e.b);
        const k = edgeBetween.get(key);
        if (k === undefined) {
            edgeBetween.set(key, edges.length);
            edges.push(e);
        } else {
            const kept = edges[k]!;
            const tags = kept.tags | e.tags;
            edges[k] = e.rank > kept.rank ? { ...e, tags } : { ...kept, tags };
        }
    }
    return { vertices, edges, vertexMap };
}
