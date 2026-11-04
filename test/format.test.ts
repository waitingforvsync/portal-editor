import { describe, expect, it } from 'vitest';

import demoText from '../maps/demo.pmap?raw';
import { parseMap, writeMap, type ParseResult } from '../src/map/format';
import { shadeFromName } from '../src/map/shades';
import { mapText, SQUARE, SQUARE_ZONE } from './helpers';

function errorsOf(result: ParseResult): string[] {
    return result.ok ? [] : result.errors;
}

// The text parses with exactly one error, which contains each of the fragments.
function expectError(text: string, ...fragments: string[]) {
    const result = parseMap(text);
    expect(result.ok).toBe(false);
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    for (const f of fragments) {
        expect(errors[0]).toContain(f);
    }
}

describe('the demo map', () => {
    const parsed = parseMap(demoText);

    it('parses, with no warnings', () => {
        expect(errorsOf(parsed)).toEqual([]);
        expect(parsed.ok && parsed.warnings).toEqual([]);
    });

    it('holds the demo scene: 55 vertices, 66 edges, 15 zones, one solid', () => {
        if (!parsed.ok) {
            throw new Error('no map');
        }
        const { map } = parsed;
        expect(map.start).toEqual({ x: 1756, y: 1536, angle: 128 });
        expect(map.vertices).toHaveLength(55);
        expect(map.edges).toHaveLength(66);
        expect(map.zones).toHaveLength(15);
        expect(map.zones.filter((z) => z.solid)).toHaveLength(1);
        expect(map.zones[0]).toEqual({
            solid: false, floor: -24, ceiling: 160,
            floorShade: shadeFromName('GGGG'), ceilingShade: shadeFromName('KKKB'),
            perimeter: [5, 6, 7, 8],
        });
        expect(parsed.zoneRegions).toHaveLength(15);
    });

    it('writes back exactly as it is stored', () => {
        if (!parsed.ok) {
            throw new Error('no map');
        }
        expect(writeMap(parsed.map)).toBe(demoText);
    });
});

describe('parseMap', () => {
    it('reads a square zone', () => {
        const result = parseMap(mapText(...SQUARE, SQUARE_ZONE));
        expect(errorsOf(result)).toEqual([]);
        if (result.ok) {
            expect(result.map.zones).toHaveLength(1);
            expect(result.zoneRegions[0]).toEqual({ perimeter: [0, 1, 2, 3], holes: [] });
        }
    });

    it('takes the perimeter from any vertex, and records in any order', () => {
        const zone = 'z 0 64 KRRR KKKB 2 3 0 1';
        expect(errorsOf(parseMap(mapText(zone, ...SQUARE)))).toEqual([]);
    });

    it('ignores comments, blank lines, spacing and CRLF line ends', () => {
        const spaced = SQUARE.map((l) => `  ${l.replace(/ /g, '\t ')}  # note`);
        const text = mapText('# a comment', '', ...spaced, SQUARE_ZONE).replace(/\n/g, '\r\n');
        expect(errorsOf(parseMap(text))).toEqual([]);
    });

    it('reads a solid zone, with the heights and shades it keeps', () => {
        const result = parseMap(mapText(...SQUARE, 'z solid -8 64 KRRR KKKB 0 1 2 3'));
        expect(result.ok && result.map.zones[0]).toEqual({
            solid: true, floor: -8, ceiling: 64,
            floorShade: shadeFromName('KRRR'), ceilingShade: shadeFromName('KKKB'),
            perimeter: [0, 1, 2, 3],
        });
    });

    it('warns of construction lines', () => {
        const result = parseMap(mapText(...SQUARE, 'v 5 5', 'e 0 4 KKKK', SQUARE_ZONE));
        const warning = 'edge 4 (line 12) has the same region on both sides';
        expect(result.ok && result.warnings).toEqual([warning]);
    });

    it('takes a map with no edges or zones', () => {
        const result = parseMap(mapText());
        expect(result.ok && result.map).toEqual({
            start: { x: 5, y: 5, angle: 0 }, vertices: [], edges: [], zones: [],
        });
    });
});

