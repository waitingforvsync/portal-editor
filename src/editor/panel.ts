// panel.ts - the properties panel: the selected zones', edges' and vertices' properties, to
// read and change. A field shows the value the selection shares, or 'mixed'; setting it sets
// it on all of them, and - and + step each from its own value. Each change is a step to undo,
// and steps of one field in a row make one. A change that can't be made (a floor at or above
// its ceiling, say) is refused, with the reason in the status line.

import { moveVertices, restyleEdges, restyleZones, type Doc } from '../map/edit';
import { edgeZones, facesBetween, type Face } from '../map/faces';
import { HARDWARE_RGB, NUM_SHADES, shadeName, shadeTile } from '../map/shades';
import { COORD_MAX, HEIGHT_STEP, isCoord, isHeight, toHeight, type Height } from '../map/units';
import type { ZoneStyle } from '../map/zones';
import type { Editor } from './editor';
import { mapSelection, selectedEdges, selectedZones } from './selection';

const BIG_STEPS = 8;    // a step with Shift held is this many steps

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    e.textContent = text;
    return e;
}

// A button that hands the keyboard back to the page once it's pressed.
function button(className: string, text: string, title: string): HTMLButtonElement {
    const b = element('button', className, text);
    b.type = 'button';
    b.title = title;
    b.addEventListener('mouseup', () => b.blur());
    return b;
}

// The value every item has, or undefined if they differ.
function common<T>(values: readonly T[]): T | undefined {
    return values.length && values.every((v) => v === values[0]) ? values[0] : undefined;
}

function plural(n: number, one: string, many: string): string {
    return `${n} ${n === 1 ? one : many}`;
}

// ---- shades ----

// A shade's 4x2 dither tile as an image, for a swatch's background.
const tiles: string[] = [];
function tileImage(shade: number): string {
    let url = tiles[shade];
    if (url === undefined) {
        const canvas = element('canvas');
        canvas.width = 4;
        canvas.height = 2;
        const ctx = canvas.getContext('2d')!;
        shadeTile(shade).forEach((colour, i) => {
            ctx.fillStyle = `rgb(${HARDWARE_RGB[colour]!.join(', ')})`;
            ctx.fillRect(i % 4, Math.floor(i / 4), 1, 1);
        });
        url = `url(${canvas.toDataURL()})`;
        tiles[shade] = url;
    }
    return url;
}

function paintSwatch(swatch: HTMLElement, shade: number | undefined) {
    swatch.classList.toggle('mixed', shade === undefined);
    swatch.style.backgroundImage = shade === undefined ? '' : tileImage(shade);
}

// The grid of all the shades, opened from a shade button: a click picks one, Esc or a click
// elsewhere closes it.
class ShadePicker {
    private readonly root = element('div', 'shade-picker');
    private readonly cells: HTMLButtonElement[] = [];
    private readonly label = element('div', 'label');
    private opener: HTMLElement | undefined;
    private choose: ((shade: number) => void) | undefined;
    private current: number | undefined;

    constructor() {
        const grid = element('div', 'grid');
        for (let shade = 0; shade < NUM_SHADES; shade++) {
            const cell = button('swatch', '', shadeName(shade));
            paintSwatch(cell, shade);
            cell.dataset['shade'] = String(shade);
            cell.addEventListener('mouseenter', () => this.name(shade));
            cell.addEventListener('mouseleave', () => this.name(this.current));
            cell.addEventListener('click', () => {
                const choose = this.choose;
                this.close();
                choose?.(shade);
            });
            this.cells.push(cell);
            grid.append(cell);
        }
        this.root.append(grid, this.label);
        this.root.hidden = true;
        document.body.append(this.root);

        // before the plan sees them: Esc closes this rather than clearing the selection
        window.addEventListener('keydown', (e) => {
            if (this.opener && e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                this.close();
            }
        }, true);
        window.addEventListener('pointerdown', (e) => {
            const target = e.target as Node;
            if (this.opener && !this.root.contains(target) && !this.opener.contains(target)) {
                this.close();
            }
        }, true);
    }

    // Open below the opener (above it, if there's no room), or close if it's open there.
    open(opener: HTMLElement, current: number | undefined, choose: (shade: number) => void) {
        if (this.opener === opener) {
            this.close();
            return;
        }
        this.opener = opener;
        this.choose = choose;
        this.current = current;
        this.cells.forEach((cell, shade) => cell.classList.toggle('current', shade === current));
        this.name(current);
        this.root.hidden = false;
        const at = opener.getBoundingClientRect();
        const width = this.root.offsetWidth;
        const height = this.root.offsetHeight;
        const below = at.bottom + 4;
        const left = Math.max(4, Math.min(at.right, window.innerWidth - 4) - width);
        const top = below + height <= window.innerHeight ? below : at.top - 4 - height;
        this.root.style.left = `${left}px`;
        this.root.style.top = `${top}px`;
    }

