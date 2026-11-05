// main.ts - the page: the toolbar, the plan and 3D views, the properties panel and the status
// line; and opening, saving and exporting maps. It starts with the demo map. Opening a Doom
// WAD imports the level chosen from it.

import demoText from '../maps/demo.pmap?raw';
import { Editor } from './editor/editor';
import { PropertiesPanel } from './editor/panel';
import { PlanView } from './editor/plan';
import { View3D } from './editor/view3d';
import { chooseLevel } from './editor/levels';
import { importLevel } from './doom/level';
import { levelNames, levelSize, readWad } from './doom/wad';
import { docFromMap, type Doc } from './map/edit';
import { exportMap } from './map/export';
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
    geometry: element<HTMLButtonElement>('geometry'),
    select: element<HTMLButtonElement>('select'),
    player: element<HTMLButtonElement>('player'),
    grid: element<HTMLButtonElement>('grid'),
    cells: element<HTMLButtonElement>('cells'),
    dither: element<HTMLButtonElement>('dither'),
    undo: element<HTMLButtonElement>('undo'),
    redo: element<HTMLButtonElement>('redo'),
    fit: element<HTMLButtonElement>('fit'),
    new: element<HTMLButtonElement>('new'),
    open: element<HTMLButtonElement>('open'),
    save: element<HTMLButtonElement>('save'),
    export: element<HTMLButtonElement>('export'),
};
const fileLabel = element<HTMLElement>('file');
const help = element<HTMLElement>('help');
const HELP = help.textContent;
const PLAYER_HELP = ['click: put the start', 'drag: put it and aim it', 'arrows: nudge it',
    'wheel: zoom', 'right-drag: pan', '3D: drag to turn'].join('  |  ');
const picker = element<HTMLInputElement>('picker');

function refresh() {
    buttons.geometry.classList.toggle('on', editor.mode === 'geometry');
    buttons.select.classList.toggle('on', editor.mode === 'select');
    buttons.player.classList.toggle('on', editor.mode === 'player');
    buttons.grid.classList.toggle('on', editor.gridOn);
    buttons.grid.textContent = `Grid ${editor.gridSize}`;
    help.textContent = editor.mode === 'player' ? PLAYER_HELP : HELP;
    buttons.cells.classList.toggle('on', editor.showCells);
    buttons.dither.classList.toggle('on', editor.dither);
    buttons.undo.disabled = !editor.canUndo;
    buttons.redo.disabled = !editor.canRedo;
    fileLabel.textContent = editor.fileName + (editor.modified ? ' (modified)' : '');
    document.title = `${editor.modified ? '* ' : ''}${editor.fileName} - Portal Editor`;
}
editor.onChange(refresh);

buttons.geometry.onclick = () => editor.setMode('geometry');
buttons.select.onclick = () => editor.setMode('select');
buttons.player.onclick = () => editor.setMode('player');
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

// A level from a Doom WAD, as a map named after it: the one level, or the one chosen.
async function importWad(file: File) {
    try {
        const wad = readWad(new Uint8Array(await file.arrayBuffer()));
        const names = levelNames(wad);
        if (!names.length) {
            throw new Error(`it has no levels`);
        }
        const level = names.length === 1 ? names[0]
            : await chooseLevel(`Import a level from ${file.name}`,
                names.map((name) => ({ name, ...levelSize(wad, name) })));
        if (!level) {
            return;
        }
        const { doc, notes } = importLevel(wad, level);
        editor.load(doc, `${level.toLowerCase()}.pmap`);
        plan.fit();
        for (const note of notes) {
            console.info(`${level}: ${note}`);
        }
        const { map } = doc;
        editor.tell(`imported ${level} from ${file.name}: ${map.vertices.length} vertices, `
            + `${map.edges.length} edges, ${map.zones.length} zones (the console has the notes)`);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        window.alert(`${file.name} doesn't import: ${reason}`);
    }
}

picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) {
        return;
    }
    if (/\.wad$/i.test(file.name)) {
        await importWad(file);
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

// Hand the browser a file to save.
function download(name: string, data: BlobPart, type: string) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([data], { type }));
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function save() {
    download(editor.fileName, writeMap(editor.doc.map), 'text/plain');
    editor.modified = false;
    editor.changed();
}

// The map as the engine loads it (docs/export.md), or why it can't be.
function exportBinary() {
    const result = exportMap(editor.doc);
    if (!result.ok) {
        const shown = result.errors.slice(0, 12).join('\n');
        const more = result.errors.length > 12 ? '\n...' : '';
        window.alert(`${editor.fileName} doesn't export:\n\n${shown}${more}`);
        return;
    }
    const name = editor.fileName.replace(/\.pmap$/i, '') + '.bin';
    download(name, result.bytes, 'application/octet-stream');
    const { vertices, cells, edges, sides } = result.engine;
    editor.tell(`exported ${name}: ${vertices.length} vertices, ${cells.length - 1} cells, `
        + `${edges.length} edges, ${sides.length} sides, ${result.bytes.length} bytes`);
}

buttons.new.onclick = newMap;
buttons.open.onclick = open;
buttons.save.onclick = save;
buttons.export.onclick = exportBinary;
window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === 's') {
            e.preventDefault();
            save();
        } else if (key === 'o') {
            e.preventDefault();
            open();
        } else if (key === 'e') {
            e.preventDefault();
            exportBinary();
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
