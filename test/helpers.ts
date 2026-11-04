// helpers.ts - small builders for the tests.

import type { Point } from '../src/map/geometry';
import type { Edge, Vertex } from '../src/map/map';
import { toCoord } from '../src/map/units';

export function pt(x: number, y: number): Point & Vertex {
    return { x: toCoord(x), y: toCoord(y) };
}

export function pts(...xy: [number, number][]): (Point & Vertex)[] {
    return xy.map(([x, y]) => pt(x, y));
}

// Edges joining the given vertex pairs, all in shade 0.
export function joins(...pairs: [number, number][]): Edge[] {
    return pairs.map(([a, b]) => ({ a, b, shade: 0 }));
}

// A map's text: the header and a start, then the given lines.
export function mapText(...lines: string[]): string {
    return ['portalmap 1', 'start 5 5 0', ...lines].join('\n') + '\n';
}

// A 10-unit square, clockwise in plan from the origin (x up, y right), as a zone.
export const SQUARE = [
    'v 0 0',
    'v 10 0',
    'v 10 10',
    'v 0 10',
    'e 0 1 KKKK',
    'e 1 2 KKKK',
    'e 2 3 KKKK',
    'e 3 0 KKKK',
];
export const SQUARE_ZONE = 'z 0 64 KRRR KKKB 0 1 2 3';