    close() {
        this.root.hidden = true;
        this.opener = undefined;
        this.choose = undefined;
    }

    private name(shade: number | undefined) {
        this.label.textContent = shade === undefined ? 'mixed' : `${shadeName(shade)}  (${shade})`;
    }
}

// A swatch and a shade's name, opening the picker.
class ShadeButton {
    readonly button: HTMLButtonElement;
    private readonly swatch = element('span', 'swatch');
    private readonly name = element('span', 'name');
    private shade: number | undefined;

    constructor(picker: ShadePicker, title: string, choose: (shade: number) => void) {
        this.button = button('shade', '', title);
        this.button.append(this.swatch, this.name);
        this.button.addEventListener('click', () => picker.open(this.button, this.shade, choose));
    }

    show(shade: number | undefined) {
        this.shade = shade;
        paintSwatch(this.swatch, shade);
        this.name.textContent = shade === undefined ? 'mixed' : shadeName(shade);
    }
}

// ---- numbers ----

interface NumberActions {
    set(value: number): void;      // a whole number typed in, for every item
    step(delta: number): void;     // each item up or down from its own value
    steps(): number;               // the size of a step
}

// A whole number to type, committed by Enter or by leaving the field; Esc puts it back. Up
// and down step it, as do - and + when it has them; with Shift, by BIG_STEPS steps.
class NumberField {
    readonly input = element('input', 'number');
    readonly buttons: HTMLButtonElement[] = [];
    private shown = '';
    private dirty = false;

    constructor(
        private readonly editor: Editor,
        private readonly actions: NumberActions,
        title: string,
        stepButtons: boolean,
    ) {
        const { input } = this;
        input.type = 'text';
        input.inputMode = 'numeric';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.title = title;
        input.addEventListener('input', () => {
            this.dirty = true;
        });
        input.addEventListener('blur', () => {
            if (this.dirty) {
                this.commit();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.commit();
                input.blur();
            } else if (e.key === 'Escape') {
                this.revert();
                input.blur();
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                this.step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
            } else {
                return;
            }
            e.preventDefault();
        });
        if (stepButtons) {
            for (const [text, sign] of [['-', -1], ['+', 1]] as const) {
                const b = button('step', text, `${sign < 0 ? 'Down' : 'Up'} a step (Shift: `
                    + `${BIG_STEPS} steps)`);
                b.addEventListener('click', (e) => this.step(sign, e.shiftKey));
                this.buttons.push(b);
            }
        }
    }

    // The value to show, or undefined for 'mixed'; and whether it can be changed.
    show(value: number | undefined, editable: boolean) {
        this.shown = value === undefined ? '' : String(value);
        this.input.placeholder = value === undefined ? 'mixed' : '';
        this.input.readOnly = !editable;
        for (const b of this.buttons) {
            b.disabled = !editable;
        }
        if (!this.dirty) {
            this.input.value = this.shown;
        }
    }

    private step(sign: number, big: boolean) {
        if (this.input.readOnly || (this.dirty && !this.commit())) {
            return;
        }
        this.actions.step(sign * this.actions.steps() * (big ? BIG_STEPS : 1));
    }

    // Set what's typed, if it's a change; false if it was refused.
    private commit(): boolean {
        const text = this.input.value.trim();
        this.dirty = false;
        if (text === '' || text === this.shown) {
            this.revert();
            return true;
        }
        const value = /^-?[0-9]+$/.test(text) ? Number(text) : NaN;
        if (!Number.isSafeInteger(value)) {
            this.editor.tell(`refused: '${text}' isn't a whole number`);
            this.revert();
            return false;
        }
        const before = this.editor.doc;
        this.actions.set(value);
        if (this.editor.doc === before) {
            this.revert();
            return false;
        }
        return true;
    }

    private revert() {
        this.dirty = false;
        this.input.value = this.shown;
    }
}

// ---- the panel ----

// A section: a heading, and rows of a label and its controls.
class Section {
    readonly root = element('section');
    private readonly heading = element('h2');

    constructor() {
        this.root.append(this.heading);
    }

    row(label: string, ...controls: HTMLElement[]): HTMLElement {
        const row = element('div', 'row');
        const box = element('div', 'controls');
        box.append(...controls);
        row.append(element('label', '', label), box);
        this.root.append(row);
        return row;
    }

