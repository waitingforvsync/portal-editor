// level.ts - a Doom level as a map. Its linedefs become edges, between only the vertices they
// use (not those the node builder added for its splits), and each region they enclose becomes
// a zone with its sector's heights. A sector in several pieces gives a zone each; a region
// with no sector, such as the inside of a pillar, is solid. Each surface's flat or texture
// sets the colour it wants (colour.ts), and it takes the shade most like that which none of
// its neighbours has (distinct.ts). Doom's map is scaled up by SCALE, bringing its eye height
// (41) near the engine's (80), and laid out as Doom's automap shows it, north up the page and
// east to the right.

import type { Doc } from '../map/edit';
import { distinctShades, type Want } from '../map/distinct';
import { docFromMap } from '../map/edit';
import { checkMap } from '../map/check';
import type { Edge, PortalMap, Zone } from '../map/map';
import { planarize, type DraftEdge } from '../map/planarize';
import { findRegions } from '../map/regions';
import { ANGLE_STEPS, COORD_MAX, HEIGHT_STEP, toCoord, toHeight } from '../map/units';
import type { ZoneStyle } from '../map/zones';
import { surfaceWants, type Direction, type Surface } from './colour';
import {
    flatColour, NO_TEXTURE, readLevel, readPalette, SKY_FLAT, textureColours,
    type DoomVertex, type Linedef, type Linear, type Sidedef, type Wad,
} from './wad';

export const SCALE = 2;
const MARGIN = 256;      // units left round the map, inside the coordinate range
const DOOR_LIP = 4;      // an open door stops this far below its lowest neighbouring ceiling
const PLAYER_START = 1;  // the thing type of player 1's start
const FALLBACK: Linear = [0.05, 0.05, 0.05];    // for a texture or flat the WAD doesn't have
const UP: Direction = [0, 0, 1];
const DOWN: Direction = [0, 0, -1];

export interface Imported {
    doc: Doc;
    notes: string[];     // what was changed or left out, and why
}

// The sky texture Doom draws for a level.
function skyTexture(level: string): string {
    const episode = /^E(\d)M/.exec(level);
    if (episode) {
        return `SKY${episode[1]}`;
    }
    const map = Number(level.slice(3));
    return map <= 11 ? 'SKY1' : map <= 20 ? 'SKY2' : 'SKY3';
}

function pairKey(a: number, b: number): number {
    return Math.min(a, b) * 4294967296 + Math.max(a, b);
}

function roundHeight(h: number): number {
    return Math.round(h / HEIGHT_STEP) * HEIGHT_STEP;
}

