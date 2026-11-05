// straighten.ts - a planar map's edges without the vertices that add nothing to its shape:
// those joining just two edges that run straight on through them. Each run of such edges
// becomes one edge, from the run's first vertex to its last.

import { onSegmentInterior } from './geometry';
import type { Vertex } from './map';

export interface Straightened<E> {
    vertices: Vertex[];
    edges: E[];
}

// The vertices and edges with each run made one edge. That edge keeps the fields of the run's
// longest piece and runs that piece's way; it takes the place of the run's lowest-numbered
// edge, so the edges keep their order.
export function straighten<E extends { a: number; b: number }>(
    vertices: readonly Vertex[], edges: readonly E[],
): Straightened<E> {
    const at = vertices.map((): number[] => []);
    edges.forEach((e, i) => {
        at[e.a]!.push(i);
        at[e.b]!.push(i);
    });
    const other = (i: number, v: number) => (edges[i]!.a === v ? edges[i]!.b : edges[i]!.a);
    const kept = vertices.map((p, v) => {
        const [e, f] = at[v]!;
        return at[v]!.length !== 2
            || !onSegmentInterior(vertices[other(e!, v)]!, vertices[other(f!, v)]!, p);
    });
    const index: number[] = [];
    const result: Vertex[] = [];
    vertices.forEach((p, v) => {
        index[v] = kept[v] ? result.push(p) - 1 : -1;
    });
    const lengthSquared = (i: number) => {
        const p = vertices[edges[i]!.a]!;
        const q = vertices[edges[i]!.b]!;
        return (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    };

    // walk each run from a kept vertex to the next; a run can't close on itself, being straight
    const made: (E | undefined)[] = edges.map(() => undefined);
    const done = edges.map(() => false);
    vertices.forEach((_, start) => {
        if (!kept[start]) {
            return;
        }
        for (const first of at[start]!) {
            if (done[first]) {
                continue;
            }
            let edge = first;
            let from = start;
            let longest = first;
            let forward = edges[first]!.a === start;
            let earliest = first;
            for (;;) {
                done[edge] = true;
                earliest = Math.min(earliest, edge);
                if (lengthSquared(edge) > lengthSquared(longest)) {
                    longest = edge;
                    forward = edges[edge]!.a === from;
                }
                from = other(edge, from);
                if (kept[from]) {
                    break;
                }
                edge = at[from]![0] === edge ? at[from]![1]! : at[from]![0]!;
            }
            const [a, b] = forward ? [start, from] : [from, start];
            made[earliest] = { ...edges[longest]!, a: index[a]!, b: index[b]! };
        }
    });
    return { vertices: result, edges: made.filter((e): e is E => e !== undefined) };
}
