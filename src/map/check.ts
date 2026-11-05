// check.ts - what makes a map well formed beyond its syntax and its types: edges joining
// distinct vertices once each and never crossing, and one zone for each region the edges
// enclose.

import type { PortalMap } from './map';
import { onSegmentInterior, segmentsCross } from './geometry';
import { canonicalCycle, findRegions, type Region } from './regions';
import { NUM_SHADES } from './shades';
import { ANGLE_STEPS } from './units';

export type ElementKind = 'start' | 'vertex' | 'edge' | 'zone';

// How a message names an element: the parser adds its line.
export type Label = (kind: ElementKind, index: number) => string;

export const plainLabel: Label = (kind, index) => (kind === 'start' ? 'start' : `${kind} ${index}`);

export interface MapCheck {
    errors: string[];
    warnings: string[];
    zoneRegions: Region[];    // each zone's region, when there are no errors
}

function isShade(n: number): boolean {
    return Number.isInteger(n) && n >= 0 && n < NUM_SHADES;
}

export function checkMap(map: PortalMap, label: Label = plainLabel): MapCheck {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { start, vertices, edges, zones } = map;
    const isVertex = (v: number) => Number.isInteger(v) && v >= 0 && v < vertices.length;

    if (!Number.isInteger(start.angle) || start.angle < 0 || start.angle >= ANGLE_STEPS) {
        errors.push(`${label('start', 0)} angle isn't in 0..${ANGLE_STEPS - 1}`);
    }

    // vertices: no two at one point
    let geometryOk = true;
    const vertexAt = new Map<string, number>();
    vertices.forEach((v, i) => {
        const key = `${v.x},${v.y}`;
        const other = vertexAt.get(key);
        if (other !== undefined) {
            errors.push(`${label('vertex', i)} is at the same point as ${label('vertex', other)}`);
            geometryOk = false;
        } else {
            vertexAt.set(key, i);
        }
    });

    // edges: between two vertices that exist, once each
    const edgeBetween = new Map<string, number>();
    edges.forEach((e, i) => {
        for (const shade of [e.topShade, e.bottomShade]) {
            if (!isShade(shade)) {
                errors.push(`${label('edge', i)} has no shade ${shade}`);
            }
        }
        if (!isVertex(e.a) || !isVertex(e.b)) {
            errors.push(`${label('edge', i)} names a vertex that doesn't exist`);
            geometryOk = false;
            return;
        }
        if (e.a === e.b) {
            errors.push(`${label('edge', i)} joins ${label('vertex', e.a)} to itself`);
            geometryOk = false;
            return;
        }
        const key = e.a < e.b ? `${e.a},${e.b}` : `${e.b},${e.a}`;
        const other = edgeBetween.get(key);
        if (other !== undefined) {
            errors.push(`${label('edge', i)} repeats ${label('edge', other)}`);
            geometryOk = false;
        } else {
            edgeBetween.set(key, i);
        }
    });

    // edges never cross, and no vertex sits on an edge it doesn't end
    if (geometryOk) {
        edges.forEach((e, i) => {
            const a = vertices[e.a]!;
            const b = vertices[e.b]!;
            vertices.forEach((p, v) => {
                if (v !== e.a && v !== e.b && onSegmentInterior(a, b, p)) {
                    errors.push(`${label('vertex', v)} lies on ${label('edge', i)}`);
                }
            });
            for (let j = i + 1; j < edges.length; j++) {
                const f = edges[j]!;
                if (segmentsCross(a, b, vertices[f.a]!, vertices[f.b]!)) {
                    errors.push(`${label('edge', i)} crosses ${label('edge', j)}`);
                }
            }
        });
    }

    // zones: perimeters along edges, heights in steps with the floor below the ceiling
    zones.forEach((z, i) => {
        const n = z.perimeter.length;
        if (n < 3) {
            errors.push(`${label('zone', i)} has fewer than 3 vertices in its perimeter`);
        }
        for (let k = 0; k < n && n >= 3; k++) {
            const a = z.perimeter[k]!;
            const b = z.perimeter[(k + 1) % n]!;
            if (!isVertex(a)) {
                errors.push(`${label('zone', i)} names a vertex that doesn't exist`);
            } else if (isVertex(b) && !edgeBetween.has(a < b ? `${a},${b}` : `${b},${a}`)) {
                errors.push(`${label('zone', i)} has no edge from vertex ${a} to ${b}`);
            }
        }
        if (z.floor >= z.ceiling) {
            const heights = `floor ${z.floor} isn't below its ceiling ${z.ceiling}`;
            errors.push(`${label('zone', i)} ${heights}`);
        }
        if (!isShade(z.floorShade) || !isShade(z.ceilingShade)) {
            errors.push(`${label('zone', i)} names a shade that doesn't exist`);
        }
    });

    if (errors.length) {
        return { errors, warnings, zoneRegions: [] };
    }

    // zones against the regions the edges enclose, one each
    const found = findRegions(vertices, edges);
    for (const e of found.construction) {
        warnings.push(`${label('edge', e)} has the same region on both sides`);
    }
    const regionOf = new Map(found.regions.map((r, i) => [r.perimeter.join(' '), i]));
    const zoneOf = new Map<number, number>();
    const zoneRegions: Region[] = [];
    zones.forEach((z, i) => {
        const r = regionOf.get(canonicalCycle(z.perimeter).join(' '));
        if (r === undefined) {
            const reversed = regionOf.get(canonicalCycle([...z.perimeter].reverse()).join(' '));
            if (reversed === undefined) {
                errors.push(`${label('zone', i)} has a perimeter no region has`);
            } else {
                errors.push(`${label('zone', i)} lists its perimeter anticlockwise`);
                zoneOf.set(reversed, i);    // it means that region: don't report it zoneless too
            }
            return;
        }
        const other = zoneOf.get(r);
        if (other !== undefined) {
            errors.push(`${label('zone', i)} has the same perimeter as ${label('zone', other)}`);
            return;
        }
        zoneOf.set(r, i);
        zoneRegions[i] = found.regions[r]!;
    });
    found.regions.forEach((r, i) => {
        if (!zoneOf.has(i)) {
            errors.push(`no zone for the region with perimeter ${r.perimeter.join(' ')}`);
        }
    });

    return { errors, warnings, zoneRegions: errors.length ? [] : zoneRegions };
}