export function importLevel(wad: Wad, name: string): Imported {
    const level = readLevel(wad, name);
    const { linedefs, sidedefs, sectors } = level;
    const notes: string[] = [];
    const sectorOf = (side: number) => (side < 0 ? -1 : sidedefs[side]?.sector ?? -1);

    // ---- colours: each flat's and texture's average ----

    const palette = readPalette(wad);
    const textures = textureColours(wad, palette);
    const missing = new Set<string>();
    const known = (colour: Linear | undefined, what: string): Linear => {
        if (!colour) {
            missing.add(what);
        }
        return colour ?? FALLBACK;
    };
    const sky = known(textures.get(skyTexture(name)), skyTexture(name));
    const flatColours = new Map<string, Linear>();
    const flat = (name: string): Linear => {
        let colour = flatColours.get(name);
        if (!colour) {
            colour = name === SKY_FLAT ? sky : known(flatColour(wad, palette, name), name);
            flatColours.set(name, colour);
        }
        return colour;
    };
    const texture = (name: string): Linear | undefined =>
        (name === NO_TEXTURE || name === '' ? undefined : known(textures.get(name), name));

    // ---- sectors: heights scaled, closed doors opened ----

    const neighbours = sectors.map(() => new Set<number>());
    for (const l of linedefs) {
        const f = sectorOf(l.front);
        const b = sectorOf(l.back);
        if (f >= 0 && b >= 0 && f !== b) {
            neighbours[f]!.add(b);
            neighbours[b]!.add(f);
        }
    }
    const opened: number[] = [];
    const shut: number[] = [];
    const styles: ZoneStyle[] = sectors.map((s, i) => {
        let { ceiling } = s;
        if (ceiling <= s.floor) {
            // a closed door: open, as far as Doom opens one
            const around = [...neighbours[i]!].map((n) => sectors[n]!.ceiling);
            const open = Math.min(...around) - DOOR_LIP;
            if (around.length && open > s.floor) {
                opened.push(i);
                ceiling = open;
            }
        }
        const floor = roundHeight(s.floor * SCALE);
        const top = roundHeight(ceiling * SCALE);
        const solid = top <= floor;
        if (solid) {
            shut.push(i);
        }
        return {
            solid, floor: toHeight(floor), ceiling: toHeight(solid ? floor + HEIGHT_STEP : top),
            floorShade: 0, ceilingShade: 0,    // shaded below
        };
    });

    if (opened.length) {
        notes.push(`${opened.length} closed sectors (doors) opened to ${DOOR_LIP} below their `
            + `neighbours' lowest ceiling, as a door opens: sectors ${opened.join(', ')}`);
    }
    if (shut.length) {
        notes.push(`${shut.length} sectors closed, with no room to open: solid zones: sectors `
            + `${shut.join(', ')}`);
    }

    // ---- edges: the linedefs between sectors, shaded by what shows of them ----

    const lines = linedefs.map((l, i) => ({ l, i })).filter(({ l }) => {
        const f = sectorOf(l.front);
        const b = sectorOf(l.back);
        return f !== b && l.v1 !== l.v2;
    });
    const inside = linedefs.length - lines.length;
    if (inside) {
        notes.push(`${inside} linedefs with one sector on both sides left out: they bound `
            + `nothing (Doom draws see-through textures on such lines)`);
    }

    // A wall seen from its open side; a lintel from the higher ceiling's side, a riser from
    // the lower floor's: each with its texture's colour and the way it faces, in the map's
    // terms (Doom's east is the map's y, north its x). A missing texture falls back on the
    // other side's, then any other. The top is the wall or lintel, the bottom the riser.
    const faces = (l: Linedef): { top: Surface; bottom?: Surface } => {
        const front = l.front >= 0 ? sidedefs[l.front] : undefined;
        const back = l.back >= 0 ? sidedefs[l.back] : undefined;
        const f = front ? styles[front.sector] : undefined;
        const b = back ? styles[back.sector] : undefined;
        const p = level.vertices[l.v1]!;
        const q = level.vertices[l.v2]!;
        const length = Math.hypot(q.x - p.x, q.y - p.y);
        const toFront: Direction = [-(q.x - p.x) / length, (q.y - p.y) / length, 0];
        const facing = (side: Sidedef | undefined): Direction =>
            (side === front ? toFront : [-toFront[0], -toFront[1], 0]);
        const any = (...sides: (Sidedef | undefined)[]): Linear => {
            for (const side of sides) {
                for (const name of [side?.middle, side?.upper, side?.lower]) {
                    const colour = name === undefined ? undefined : texture(name);
                    if (colour) {
                        return colour;
                    }
                }
            }
            missing.add('a line with no textures');
            return FALLBACK;
        };
        if (!f || !b || f.solid || b.solid) {
            const open = f && !f.solid ? front : back;
            const colour = any(open, open === front ? back : front);
            return { top: { colour, normal: facing(open) } };
        }
        let lintel: Surface | undefined;
        let riser: Surface | undefined;
        if (f.ceiling !== b.ceiling) {
            const [near, far] = f.ceiling > b.ceiling ? [front, back] : [back, front];
            const skies = sectors[front!.sector]!.ceilingFlat === SKY_FLAT
                && sectors[back!.sector]!.ceilingFlat === SKY_FLAT;
            lintel = skies ? { colour: sky }    // the sky shows there: lit by nothing
                : {
                    colour: texture(near!.upper) ?? texture(far!.upper) ?? any(near, far),
                    normal: facing(near),
                };
        }
        if (f.floor !== b.floor) {
            const [near, far] = f.floor < b.floor ? [front, back] : [back, front];
            riser = {
                colour: texture(near!.lower) ?? texture(far!.lower) ?? any(near, far),
                normal: facing(near),
            };
        }
        const top = lintel ?? riser ?? { colour: any(front, back), normal: toFront };
        return { top, bottom: riser };
    };

    // ---- what every surface wants, worked out together ----

    const surfaces: Surface[] = [];
    const add = (surface: Surface) => surfaces.push(surface) - 1;
    const sectorSurfaces = sectors.map((s) => ({
        floor: add({ colour: flat(s.floorFlat), normal: UP }),
        ceiling: add(s.ceilingFlat === SKY_FLAT ? { colour: sky }
            : { colour: flat(s.ceilingFlat), normal: DOWN }),
    }));
    const lineSurfaces = lines.map(({ l }) => {
        const { top, bottom } = faces(l);
        return { top: add(top), bottom: bottom && add(bottom) };
    });
    const wants = surfaceWants(surfaces);
    const lineOf = new Map(lines.map(({ i }, k) => [i, k]));

    // ---- vertices: those the lines use, scaled, north up the page ----

    const used = [...new Set(lines.flatMap(({ l }) => [l.v1, l.v2]))].sort((p, q) => p - q);
    const dropped = level.vertices.length - used.length;
    if (dropped) {
        notes.push(`${dropped} vertices no line uses left out (the node builder's splits)`);
    }
    const points = used.map((v) => level.vertices[v]!);
    const minX = Math.min(...points.map((p) => p.x));
    const minY = Math.min(...points.map((p) => p.y));
    const place = (p: DoomVertex) => ({
        x: (p.y - minY) * SCALE + MARGIN,
        y: (p.x - minX) * SCALE + MARGIN,
    });
    const placed = points.map(place);
    const far = Math.max(...placed.map((p) => Math.max(p.x, p.y)));
    if (far > COORD_MAX) {
        throw new Error(`level ${name} is too big: scaled by ${SCALE}, it reaches ${far}, past `
            + `${COORD_MAX}`);
    }
    const index = new Map(used.map((v, i) => [v, i]));
    const draft: DraftEdge[] = lines.map(({ l, i }) => ({
        a: index.get(l.v1)!, b: index.get(l.v2)!, topShade: 0, bottomShade: 0,    // chosen below
        source: i, rank: 1, tags: 0,
    }));
    const planar = planarize(placed.map((p) => ({ x: toCoord(p.x), y: toCoord(p.y) })), draft);
    if (planar.vertices.length !== placed.length || planar.edges.length !== draft.length) {
        notes.push(`lines that crossed or overlapped were split or merged: `
            + `${placed.length} vertices became ${planar.vertices.length}, `
            + `${draft.length} lines ${planar.edges.length} edges`);
    }

    // ---- zones: a region each, with the sector its boundary faces into ----

    const edges: Edge[] = planar.edges.map(({ a, b, topShade, bottomShade }) =>
        ({ a, b, topShade, bottomShade }));
    const found = findRegions(planar.vertices, edges);
    const edgeAt = new Map(planar.edges.map((e, k) => [pairKey(e.a, e.b), k]));
    const pieces = sectors.map(() => 0);
    let voids = 0;
    const zoneSectors: number[] = [];    // each zone's sector, or for a solid one its neighbour's
    const zones: Zone[] = found.regions.map((region) => {
        // each boundary step has the region on its right, as a linedef has its front side
        const votes = new Map<number, number>();
        const across = new Map<number, number>();
        for (const cycle of [region.perimeter, ...region.holes]) {
            cycle.forEach((u, k) => {
                const v = cycle[(k + 1) % cycle.length]!;
                const e = planar.edges[edgeAt.get(pairKey(u, v))!]!;
                const l = linedefs[e.source]!;
                const [mine, theirs] = e.a === u ? [l.front, l.back] : [l.back, l.front];
                const s = sectorOf(mine);
                const t = sectorOf(theirs);
                votes.set(s, (votes.get(s) ?? 0) + 1);
                across.set(t, (across.get(t) ?? 0) + 1);
            });
        }
        const most = (counts: Map<number, number>) => [...counts]
            .filter(([s]) => s >= 0)
            .sort(([s, n], [t, m]) => m - n || s - t)[0]?.[0];
        const sector = most(votes);
        if (sector === undefined) {
            voids++;
            const beside = most(across) ?? 0;
            zoneSectors.push(beside);
            return { ...styles[beside]!, solid: true, perimeter: region.perimeter };
        }
        if ([...votes.keys()].filter((s) => s >= 0).length > 1) {
            notes.push(`a region of sector ${sector} also borders sectors `
                + `${[...votes.keys()].filter((s) => s >= 0 && s !== sector).join(', ')} on its `
                + `side: taken as sector ${sector}`);
        }
        pieces[sector]!++;
        zoneSectors.push(sector);
        return { ...styles[sector]!, perimeter: region.perimeter };
    });
    const split = pieces.filter((n) => n > 1).length;
    if (split) {
        notes.push(`${split} sectors in several pieces: a zone each`);
    }
    if (voids) {
        notes.push(`${voids} enclosed regions with no sector (inside pillars, say): solid zones`);
    }
    if (missing.size) {
        notes.push(`not in the WAD, so a dark grey: ${[...missing].sort().join(', ')}`);
    }

    // ---- the start: player 1's ----

    const player = level.things.find((t) => t.type === PLAYER_START);
    const at = player ? place(player) : placed[0]!;
    if (!player) {
        notes.push(`no player 1 start: the start is at a vertex`);
    }
    // Doom's angle runs anticlockwise from east; the engine's clockwise from north (up)
    const turn = player ? Math.round(64 - player.angle * ANGLE_STEPS / 360) : 0;
    const unshaded: PortalMap = {
        start: {
            x: toCoord(Math.min(COORD_MAX, Math.max(0, at.x))),
            y: toCoord(Math.min(COORD_MAX, Math.max(0, at.y))),
            angle: ((turn % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS,
        },
        vertices: planar.vertices,
        edges,
        zones,
    };

    // ---- shades: what each surface wants, unlike its neighbours' ----

    const lineWants = (source: number): { top: Want; bottom: Want } => {
        const { top, bottom } = lineSurfaces[lineOf.get(source)!]!;
        return { top: wants[top]!, bottom: wants[bottom ?? top]! };
    };
    const map = distinctShades(unshaded, found.regions, {
        floors: zoneSectors.map((s) => wants[sectorSurfaces[s]!.floor]!),
        ceilings: zoneSectors.map((s) => wants[sectorSurfaces[s]!.ceiling]!),
        tops: planar.edges.map((e) => lineWants(e.source).top),
        bottoms: planar.edges.map((e) => lineWants(e.source).bottom),
    });
    const check = checkMap(map);
    if (check.errors.length) {
        throw new Error(`level ${name} doesn't make a good map: ${check.errors.join('; ')}`);
    }
    return { doc: docFromMap(map, found.regions), notes };
}
