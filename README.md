# portal-editor

A browser map editor for [portalc](https://github.com/waitingforvsync/portalc), the BBC
Micro portal engine. Maps are made of vertices and edges; the regions the edges enclose are
zones, with floor and ceiling heights and shades.

So far: the map text format (reading, checking and writing); a plan view for placing
vertices, drawing edges, and selecting, moving and deleting them, with the zones worked out
as you go; and a properties panel for the selected zones, edges and vertices. It opens on the
demo map.

## Running

Needs Node 22.12 or later.

```
npm install
npm run dev      # serve the editor at http://localhost:5173
npm test         # run the tests
npm run check    # type-check
npm run build    # type-check, then build into dist/
```

### In VS Code

`.vscode/` holds the project's tasks, launch configuration and settings.

| Action | How |
|--------|-----|
| Run the editor, with breakpoints in the TS | F5 ("Editor in Chrome": starts the dev server, opens Chrome) |
| Type-check, errors to the Problems panel | Ctrl+Shift+B |
| Run the tests | Testing panel (with the recommended Vitest extension), or the `test` task |
| Install, build, serve | Terminal > Run Task: `install`, `build`, `dev` |

The dev server always uses port 5173, and stops rather than move if it's taken.

## Using the editor

The plan view shows the map from above, x up the screen and y to the right, zones in their
floor shades and solid zones hatched. It has two modes.

### Placement mode (P)

| Action | Does |
|--------|------|
| Click in space | Adds a vertex, selected |
| Click on an edge | Splits the edge with a new vertex, selected |
| Click on a vertex | Selects it |
| Drag | Draws an edge from where the drag starts to where it ends |

A drawn edge starts and ends on a vertex, or on an edge (splitting it), or at a new vertex.
Where it crosses edges, they all split there. Closing an outline makes a zone. The line and
the vertices along it end up selected.

### Selection mode (S)

| Action | Does |
|--------|------|
| Click a vertex, edge or zone | Selects it, in place of the selection |
| Click in space | Clears the selection |
| Drag something | Moves the selection, selecting what's dragged first if it isn't |
| Drag from space | Selects what lies inside the box |

Holding Shift selects in either mode, adding to the selection rather than replacing it;
Shift+click in space still clears it.

The selection is a set of vertices. An edge is selected when both its ends are, and a zone
when every vertex of its outline is (the vertices of its holes don't count), so selecting a
zone doesn't select what's inside it.

### Everywhere

| Key or action | Does |
|---------------|------|
| Delete | Deletes the selected edges, leaving their ends selected; with no edges selected, deletes the selected vertices and their edges |
| Arrows | Nudge the selection a grid step |
| Esc | Cancels a drag under way, else clears the selection |
| Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y | Undo, redo |
| G, [ and ] | Grid snapping on or off; grid size down and up |
| F | Shows the whole map |
| Wheel | Zooms about the pointer |
| Right or middle drag | Pans |
| Ctrl+O, Ctrl+S | Opens a map; saves it (as a download) |

### Properties panel

The panel on the right shows what's selected: its zones, its edges and its vertices, each in
a section of its own, or "None selected".

| Section | Shows |
|---------|-------|
| Zones | Solid; the floor and ceiling heights, each with its shade |
| Edges | The shade, and what the edges draw: walls, risers or lintels |
| Vertices | x and y |

A field shows the value everything selected shares, or "mixed". Setting it sets it on all of
them; - and + (or Up and Down in the field) step each from its own value, 8 units a step, or
64 with Shift. Typing a value commits it on Enter or on leaving the field, and Esc puts it
back. A change that would put a floor at or above its ceiling is refused, with the reason in
the status line. A shade opens a grid of all 35, drawn as the engine dithers them.

A solid zone's heights and shades are hidden, not lost: clearing Solid brings them back, and
the file keeps them. With open and solid zones selected together, the fields change only the
open ones.

An edge draws a wall where it has an open zone on one side only; between two open zones, a
riser where the floors differ and a lintel where the ceilings do; otherwise nothing.

A vertex's x and y can be changed when it's the only one selected, which moves it as a drag
would: onto another vertex it merges, across edges it splits them. Up and Down step it a grid
step.

Each change is a step to undo; a run of steps of one field (with - and +, or Up and Down)
undoes as one.

### Snapping and edits

A new vertex, the end of a drawn edge, or a moved selection's grabbed vertex snaps to the
nearest vertex within reach, else the nearest edge within reach, else the grid (or whole
units with the grid off). On an edge it snaps to a grid point where one lies exactly on the
edge. While drawing or moving, the view shows what letting go would make: snapped, with
vertices merged where they meet and edges split where they cross. A crossing rounds to whole
units, which can put a small kink in the edges it splits.

After every edit the zones are worked out again from the edges. A zone keeps its properties
through the edit by its edges: a region takes the properties of the zone that lay along its
edges before. A zone moved whole wins over one that didn't move, and among several, the
largest wins. So a zone split in two gives both halves its properties; deleting the edge
between two zones keeps the larger one's; a zone dragged onto another takes the overlap. A
region drawn inside a zone takes that zone's properties, and one drawn in empty space gets
the defaults (floor 0, ceiling 160, floor `KRRR`, ceiling `KKKB`; new edges `BBRR`).

## Layout

| Path | What |
|------|------|
| `docs/format.md` | The map text format |
| `maps/demo.pmap` | portalc's demo scene |
| `src/main.ts` | The page: toolbar, plan view, properties panel, status line, opening and saving |
| `src/map/units.ts` | Coordinate and height types, and their checks |
| `src/map/map.ts` | The map: vertices, edges, zones, start |
| `src/map/shades.ts` | The engine's 35-shade catalogue |
| `src/map/geometry.ts` | Exact predicates on whole-unit points |
| `src/map/regions.ts` | The regions the edges enclose, with their holes |
| `src/map/check.ts` | What makes a map well formed |
| `src/map/format.ts` | Reading and writing the text format |
| `src/map/planarize.ts` | Making edges planar again after an edit |
| `src/map/zones.ts` | Rebuilding the zones after an edit, keeping their properties |
| `src/map/edit.ts` | The editing operations |
| `src/map/faces.ts` | What an edge draws: wall, riser or lintel |
| `src/editor/view.ts` | The plan view's pan and zoom |
| `src/editor/hit.ts` | What's under the pointer, and snapping |
| `src/editor/selection.ts` | Edges and zones selected through their vertices |
| `src/editor/editor.ts` | The editor's state, with undo and redo |
| `src/editor/plan.ts` | The plan view: drawing, and pointer and key handling |
| `src/editor/panel.ts` | The properties panel |
| `test/` | Tests, one file per module |

In the browser's console, `portal.editor`, `portal.plan` and `portal.panel` are the editor's
state, the plan view and the properties panel.
