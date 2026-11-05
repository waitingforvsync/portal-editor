// format.ts - the map's text format (docs/format.md): reading, with every problem reported
// by line rather than thrown, and writing in the one form the editor saves.

import { checkMap, type ElementKind } from './check';
import type { Edge, PortalMap, Start, Vertex, Zone } from './map';
import { canonicalCycle, type Region } from './regions';
import { shadeFromName, shadeName } from './shades';
import { COORD_MAX, HEIGHT_STEP, isCoord, isHeight } from './units';

export const FORMAT_VERSION = 1;

export type ParseResult =
    | { ok: true; map: PortalMap; warnings: string[]; zoneRegions: Region[] }
    | { ok: false; errors: string[] };

// A whole number written in decimal, or undefined.
function wholeNumber(token: string): number | undefined {
    if (!/^-?[0-9]+$/.test(token)) {
        return undefined;
    }
    const n = Number(token);
    return Number.isSafeInteger(n) ? n : undefined;
}

// An index (a vertex's), or undefined.
function index(token: string): number | undefined {
    const n = wholeNumber(token);
    return n !== undefined && n >= 0 ? n : undefined;
}

// Indices, or undefined if any isn't one.
function indices(tokens: readonly string[]): number[] | undefined {
    const out: number[] = [];
    for (const t of tokens) {
        const n = index(t);
        if (n === undefined) {
            return undefined;
        }
        out.push(n);
    }
    return out;
}

export function parseMap(text: string): ParseResult {
    const errors: string[] = [];
    const lineOf: Record<ElementKind, number[]> = { start: [], vertex: [], edge: [], zone: [] };
    let start: Start | undefined;
    const vertices: Vertex[] = [];
    const edges: Edge[] = [];
    const zones: Zone[] = [];
    let versioned = false;
    let sawStart = false;

    const rows = text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) {
        const line = i + 1;
        const tokens = rows[i]!.replace(/#.*/, '').trim().split(/\s+/).filter((t) => t !== '');
        const [keyword, ...args] = tokens;
        if (keyword === undefined) {
            continue;
        }
        const fail = (message: string) => errors.push(`line ${line}: ${message}`);

        if (!versioned) {
            if (keyword !== 'portalmap' || args.length !== 1) {
                fail(`expected 'portalmap ${FORMAT_VERSION}' first`);
                return { ok: false, errors };
            }
            if (args[0] !== String(FORMAT_VERSION)) {
                fail(`version ${args[0]} isn't supported`);
                return { ok: false, errors };
            }
            versioned = true;
            continue;
        }

        switch (keyword) {
            case 'start': {
                sawStart = true;
                const [x, y, angle] = args.map(wholeNumber);
                if (args.length !== 3) {
                    fail(`'start' takes x y angle`);
                } else if (start !== undefined) {
                    fail(`a second 'start'`);
                } else if (x === undefined || !isCoord(x) || y === undefined || !isCoord(y)) {
                    fail(`start position isn't whole numbers in 0..${COORD_MAX}`);
                } else if (angle === undefined) {
                    fail(`start angle isn't a whole number`);
                } else {
                    start = { x, y, angle };
                    lineOf.start.push(line);
                }
                break;
            }
            case 'v': {
                const [x, y] = args.map(wholeNumber);
                if (args.length !== 2) {
                    fail(`'v' takes x y`);
                } else if (x === undefined || !isCoord(x) || y === undefined || !isCoord(y)) {
                    fail(`vertex isn't whole numbers in 0..${COORD_MAX}`);
                } else {
                    vertices.push({ x, y });
                    lineOf.vertex.push(line);
                }
                break;
            }
            case 'e': {
                const [a, b] = args.slice(0, 2).map(index);
                const topShade = shadeFromName(args[2] ?? '');
                const bottomShade = args.length === 4 ? shadeFromName(args[3]!) : topShade;
                if (args.length !== 3 && args.length !== 4) {
                    fail(`'e' takes v0 v1 top-shade [bottom-shade]`);
                } else if (a === undefined || b === undefined) {
                    fail(`edge ends aren't vertex numbers`);
                } else if (topShade === undefined) {
                    fail(`no shade '${args[2]}'`);
                } else if (bottomShade === undefined) {
                    fail(`no shade '${args[3]}'`);
                } else {
                    edges.push({ a, b, topShade, bottomShade });
                    lineOf.edge.push(line);
                }
                break;
            }
            case 'z': {
                const solid = args[0] === 'solid';
                const fields = solid ? args.slice(1) : args;
                const [floor, ceiling] = fields.slice(0, 2).map(wholeNumber);
                const floorShade = shadeFromName(fields[2] ?? '');
                const ceilingShade = shadeFromName(fields[3] ?? '');
                const perimeter = indices(fields.slice(4));
                if (fields.length < 4) {
                    fail(`'z' takes [solid] floor ceiling floor-shade ceiling-shade perimeter`);
                } else if (floor === undefined || !isHeight(floor)
                    || ceiling === undefined || !isHeight(ceiling)) {
                    fail(`heights aren't whole multiples of ${HEIGHT_STEP}`);
                } else if (floorShade === undefined) {
                    fail(`no shade '${fields[2]}'`);
                } else if (ceilingShade === undefined) {
                    fail(`no shade '${fields[3]}'`);
                } else if (perimeter === undefined) {
                    fail(`perimeter isn't vertex numbers`);
                } else {
                    zones.push({ solid, floor, ceiling, floorShade, ceilingShade, perimeter });
                    lineOf.zone.push(line);
                }
                break;
            }
            default:
                fail(`no record '${keyword}'`);
        }
    }

    if (!versioned) {
        errors.push(`no 'portalmap ${FORMAT_VERSION}' line`);
    } else if (!sawStart) {
        errors.push(`no 'start' line`);
    }
    if (errors.length || start === undefined) {
        return { ok: false, errors };
    }

    const map: PortalMap = { start, vertices, edges, zones };
    const label = (kind: ElementKind, i: number) => (kind === 'start'
        ? `start (line ${lineOf.start[0]})`
        : `${kind} ${i} (line ${lineOf[kind][i]})`);
    const check = checkMap(map, label);
    if (check.errors.length) {
        return { ok: false, errors: check.errors };
    }
    return { ok: true, map, warnings: check.warnings, zoneRegions: check.zoneRegions };
}

export function writeMap(map: PortalMap): string {
    const { start } = map;
    const out = [`portalmap ${FORMAT_VERSION}`, '', `start ${start.x} ${start.y} ${start.angle}`];
    out.push('', '# v x y');
    for (const v of map.vertices) {
        out.push(`v ${v.x} ${v.y}`);
    }
    out.push('', '# e v0 v1 top-shade [bottom-shade]');
    for (const e of map.edges) {
        const bottom = e.bottomShade === e.topShade ? '' : ` ${shadeName(e.bottomShade)}`;
        out.push(`e ${e.a} ${e.b} ${shadeName(e.topShade)}${bottom}`);
    }
    out.push('', '# z [solid] floor ceiling floor-shade ceiling-shade perimeter');
    for (const z of map.zones) {
        const solid = z.solid ? 'solid ' : '';
        const shades = `${shadeName(z.floorShade)} ${shadeName(z.ceilingShade)}`;
        const perimeter = canonicalCycle(z.perimeter).join(' ');
        out.push(`z ${solid}${z.floor} ${z.ceiling} ${shades} ${perimeter}`);
    }
    return out.join('\n') + '\n';
}
