// zones.ts - the zones after an edit: the regions the edited edges enclose, each taking its
// properties from a zone before the edit. A region looks along its boundary: each piece of an
// edge that was there before names the zone that lay on that side of it. A zone that moved
// with the edit wins over one that didn't, and among several the largest wins. A region with
// no such edge takes the zone it was drawn inside, or failing that the defaults.

import type { Edge, PortalMap, Vertex, Zone } from './map';
import { pointInRing, ringArea2 } from './geometry';
import { findRegions, type Region } from './regions';

// A zone's properties, without its perimeter.
export type ZoneStyle = Omit<Zone, 'perimeter'>;

export function zoneStyle(zone: Zone): ZoneStyle {
    const { solid, floor, ceiling, floorShade, ceilingShade } = zone;
    return { solid, floor, ceiling, floorShade, ceilingShade };
}

// What a map looked like before an edit, and where the edited map's edges came from.
export interface Lineage {
    before: PortalMap;
    beforeRegions: readonly Region[];   // each zone's region, before
    edgeSource: readonly number[];      // each edge's edge before, or -1 if it's new
    movedZones?: ReadonlySet<number>;   // zones before that the edit moved whole
    movedEdges?: ReadonlySet<number>;   // edges before that the edit moved, both ends
}

export interface Rebuilt {
    zones: Zone[];
    zoneRegions: Region[];
    construction: number[];
}

function pairKey(a: number, b: number): number {
    return Math.min(a, b) * 4294967296 + Math.max(a, b);
}

function edgeIndex(edges: readonly Edge[]): Map<number, number> {
    return new Map(edges.map((e, i) => [pairKey(e.a, e.b), i]));
}

// Each boundary step of a region, u to v, with the region on its right.
function* steps(region: Region): Generator<[number, number]> {
    for (const cycle of [region.perimeter, ...region.holes]) {
        for (let k = 0; k < cycle.length; k++) {
            yield [cycle[k]!, cycle[(k + 1) % cycle.length]!];
        }
    }
}

// A region's area: its perimeter's, less its holes'.
function regionArea(vertices: readonly Vertex[], region: Region): number {
    const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
    const outer = ringArea2(ring(region.perimeter));
    return region.holes.reduce((sum, hole) => sum + ringArea2(ring(hole)), outer);
}

// True when p lies inside a region, off its boundary.
function insideRegion(vertices: readonly Vertex[], region: Region, p: Vertex): boolean {
    const ring = (cycle: readonly number[]) => cycle.map((v) => vertices[v]!);
    return pointInRing(p, ring(region.perimeter)) === 'inside'
        && region.holes.every((hole) => pointInRing(p, ring(hole)) === 'outside');
}

export function rebuildZones(
    vertices: readonly Vertex[],
    edges: readonly Edge[],
    lineage: Lineage,
    defaults: ZoneStyle,
): Rebuilt {
    const { before, beforeRegions, edgeSource, movedZones, movedEdges } = lineage;

    // the zone on each side of each edge before: forward has it on the right going a to b
    const beforeEdge = edgeIndex(before.edges);
    const forward = new Map<number, number>();
    const backward = new Map<number, number>();
    beforeRegions.forEach((region, z) => {
        for (const [u, v] of steps(region)) {
            const e = beforeEdge.get(pairKey(u, v))!;
            (before.edges[e]!.a === u ? forward : backward).set(e, z);
        }
    });
    const area = beforeRegions.map((region) => regionArea(before.vertices, region));
    const largest = (zones: readonly number[]) => zones.reduce<number | undefined>(
        (best, z) => (best === undefined || area[z]! > area[best]! ? z : best), undefined);

    const found = findRegions(vertices, edges);
    const edgeOf = edgeIndex(edges);
    const chosen = found.regions.map((region) => {
        const candidates = new Set<number>();
        for (const [u, v] of steps(region)) {
            const e = edgeOf.get(pairKey(u, v))!;
            const source = edgeSource[e]!;
            if (source < 0) {
                continue;
            }
            const z = (edges[e]!.a === u ? forward : backward).get(source);
            // a moved edge's old neighbours stayed behind, unless they moved too
            if (z !== undefined && (!movedEdges?.has(source) || movedZones?.has(z))) {
                candidates.add(z);
            }
        }
        const all = [...candidates];
        const pick = largest(all.filter((z) => movedZones?.has(z))) ?? largest(all);
        if (pick !== undefined) {
            return pick;
        }
        // drawn inside a zone: the smallest one round one of its vertices
        for (const v of region.perimeter) {
            const around = beforeRegions
                .map((r, z) => z)
                .filter((z) => insideRegion(before.vertices, beforeRegions[z]!, vertices[v]!));
            if (around.length) {
                return around.reduce((best, z) => (area[z]! < area[best]! ? z : best));
            }
        }
        return undefined;
    });

    // in the order of the zones they came from, new ones last
    const order = found.regions.map((_, i) => i);
    const rank = (i: number) => chosen[i] ?? before.zones.length;
    order.sort((i, j) => rank(i) - rank(j));
    const zones: Zone[] = [];
    const zoneRegions: Region[] = [];
    for (const i of order) {
        const region = found.regions[i]!;
        const from = chosen[i];
        const style = from === undefined ? defaults : zoneStyle(before.zones[from]!);
        zones.push({ ...style, perimeter: region.perimeter });
        zoneRegions.push(region);
    }
    return { zones, zoneRegions, construction: found.construction };
}
