// level.ts - a Doom level as a map. Its linedefs become edges, between only the vertices they
// use (not those the node builder added for its splits), and each region they enclose becomes
// a zone with its sector's heights. A sector in several pieces gives a zone each; a region
// with no sector, such as the inside of a pillar, is solid. Shades are the nearest to the
// average colours of the flats and textures. Doom's map is scaled up by SCALE, bringing its
// eye height (41) near the engine's (80), and laid out as Doom's automap shows it, north up
// the page and east to the right.

import type { Doc, EdgeStyle } from '../map/edit';
import { docFromMap } from '../map/edit';
import { checkMap } from '../map/check';
import type { Edge, PortalMap, Zone } from '../map/map';
import { planarize, type DraftEdge } from '../map/planarize';
import { findRegions } from '../map/regions';
import { nearestShade, shadeFromName, shadeName } from '../map/shades';
import { ANGLE_STEPS, COORD_MAX, HEIGHT_STEP, toCoord, toHeight } from '../map/units';
import type { ZoneStyle } from '../map/zones';
import {
    flatColour, NO_TEXTURE, readLevel, readPalette, SKY_FLAT, textureColours,
    type DoomVertex, type Linedef, type Linear, type Sidedef, type Wad,
} from './wad';

export const SCALE = 2;
const MARGIN = 256;      // units left round the map, inside the coordinate range
const DOOR_LIP = 4;      // an open door stops this far below its lowest neighbouring ceiling
const PLAYER_START = 1;  // the thing type of player 1's start
const EXPOSURE = 2;      // colours brightened before matching: Doom's are dark, the shades bright
const FALLBACK = shadeFromName('KBRG')!;    // for a texture or flat the WAD doesn't have

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

    // ---- shades ----

    const palette = readPalette(wad);
    const textures = textureColours(wad, palette);
    const missing = new Set<string>();
    const shadeOf = (colour: Linear | undefined, what: string): number => {
        if (!colour) {
            missing.add(what);
            return FALLBACK;
        }
        const [r, g, b] = colour.map((c) => Math.min(1, c * EXPOSURE));
        return nearestShade([r!, g!, b!]);
    };
    const sky = shadeOf(textures.get(skyTexture(name)), skyTexture(name));
    const flatShade = (flat: string) =>
        (flat === SKY_FLAT ? sky : shadeOf(flatColour(wad, palette, flat), flat));
    const textureShade = (texture: string): number | undefined =>
        (texture === NO_TEXTURE || texture === '' ? undefined
            : shadeOf(textures.get(texture), texture));

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
            floorShade: flatShade(s.floorFlat), ceilingShade: flatShade(s.ceilingFlat),
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
    // the lower floor's. A missing texture falls back on the other side's, then any other.
    const edgeStyle = (l: Linedef): EdgeStyle => {
        const front = l.front >= 0 ? sidedefs[l.front] : undefined;
        const back = l.back >= 0 ? sidedefs[l.back] : undefined;
        const f = front ? styles[front.sector] : undefined;
        const b = back ? styles[back.sector] : undefined;
        const any = (...sides: (Sidedef | undefined)[]) => {
            for (const side of sides) {
                for (const texture of [side?.middle, side?.upper, side?.lower]) {
                    const shade = texture === undefined ? undefined : textureShade(texture);
                    if (shade !== undefined) {
                        return shade;
                    }
                }
            }
            return FALLBACK;
        };
        if (!f || !b || f.solid || b.solid) {
            const open = f && !f.solid ? front : back;
            const shade = any(open, open === front ? back : front);
            return { topShade: shade, bottomShade: shade };
        }
        let lintel: number | undefined;
        let riser: number | undefined;
        if (f.ceiling !== b.ceiling) {
            const [near, far] = f.ceiling > b.ceiling ? [front, back] : [back, front];
            const skies = sectors[front!.sector]!.ceilingFlat === SKY_FLAT
                && sectors[back!.sector]!.ceilingFlat === SKY_FLAT;
            lintel = skies ? sky
                : textureShade(near!.upper) ?? textureShade(far!.upper) ?? any(near, far);
        }
        if (f.floor !== b.floor) {
            const [near, far] = f.floor < b.floor ? [front, back] : [back, front];
            riser = textureShade(near!.lower) ?? textureShade(far!.lower) ?? any(near, far);
        }
        const top = lintel ?? riser ?? any(front, back);
        return { topShade: top, bottomShade: riser ?? top };
    };

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
        a: index.get(l.v1)!, b: index.get(l.v2)!, ...edgeStyle(l), source: i, rank: 1, tags: 0,
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
            const beside = most(across);
            const style = beside === undefined ? styles[0]! : styles[beside]!;
            return { ...style, solid: true, perimeter: region.perimeter };
        }
        if ([...votes.keys()].filter((s) => s >= 0).length > 1) {
            notes.push(`a region of sector ${sector} also borders sectors `
                + `${[...votes.keys()].filter((s) => s >= 0 && s !== sector).join(', ')} on its `
                + `side: taken as sector ${sector}`);
        }
        pieces[sector]!++;
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
        notes.push(`not in the WAD, so ${shadeName(FALLBACK)}: ${[...missing].sort().join(', ')}`);
    }

    // ---- the start: player 1's ----

    const player = level.things.find((t) => t.type === PLAYER_START);
    const at = player ? place(player) : placed[0]!;
    if (!player) {
        notes.push(`no player 1 start: the start is at a vertex`);
    }
    // Doom's angle runs anticlockwise from east; the engine's clockwise from north (up)
    const turn = player ? Math.round(64 - player.angle * ANGLE_STEPS / 360) : 0;
    const map: PortalMap = {
        start: {
            x: toCoord(Math.min(COORD_MAX, Math.max(0, at.x))),
            y: toCoord(Math.min(COORD_MAX, Math.max(0, at.y))),
            angle: ((turn % ANGLE_STEPS) + ANGLE_STEPS) % ANGLE_STEPS,
        },
        vertices: planar.vertices,
        edges,
        zones,
    };
    const check = checkMap(map);
    if (check.errors.length) {
        throw new Error(`level ${name} doesn't make a good map: ${check.errors.join('; ')}`);
    }
    return { doc: docFromMap(map, found.regions), notes };
}