    show(visible: boolean, heading = '') {
        this.root.hidden = !visible;
        this.heading.textContent = heading;
    }
}

function describeFaces(faces: readonly Face[]): string {
    return faces.map((f) => `a ${f}`).join(' and ');
}

export class PropertiesPanel {
    private readonly picker = new ShadePicker();
    private readonly none = element('p', 'none', 'None selected');
    private readonly zones = new Section();
    private readonly edges = new Section();
    private readonly vertices = new Section();
    private readonly solid = element('input');
    private readonly zoneRows: HTMLElement[] = [];
    private readonly floor: NumberField;
    private readonly ceiling: NumberField;
    private readonly floorShade: ShadeButton;
    private readonly ceilingShade: ShadeButton;
    private readonly edgeShade: ShadeButton;
    private readonly draws = element('span', 'value');
    private readonly x: NumberField;
    private readonly y: NumberField;

    constructor(root: HTMLElement, private readonly editor: Editor) {
        const { picker } = this;

        this.solid.type = 'checkbox';
        this.solid.title = 'Solid: nothing inside, walled all round (its heights and shades are '
            + 'kept)';
        this.solid.addEventListener('change', () => {
            const solid = this.solid.checked;
            this.solid.blur();
            this.restyle(this.selectedZones(), (s) => ({ ...s, solid }));
        });
        this.floor = this.heightField('floor', 'Floor height');
        this.ceiling = this.heightField('ceiling', 'Ceiling height');
        this.floorShade = new ShadeButton(picker, 'Floor shade', (floorShade) =>
            this.restyle(this.openZones(), (s) => ({ ...s, floorShade })));
        this.ceilingShade = new ShadeButton(picker, 'Ceiling shade', (ceilingShade) =>
            this.restyle(this.openZones(), (s) => ({ ...s, ceilingShade })));
        this.zones.row('Solid', this.solid);
        this.zoneRows.push(
            this.zones.row('Floor', this.floor.input, ...this.floor.buttons,
                this.floorShade.button),
            this.zones.row('Ceiling', this.ceiling.input, ...this.ceiling.buttons,
                this.ceilingShade.button),
        );

        this.edgeShade = new ShadeButton(picker, 'Edge shade: its walls, risers and lintels',
            (shade) => this.apply(() =>
                restyleEdges(this.editor.doc, this.selectedEdges(), shade)));
        this.edges.row('Shade', this.edgeShade.button);
        this.edges.row('Draws', this.draws);

        this.x = this.coordinateField('x', 'x: up the page');
        this.y = this.coordinateField('y', 'y: to the right');
        this.vertices.row('x', this.x.input);
        this.vertices.row('y', this.y.input);

        root.append(this.none, this.zones.root, this.edges.root, this.vertices.root);
        editor.onChange(() => this.refresh());
        this.refresh();
    }

    private refresh() {
        const { doc, selection } = this.editor;
        const { map } = doc;
        this.none.hidden = selection.size > 0;

        // zones: the heights and shades of the open ones; a solid one keeps its own, unseen
        const zones = selectedZones(doc, selection);
        const open = zones.filter((z) => !map.zones[z]!.solid);
        this.zones.show(zones.length > 0,
            zones.length === 1 ? `Zone ${zones[0]}` : plural(zones.length, 'zone', 'zones'));
        this.solid.checked = zones.length > 0 && open.length === 0;
        this.solid.indeterminate = open.length > 0 && open.length < zones.length;
        for (const row of this.zoneRows) {
            row.hidden = open.length === 0;
        }
        const openZones = open.map((z) => map.zones[z]!);
        this.floor.show(common(openZones.map((z) => z.floor)), true);
        this.ceiling.show(common(openZones.map((z) => z.ceiling)), true);
        this.floorShade.show(common(openZones.map((z) => z.floorShade)));
        this.ceilingShade.show(common(openZones.map((z) => z.ceilingShade)));

        // edges, and what they draw
        const edges = selectedEdges(doc, selection);
        this.edges.show(edges.length > 0,
            edges.length === 1 ? `Edge ${edges[0]}` : plural(edges.length, 'edge', 'edges'));
        this.edgeShade.show(common(edges.map((e) => map.edges[e]!.shade)));
        this.draws.textContent = edges.length ? this.describeEdges(doc, edges) : '';

        // vertices: their position, which one alone can be given
        const vertices = [...selection].sort((a, b) => a - b);
        const one = vertices.length === 1;
        this.vertices.show(vertices.length > 0,
            one ? `Vertex ${vertices[0]}` : plural(vertices.length, 'vertex', 'vertices'));
        this.x.show(common(vertices.map((v) => map.vertices[v]!.x)), one);
        this.y.show(common(vertices.map((v) => map.vertices[v]!.y)), one);
    }

