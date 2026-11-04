// selection.ts - the selection is a set of vertices; edges and zones are selected through
// them. An edge is selected when both its ends are, a zone when every vertex of its
// perimeter is (its holes' vertices don't count).

import type { Doc } from '../map/edit';
import type { Hit } from './hit';

export type Selection = ReadonlySet<number>;

export function selectedEdges(doc: Doc, selection: Selection): number[] {
    const out: number[] = [];
    doc.map.edges.forEach((e, i) => {
        if (selection.has(e.a) && selection.has(e.b)) {
            out.push(i);
        }
    });
    return out;
}

export function selectedZones(doc: Doc, selection: Selection): number[] {
    const out: number[] = [];
    doc.map.zones.forEach((z, i) => {
        if (z.perimeter.every((v) => selection.has(v))) {
            out.push(i);
        }
    });
    return out;
}

// The vertices that selecting what was hit selects.
export function verticesOf(doc: Doc, hit: Hit): number[] {
    switch (hit.kind) {
        case 'vertex':
            return [hit.index];
        case 'edge': {
            const e = doc.map.edges[hit.index]!;
            return [e.a, e.b];
        }
        case 'zone':
            return [...doc.map.zones[hit.index]!.perimeter];
        case 'none':
            return [];
    }
}

export function isSelected(doc: Doc, selection: Selection, hit: Hit): boolean {
    return hit.kind !== 'none' && verticesOf(doc, hit).every((v) => selection.has(v));
}

// A selection carried through an edit's renumbering of the vertices.
export function mapSelection(selection: Selection, vertexMap: readonly number[]): Set<number> {
    const out = new Set<number>();
    for (const v of selection) {
        const to = vertexMap[v];
        if (to !== undefined && to >= 0) {
            out.add(to);
        }
    }
    return out;
}
