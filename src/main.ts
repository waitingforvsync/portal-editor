// main.ts - the page: the toolbar, the plan and 3D views, the properties panel and the status
// line, and opening and saving maps. It starts with the demo map.

import demoText from '../maps/demo.pmap?raw';
import { Editor } from './editor/editor';
import { PropertiesPanel } from './editor/panel';
import { PlanView } from './editor/plan';
import { View3D } from './editor/view3d';
import { docFromMap, type Doc } from './map/edit';
import { parseMap, writeMap } from './map/format';
import { toCoord } from './map/units';

function element<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}

function emptyDoc(): Doc {
    return docFromMap({
        start: { x: toCoord(1024), y: toCoord(1024), angle: 0 },
        vertices: [],
        edges: [],
        zones: [],
    }, []);
}

// A map from text, or the reasons it isn't one.
function docFromText(text: string): Doc | string[] {
    const parsed = parseMap(text);
    return parsed.ok ? docFromMap(parsed.map, parsed.zoneRegions) : parsed.errors;
}

const demo = docFromText(demoText);
const editor = new Editor(Array.isArray(demo) ? emptyDoc() : demo);
editor.fileName = 'demo.pmap';

const status = element<HTMLElement>('status');
const plan = new PlanView(element<HTMLCanvasElement>('plan'), editor, (text) => {
    status.textContent = text;
});
const panel = new PropertiesPanel(element<HTMLElement>('panel'), editor);

// the 3D view, or why there isn't one
let view3d: View3D | undefined;
try {
    view3d = new View3D(element<HTMLCanvasElement>('view3d'), editor, plan);
} catch (error) {
    const note = document.createElement('div');
    note.className = 'unavailable';
    note.textContent = `No 3D view: ${error instanceof Error ? error.message : String(error)}`;
    element<HTMLElement>('view3dbox').append(note);
}

// the divider shares the width between the plan and the 3D view
const divider = element<HTMLElement>('divider');
const planBox = element<HTMLElement>('planbox');
const view3dBox = element<HTMLElement>('view3dbox');
divider.addEventListener('pointerdown', (e) => {
    divider.setPointerCapture(e.pointerId);
    const left = planBox.getBoundingClientRect().left;
    const both = planBox.offsetWidth + view3dBox.offsetWidth;
    const move = (m: PointerEvent) => {
        const share = Math.min(0.85, Math.max(0.15, (m.clientX - left) / both));
        planBox.style.flexGrow = String(share);
        view3dBox.style.flexGrow = String(1 - share);
    };
    const end = () => {
        divider.removeEventListener('pointermove', move);
        divider.removeEventListener('pointerup', end);
    };
    divider.addEventListener('pointermove', move);
    divider.addEventListener('pointerup', end);
});

// ---- toolbar ----

const buttons = {
    place: element<HTMLButtonElement>('place'),
    select: element<HTMLButtonElement>('select'),
    grid: element<HTMLButtonElement>('grid'),
    cells: element<HTMLButtonElement>('cells'),
    dither: element<HTMLButtonElement>('dither'),
    undo: element<HTMLButtonElement>('undo'),
    redo: element<HTMLButtonElement>('redo'),
    fit: element<HTMLButtonElement>('fit'),
    new: element<HTMLButtonElement>('new'),
    open: element<HTMLButtonElement>('open'),
    save: element<HTMLButtonElement>('save'),
};
const fileLabel = element<HTMLElement>('file');
const picker = element<HTMLInputElement>('picker');

function refresh() {
    buttons.place.classList.toggle('on', editor.mode === 'place');
    buttons.select.classList.toggle('on', editor.mode === 'select');
    buttons.grid.classList.toggle('on', editor.gridOn);
    buttons.grid.innerHTML = `Grid ${editor.gridSize}<kbd>G</kbd>`;
    buttons.cells.classList.toggle('on', editor.showCells);
    buttons.dither.classList.toggle('on', editor.dither);
    buttons.undo.disabled = !editor.canUndo;
    buttons.redo.disabled = !editor.canRedo;
    fileLabel.textContent = editor.fileName + (editor.modified ? ' (modified)' : '');
    document.title = `${editor.modified ? '* ' : ''}${editor.fileName} - Portal Editor`;
}
editor.onChange(refresh);

buttons.place.onclick = () => editor.setMode('place');
buttons.select.onclick = () => editor.setMode('select');
buttons.grid.onclick = () => editor.setGrid(!editor.gridOn);
buttons.cells.onclick = () => editor.setShowCells(!editor.showCells);
buttons.dither.onclick = () => editor.setDither(!editor.dither);
buttons.undo.onclick = () => editor.undo();
buttons.redo.onclick = () => editor.redo();
buttons.fit.onclick = () => plan.fit();
for (const b of Object.values(buttons)) {
    // keep the keyboard on the page, so Space or Enter doesn't press the last button again
    b.addEventListener('mouseup', () => b.blur());
}

// ---- files ----

function confirmDiscard(): boolean {
    return !editor.modified || window.confirm(`Discard the changes to ${editor.fileName}?`);
}

function newMap() {
    if (confirmDiscard()) {
        editor.load(emptyDoc(), 'untitled.pmap');
        plan.fit();
    }
}

function open() {
    if (confirmDiscard()) {
        picker.value = '';
        picker.click();
    }
}

picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) {
        return;
    }
    const doc = docFromText(await file.text());
    if (Array.isArray(doc)) {
        const shown = doc.slice(0, 12).join('\n');
        window.alert(`${file.name} doesn't load:\n\n${shown}${doc.length > 12 ? '\n...' : ''}`);
        return;
    }
    editor.load(doc, file.name);
    plan.fit();
};

function save() {
    const blob = new Blob([writeMap(editor.doc.map)], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = editor.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    editor.modified = false;
    editor.changed();
}

buttons.new.onclick = newMap;
buttons.open.onclick = open;
buttons.save.onclick = save;
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 's') {
            e.preventDefault();
            save();
        } else if (key === 'o') {
            e.preventDefault();
            open();
        }
    }
});
window.addEventListener('beforeunload', (e) => {
    if (editor.modified) {
        e.preventDefault();
    }
});

if (Array.isArray(demo)) {
    status.textContent = `demo.pmap doesn't load: ${demo.join('; ')}`;
}

// for poking at from the browser's console, and for scripted checks
declare global {
    interface Window {
        portal: { editor: Editor; plan: PlanView; panel: PropertiesPanel; view3d?: View3D };
    }
}
window.portal = { editor, plan, panel, view3d };
refresh();
requestAnimationFrame(() => plan.fit());