    private describeEdges(doc: Doc, edges: readonly number[]): string {
        const sides = edgeZones(doc.map, doc.regions);
        const facesOf = (e: number) => facesBetween(doc.map, ...sides[e]!);
        if (edges.length === 1) {
            const e = edges[0]!;
            const faces = facesOf(e);
            if (faces.length) {
                return describeFaces(faces);
            }
            const [right, left] = sides[e]!;
            if (doc.construction.includes(e)) {
                return 'nothing: a construction line';
            }
            return right >= 0 && left >= 0 && !doc.map.zones[right]!.solid
                && !doc.map.zones[left]!.solid
                ? 'nothing: the heights match' : 'nothing: no open zone beside it';
        }
        const count = { wall: 0, riser: 0, lintel: 0, nothing: 0 };
        for (const e of edges) {
            const faces = facesOf(e);
            for (const f of faces) {
                count[f]++;
            }
            count.nothing += Number(faces.length === 0);
        }
        const parts = [
            count.wall && plural(count.wall, 'wall', 'walls'),
            count.riser && plural(count.riser, 'riser', 'risers'),
            count.lintel && plural(count.lintel, 'lintel', 'lintels'),
            count.nothing && `${count.nothing} nothing`,
        ];
        return parts.filter((p) => p).join(', ');
    }

    // ---- changes ----

    private selectedZones(): number[] {
        return selectedZones(this.editor.doc, this.editor.selection);
    }

    private openZones(): number[] {
        const { zones } = this.editor.doc.map;
        return this.selectedZones().filter((z) => !zones[z]!.solid);
    }

    private selectedEdges(): number[] {
        return selectedEdges(this.editor.doc, this.editor.selection);
    }

    // Commit a change to the properties, keeping the selection, or report why it can't be.
    private apply(make: () => Doc, merge?: string) {
        const { editor } = this;
        let doc: Doc;
        try {
            doc = make();
        } catch (error) {
            if (!(error instanceof RangeError)) {
                throw error;
            }
            editor.tell(`refused: ${error.message}`);
            return;
        }
        editor.message = '';
        editor.commit(doc, editor.selection, merge);
    }

    private restyle(zones: number[], change: (s: ZoneStyle) => ZoneStyle, merge?: string) {
        if (zones.length) {
            this.apply(() => restyleZones(this.editor.doc, zones, change), merge);
        }
    }

    private heightField(which: 'floor' | 'ceiling', title: string): NumberField {
        const to = (s: ZoneStyle, height: Height): ZoneStyle =>
            (which === 'floor' ? { ...s, floor: height } : { ...s, ceiling: height });
        return new NumberField(this.editor, {
            set: (value) => {
                if (!isHeight(value)) {
                    this.editor.tell(`refused: heights are multiples of ${HEIGHT_STEP}`);
                    return;
                }
                this.restyle(this.openZones(), (s) => to(s, value));
            },
            step: (delta) => this.restyle(this.openZones(),
                (s) => to(s, toHeight(s[which] + delta)), `step ${which}`),
            steps: () => HEIGHT_STEP,
        }, `${title}: whole units, up-positive, in steps of ${HEIGHT_STEP}`, true);
    }

    private coordinateField(axis: 'x' | 'y', title: string): NumberField {
        const move = (to: (now: number) => number, merge?: string) => {
            const { editor } = this;
            const { doc, selection } = editor;
            const [v] = selection;
            if (selection.size !== 1 || v === undefined) {
                return;
            }
            const now = doc.map.vertices[v]![axis];
            const target = to(now);
            if (!isCoord(target)) {
                editor.tell(`refused: coordinates are whole numbers in 0..${COORD_MAX}`);
                return;
            }
            const delta = target - now;
            if (delta === 0) {
                return;
            }
            try {
                const result = moveVertices(doc, selection, axis === 'x' ? delta : 0,
                    axis === 'y' ? delta : 0, editor.defaults);
                editor.message = '';
                editor.commit(result.doc, mapSelection(selection, result.vertexMap), merge);
            } catch (error) {
                if (!(error instanceof RangeError)) {
                    throw error;
                }
                editor.tell(`refused: ${error.message}`);
            }
        };
        return new NumberField(this.editor, {
            set: (value) => move(() => value),
            step: (delta) => move((now) => now + delta, `step ${axis}`),
            steps: () => this.editor.grid || 1,
        }, `${title}, whole units in 0..${COORD_MAX}`, false);
    }
}
