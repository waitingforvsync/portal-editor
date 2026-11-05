// editor.ts - the editor's state: the document and the selection, with undo and redo; the
// mode; the grid; what new zones and edges get; and a message for the status line.

import type { Doc, EditDefaults } from '../map/edit';
import { shadeFromName } from '../map/shades';
import { toHeight } from '../map/units';
import type { Selection } from './selection';

export type Mode = 'geometry' | 'select' | 'player';

interface Snapshot {
    doc: Doc;
    selection: Selection;
}

const HISTORY = 200;

export const GRID_SIZES = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];

// The start's angle snaps (with the grid on) and steps by this many 256ths of a turn.
export const ANGLE_SNAP = 8;

export class Editor {
    private present: Snapshot;
    private past: Snapshot[] = [];
    private future: Snapshot[] = [];
    private readonly listeners = new Set<() => void>();
    private merging: string | undefined;    // the last commit's merge key, while it may merge

    mode: Mode = 'geometry';
    gridOn = true;
    gridSize = 16;
    dither = false;      // the 3D view in the engine's dithers, else their average colours
    showCells = true;    // the plan shows the soft lines between zones' convex cells
    fileName = 'untitled.pmap';
    modified = false;
    message = '';    // shown in the status line until the next press in the plan

    // what new zones and edges get
    readonly defaults: EditDefaults = {
        zone: {
            solid: false, floor: toHeight(0), ceiling: toHeight(160),
            floorShade: shadeFromName('KRRR')!, ceilingShade: shadeFromName('KKKB')!,
        },
        edge: { topShade: shadeFromName('BBRR')!, bottomShade: shadeFromName('BBRR')! },
    };

    constructor(doc: Doc) {
        this.present = { doc, selection: new Set() };
    }

    get doc(): Doc {
        return this.present.doc;
    }

    get selection(): Selection {
        return this.present.selection;
    }

    // The grid to snap to: its size, or 0 when it's off.
    get grid(): number {
        return this.gridOn ? this.gridSize : 0;
    }

    get canUndo(): boolean {
        return this.past.length > 0;
    }

    get canRedo(): boolean {
        return this.future.length > 0;
    }

    onChange(listener: () => void) {
        this.listeners.add(listener);
    }

    changed() {
        for (const listener of this.listeners) {
            listener();
        }
    }

    // An edit: the document and selection after it, as one step to undo. Commits with the
    // same merge key in a row, with nothing else between, make one step.
    commit(doc: Doc, selection: Iterable<number>, merge?: string) {
        if (merge === undefined || merge !== this.merging || !this.past.length) {
            this.past.push(this.present);
            if (this.past.length > HISTORY) {
                this.past.shift();
            }
        }
        this.merging = merge;
        this.future = [];
        this.present = { doc, selection: new Set(selection) };
        this.modified = true;
        this.changed();
    }

    // A new selection, which isn't a step to undo.
    select(selection: Iterable<number>) {
        this.merging = undefined;
        this.present = { doc: this.present.doc, selection: new Set(selection) };
        this.changed();
    }

    undo() {
        this.merging = undefined;
        const previous = this.past.pop();
        if (previous) {
            this.future.push(this.present);
            this.present = previous;
            this.modified = true;
            this.changed();
        }
    }

    redo() {
        this.merging = undefined;
        const next = this.future.pop();
        if (next) {
            this.past.push(this.present);
            this.present = next;
            this.modified = true;
            this.changed();
        }
    }

    // A document from a file (or a new one), with the history cleared.
    load(doc: Doc, fileName: string) {
        this.present = { doc, selection: new Set() };
        this.merging = undefined;
        this.past = [];
        this.future = [];
        this.fileName = fileName;
        this.modified = false;
        this.changed();
    }

    // Say something in the status line.
    tell(message: string) {
        this.message = message;
        this.changed();
    }

    setMode(mode: Mode) {
        this.mode = mode;
        this.changed();
    }

    setShowCells(on: boolean) {
        this.showCells = on;
        this.changed();
    }

    setDither(on: boolean) {
        this.dither = on;
        this.changed();
    }

    setGrid(on: boolean, size = this.gridSize) {
        this.gridOn = on;
        this.gridSize = size;
        this.changed();
    }
}