describe('parseMap errors: the header and records', () => {
    it('needs the version line first', () => {
        expectError('', `no 'portalmap 1' line`);
        expectError('# only a comment\n', `no 'portalmap 1' line`);
        expectError('start 5 5 0\nportalmap 1\n', 'line 1', `expected 'portalmap 1' first`);
        expectError('portalmap\n', 'line 1', 'expected');
        expectError('portalmap 2\n', 'line 1', `version 2 isn't supported`);
    });

    it('needs exactly one start, in range', () => {
        expectError('portalmap 1\n', `no 'start' line`);
        expectError(mapText('start 5 5 0'), 'line 3', `a second 'start'`);
        expectError('portalmap 1\nstart 5 5\n', 'line 2', `'start' takes x y angle`);
        expectError('portalmap 1\nstart 65536 5 0\n', 'line 2', 'start position');
        expectError('portalmap 1\nstart 5 5 x\n', 'line 2', 'start angle');
        expectError('portalmap 1\nstart 5 5 256\n', 'start (line 2)', 'angle');
        expectError('portalmap 1\nstart 5 5 -1\n', 'start (line 2)', 'angle');
    });

    it('needs vertices to be whole numbers in range', () => {
        expectError(mapText('v 1'), 'line 3', `'v' takes x y`);
        expectError(mapText('v 1 2 3'), 'line 3', `'v' takes x y`);
        expectError(mapText('v -1 0'), 'line 3', 'vertex');
        expectError(mapText('v 0 65536'), 'line 3', 'vertex');
        expectError(mapText('v 1.5 0'), 'line 3', 'vertex');
        expectError(mapText('v 0x10 0'), 'line 3', 'vertex');
    });

    it('needs edges to name vertices and a shade', () => {
        expectError(mapText('e 0 1'), 'line 3', `'e' takes v0 v1 shade`);
        expectError(mapText('e 0 -1 KKKK'), 'line 3', 'vertex numbers');
        expectError(mapText('e 0 1 kkkk'), 'line 3', `no shade 'kkkk'`);
        expectError(mapText('e 0 1 KKBK'), 'line 3', `no shade 'KKBK'`);
    });

    it('needs zones to have heights in steps, shades and a perimeter', () => {
        expectError(mapText(...SQUARE, 'z 0 64 KRRR'), 'line 11', `'z' takes`);
        expectError(mapText(...SQUARE, 'z 4 64 KRRR KKKB 0 1 2 3'), 'line 11', 'multiples of 8');
        expectError(mapText(...SQUARE, 'z 0 x KRRR KKKB 0 1 2 3'), 'line 11', 'multiples of 8');
        expectError(mapText(...SQUARE, 'z 0 64 XXXX KKKB 0 1 2 3'), 'line 11', `no shade 'XXXX'`);
        expectError(mapText(...SQUARE, 'z 0 64 KRRR XXXX 0 1 2 3'), 'line 11', `no shade 'XXXX'`);
        expectError(mapText(...SQUARE, 'z 0 64 KRRR KKKB 0 1 a 3'), 'line 11', 'vertex numbers');
        expectError(mapText(...SQUARE, 'z solid 0 64 KRRR KKKB 0 1 -2 3'), 'line 11',
            'vertex numbers');
        expectError(mapText(...SQUARE, 'z solid 0 64 KRRR'), 'line 11', `'z' takes [solid]`);
    });

    it('knows only its own records', () => {
        expectError(mapText('w 1 2'), 'line 3', `no record 'w'`);
    });

    it('reports every bad line, not just the first', () => {
        const errors = errorsOf(parseMap(mapText('v 1', 'q', 'e 0 1 ZZZZ')));
        expect(errors).toHaveLength(3);
        expect(errors.map((e) => e.slice(0, 7))).toEqual(['line 3:', 'line 4:', 'line 5:']);
    });
});

