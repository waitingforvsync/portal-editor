import { describe, expect, it } from 'vitest';

import { Editor } from '../src/editor/editor';
import { hitTest, roundToGrid, snapAt, zoneAt } from '../src/editor/hit';
import {
    isSelected, mapSelection, selectedEdges, selectedZones, verticesOf,
} from '../src/editor/selection';
import { View } from '../src/editor/view';
import { docFromMap, restyleZones } from '../src/map/edit';
import { parseMap } from '../src/map/format';
import { toHeight } from '../src/map/units';
import { mapText, pt } from './helpers';

// A 100-unit room, and a 20-unit pillar in it, from (40, 40).
function roomDoc() {
    const parsed = parseMap(mapText(
        'v 0 0', 'v 100 0', 'v 100 100', 'v 0 100',
        'v 40 40', 'v 60 40', 'v 60 60', 'v 40 60',
        'e 0 1 KKKK', 'e 1 2 KKKK', 'e 2 3 KKKK', 'e 3 0 KKKK',
        'e 4 5 KKKK', 'e 5 6 KKKK', 'e 6 7 KKKK', 'e 7 4 KKKK',
        'z 0 160 KRRR KKKB 0 1 2 3', 'z solid 0 160 KRRR KKKB 4 5 6 7',
    ));
    if (!parsed.ok) {
        throw new Error(parsed.errors.join('\n'));
    }
    return docFromMap(parsed.map, parsed.zoneRegions);
}

// A view of 200 x 200 pixels, 2 pixels a unit, centred on (50, 50): the room fills it.
function roomView() {
    const view = new View();
    view.width = 200;
    view.height = 200;
    view.centreX = 50;
    view.centreY = 50;
    view.scale = 2;
    return view;
}

describe('View', () => {
    it('puts x up the screen and y to the right', () => {
        const view = roomView();
        expect(view.toScreen(50, 50)).toEqual([100, 100]);
        expect(view.toScreen(100, 50)).toEqual([100, 0]);    // up
        expect(view.toScreen(50, 100)).toEqual([200, 100]);  // right
    });

    it('turns screen points back into the map', () => {
        const view = roomView();
        for (const [x, y] of [[0, 0], [12.5, 99], [100, 3]] as const) {
            const [sx, sy] = view.toScreen(x, y);
            const back = view.toWorld(sx, sy);
            expect(back.x).toBeCloseTo(x, 9);
            expect(back.y).toBeCloseTo(y, 9);
        }
    });

    it('zooms about a point, which stays put', () => {
        const view = roomView();
        const before = view.toWorld(30, 170);
        view.zoomAt(30, 170, 3);
        expect(view.scale).toBe(6);
        const after = view.toWorld(30, 170);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
    });

    it('limits the zoom', () => {
        const view = roomView();
        view.zoomAt(0, 0, 1e9);
        expect(view.scale).toBe(64);
        view.zoomAt(0, 0, 1e-12);
        expect(view.scale).toBe(1 / 256);
    });

    it('pans with the pointer', () => {
        const view = roomView();
        const under = view.toWorld(120, 80);
        view.pan(10, -20);
        const moved = view.toWorld(130, 60);
        expect(moved.x).toBeCloseTo(under.x, 9);
        expect(moved.y).toBeCloseTo(under.y, 9);
    });

    it('fits a box', () => {
        const view = roomView();
        view.fit(0, 0, 100, 400, 0);
        expect(view.scale).toBe(0.5);    // 400 units across 200 pixels
        expect([view.centreX, view.centreY]).toEqual([50, 200]);
    });
});

describe('roundToGrid', () => {
    it('rounds to the grid, or whole units, and keeps in range', () => {
        expect(roundToGrid({ x: 23.9, y: -3 }, 16)).toEqual(pt(16, 0));
        expect(roundToGrid({ x: 24, y: 40 }, 16)).toEqual(pt(32, 48));
        expect(roundToGrid({ x: 23.4, y: 7.6 }, 0)).toEqual(pt(23, 8));
        expect(roundToGrid({ x: 70000, y: 65535.4 }, 0)).toEqual(pt(65535, 65535));
    });
});

describe('hitTest', () => {
    const doc = roomDoc();
    const view = roomView();
    const at = (x: number, y: number) => view.toScreen(x, y);

    it('picks a vertex first, then an edge, then a zone', () => {
        expect(hitTest(doc, view, ...at(1, 2), true)).toEqual({ kind: 'vertex', index: 0 });
        expect(hitTest(doc, view, ...at(50, 1), true)).toEqual({ kind: 'edge', index: 0 });
        expect(hitTest(doc, view, ...at(20, 20), true)).toEqual({ kind: 'zone', index: 0 });
        expect(hitTest(doc, view, ...at(50, 50), true)).toEqual({ kind: 'zone', index: 1 });
        expect(hitTest(doc, view, ...at(20, 20), false)).toEqual({ kind: 'none' });
    });

    it('finds nothing out of reach', () => {
        expect(hitTest(doc, view, ...at(50, 20), true)).toEqual({ kind: 'zone', index: 0 });
        expect(hitTest(doc, view, -50, -50, true)).toEqual({ kind: 'none' });
    });

    it('finds the zone a point is in, holes excluded', () => {
        expect(zoneAt(doc, { x: 10, y: 10 })).toBe(0);
        expect(zoneAt(doc, { x: 50, y: 50 })).toBe(1);
        expect(zoneAt(doc, { x: 150, y: 50 })).toBeUndefined();
    });
});

describe('snapAt', () => {
    const doc = roomDoc();
    const view = roomView();
    const at = (x: number, y: number) => view.toScreen(x, y);

    const snap = (x: number, y: number, grid: number) => snapAt(doc, view, ...at(x, y), grid);

    it('snaps to a vertex in reach', () => {
        expect(snap(2, 1, 16)).toEqual({ kind: 'vertex', index: 0, at: pt(0, 0) });
    });

    it('snaps onto an edge, at a grid point on it where there is one', () => {
        expect(snap(1, 30, 16)).toEqual({ kind: 'edge', index: 3, at: pt(0, 32) });
        expect(snap(1, 30, 0)).toEqual({ kind: 'edge', index: 3, at: pt(0, 30) });
    });

    it('snaps to the grid elsewhere', () => {
        expect(snap(23, 75, 16)).toEqual({ kind: 'point', at: pt(16, 80) });
        expect(snap(23, 75, 0)).toEqual({ kind: 'point', at: pt(23, 75) });
    });

    it('passes over what it is told to', () => {
        const exclude = { vertex: (v: number) => v === 0, edge: () => true };
        const passed = snapAt(doc, view, ...at(2, 1), 16, exclude);
        expect(passed).toEqual({ kind: 'point', at: pt(0, 0) });
    });
});

describe('selection', () => {
    const doc = roomDoc();

    it('selects edges by both ends, and zones by their whole perimeter', () => {
        const selection = new Set([0, 1, 2, 3]);
        expect(selectedEdges(doc, selection)).toEqual([0, 1, 2, 3]);
        expect(selectedZones(doc, selection)).toEqual([0]);    // the pillar's vertices don't count
        expect(selectedEdges(doc, new Set([0, 2]))).toEqual([]);
        expect(selectedZones(doc, new Set([0, 1, 2]))).toEqual([]);
    });

    it('gives the vertices of what was hit', () => {
        expect(verticesOf(doc, { kind: 'vertex', index: 5 })).toEqual([5]);
        expect(verticesOf(doc, { kind: 'edge', index: 4 })).toEqual([4, 5]);
        expect(verticesOf(doc, { kind: 'zone', index: 1 })).toEqual([4, 5, 6, 7]);
        expect(verticesOf(doc, { kind: 'none' })).toEqual([]);
    });

    it('says whether what was hit is selected', () => {
        expect(isSelected(doc, new Set([4, 5]), { kind: 'edge', index: 4 })).toBe(true);
        expect(isSelected(doc, new Set([4]), { kind: 'edge', index: 4 })).toBe(false);
        expect(isSelected(doc, new Set([0]), { kind: 'none' })).toBe(false);
    });

    it('follows vertices through an edit, dropping deleted ones', () => {
        expect(mapSelection(new Set([0, 1, 2]), [3, -1, 0])).toEqual(new Set([3, 0]));
    });
});

describe('Editor', () => {
    const raise = (editor: Editor, by: number, merge?: string) => editor.commit(
        restyleZones(editor.doc, [0], (s) => ({ ...s, floor: toHeight(s.floor + by) })),
        editor.selection, merge);
    const floor = (editor: Editor) => editor.doc.map.zones[0]!.floor;

    it('makes commits with one merge key in a row one step to undo', () => {
        const editor = new Editor(roomDoc());
        raise(editor, 8);
        raise(editor, 8, 'step');
        raise(editor, 8, 'step');
        raise(editor, 8, 'step');
        expect(floor(editor)).toBe(32);
        editor.undo();
        expect(floor(editor)).toBe(8);
        editor.undo();
        expect(floor(editor)).toBe(0);
        expect(editor.canUndo).toBe(false);
    });

    it('starts a new step after another key, a selection, or an undo', () => {
        const editor = new Editor(roomDoc());
        raise(editor, 8, 'step');
        raise(editor, 8, 'other');
        editor.select([0]);
        raise(editor, 8, 'other');
        editor.undo();
        raise(editor, 16, 'other');
        expect(floor(editor)).toBe(32);
        editor.undo();
        expect(floor(editor)).toBe(16);
        editor.undo();
        expect(floor(editor)).toBe(8);
        editor.undo();
        expect(floor(editor)).toBe(0);
    });
});