describe('parseMap errors: the map as a whole', () => {
    it('needs vertices at distinct points', () => {
        expectError(mapText('v 1 1', 'v 1 1'), 'vertex 1 (line 4)', 'vertex 0 (line 3)');
    });

    it('needs edges between distinct vertices that exist, once each', () => {
        expectError(mapText('v 1 1', 'e 0 1 KKKK'), 'edge 0 (line 4)', `doesn't exist`);
        expectError(mapText('v 1 1', 'e 0 0 KKKK'), 'edge 0 (line 4)', 'to itself');
        expectError(mapText('v 1 1', 'v 2 2', 'e 0 1 KKKK', 'e 1 0 KKBB'),
            'edge 1 (line 6)', 'repeats edge 0');
    });

    it('needs edges that neither cross nor pass through vertices', () => {
        expectError(mapText('v 0 0', 'v 10 10', 'v 0 10', 'v 10 0', 'e 0 1 KKKK', 'e 2 3 KKKK'),
            'edge 0 (line 7) crosses edge 1 (line 8)');
        expectError(mapText('v 0 0', 'v 10 10', 'v 5 5', 'e 0 1 KKKK'),
            'vertex 2 (line 5) lies on edge 0');
        expectError(mapText('v 0 0', 'v 10 10', 'v 5 5', 'e 0 1 KKKK', 'e 0 2 KKKK'),
            'vertex 2 (line 5) lies on edge 0');
    });

    it('needs zones that run along edges, floor below ceiling', () => {
        expectError(mapText(...SQUARE, 'z 0 64 KRRR KKKB 0 1'), 'zone 0 (line 11)', 'fewer than 3');
        expectError(mapText(...SQUARE, 'z 0 64 KRRR KKKB 0 1 9'),
            'zone 0 (line 11)', `doesn't exist`);
        expectError(mapText(...SQUARE, 'z 64 64 KRRR KKKB 0 1 2 3'),
            'zone 0 (line 11)', 'below its ceiling');
        expectError(mapText(...SQUARE, 'z 0 -8 KRRR KKKB 0 1 2 3'),
            'zone 0 (line 11)', 'below its ceiling');
        expectError(mapText(...SQUARE, 'z solid 64 64 KRRR KKKB 0 1 2 3'),
            'zone 0 (line 11)', 'below its ceiling');
        const diagonal = mapText(...SQUARE, 'e 0 2 KKKK',
            'z 0 64 KRRR KKKB 0 1 2 3', 'z 0 64 KRRR KKKB 0 2 3');
        const errors = errorsOf(parseMap(diagonal));
        expect(errors).toContain('zone 0 (line 12) has a perimeter no region has');
        expect(errors).toContain('no zone for the region with perimeter 0 1 2');
    });

    it('needs perimeters clockwise', () => {
        expectError(mapText(...SQUARE, 'z 0 64 KRRR KKKB 3 2 1 0'),
            'zone 0 (line 11)', 'anticlockwise');
    });

    it('needs one zone per region, and no more', () => {
        expectError(mapText(...SQUARE), 'no zone for the region with perimeter 0 1 2 3');
        expectError(mapText(...SQUARE, SQUARE_ZONE, 'z solid 0 64 KRRR KKKB 1 2 3 0'),
            'zone 1 (line 12)', 'same perimeter as zone 0');
    });

    it('needs a zone round a hole, solid or open', () => {
        const big = ['v 0 0', 'v 50 0', 'v 50 50', 'v 0 50',
            'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK'];
        const ring = ['v 20 20', 'v 30 20', 'v 30 30', 'v 20 30',
            'e 4 5 KKKK', 'e 5 6 KKKK', 'e 6 7 KKKK', 'e 7 4 KKKK'];
        const text = (...zones: string[]) => mapText(...big, ...ring, ...zones);
        expect(errorsOf(parseMap(text('z 0 64 KRRR KKKB 0 1 2 3')))).toEqual([
            'no zone for the region with perimeter 4 5 6 7',
        ]);
        const pillar = text('z 0 64 KRRR KKKB 0 1 2 3', 'z solid 0 64 KRRR KKKB 4 5 6 7');
        expect(errorsOf(parseMap(pillar))).toEqual([]);
    });
});

describe('writeMap', () => {
    it('writes each perimeter from its lowest vertex', () => {
        const result = parseMap(mapText(...SQUARE, 'z 0 64 KRRR KKKB 2 3 0 1'));
        expect(result.ok && writeMap(result.map)).toContain('\nz 0 64 KRRR KKKB 0 1 2 3\n');
    });

    it('writes solid zones and an empty map', () => {
        const solid = parseMap(mapText(...SQUARE, 'z solid 0 64 KRRR KKKB 1 2 3 0'));
        expect(solid.ok && writeMap(solid.map)).toContain('\nz solid 0 64 KRRR KKKB 0 1 2 3\n');
        const empty = parseMap(mapText());
        expect(empty.ok && writeMap(empty.map)).toBe([
            'portalmap 1', '', 'start 5 5 0', '', '# v x y', '', '# e v0 v1 shade', '',
            '# z [solid] floor ceiling floor-shade ceiling-shade perimeter', '',
        ].join('\n'));
    });

    it('writes what it reads back to the same map', () => {
        const first = parseMap(mapText(...SQUARE, 'v 5 5', 'e 0 4 KBRG',
            'z -16 0 GGGG BBBB 3 0 1 2'));
        if (!first.ok) {
            throw new Error(first.errors.join('\n'));
        }
        const second = parseMap(writeMap(first.map));
        expect(second.ok && second.map).toEqual({
            ...first.map,
            zones: [{ ...first.map.zones[0]!, perimeter: [0, 1, 2, 3] }],
        });
    });
});
