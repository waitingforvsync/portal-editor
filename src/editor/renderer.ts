// renderer.ts - draws a scene (scene.ts) with WebGL2. Surfaces show only their front, in their
// shades: dithered as the engine draws them, each 4x2 tile laid on the screen's own pixels,
// or in the tiles' average colours. Outlines run along the surfaces' edges where the surface
// faces the eye, and fainter round walls, risers and lintels seen from behind, as wireframe;
// overlay lines (markers) go on top.

import { HARDWARE_RGB, NUM_SHADES, shadeTile } from '../map/shades';
import type { Camera, Vec3 } from './camera';
import type { Scene } from './scene';

// What a surface, or an overlay line, is drawn as.
export const SELECTED = 1;
export const HOVER = 2;
export const MARKER = 4;    // overlay lines only: the start

const BACKGROUND = [0.105, 0.122, 0.149];
const BEHIND_ALPHA = '0.6';    // a surface seen from behind: its outline's opacity, scaled

const SURFACE_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in float shade;
layout(location = 2) in float flags;
uniform mat4 matrix;
flat out int vShade;
flat out int vFlags;
void main() {
    gl_Position = matrix * vec4(position, 1.0);
    vShade = int(shade);
    vFlags = int(flags);
}`;

const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D tiles;
uniform vec2 pixel;      // a Beeb pixel, in device pixels
uniform float top;       // the canvas's height, in device pixels
uniform bool dither;
flat in int vShade;
flat in int vFlags;
out vec4 colour;
vec3 tile(int x, int y) {
    return texelFetch(tiles, ivec2(x, vShade * 2 + y), 0).rgb;
}
void main() {
    vec3 c;
    if (dither) {
        ivec2 p = ivec2(gl_FragCoord.x / pixel.x, (top - gl_FragCoord.y) / pixel.y);
        c = tile(p.x & 3, p.y & 1);
    } else {
        c = vec3(0.0);
        for (int y = 0; y < 2; y++) {
            for (int x = 0; x < 4; x++) {
                c += tile(x, y);
            }
        }
        c /= 8.0;
    }
    if ((vFlags & ${SELECTED}) != 0) {
        c = mix(c, vec3(1.0, 0.706, 0.235), 0.45);
    } else if ((vFlags & ${HOVER}) != 0) {
        c = mix(c, vec3(1.0), 0.15);
    }
    colour = vec4(c, 1.0);
}`;

// A line goes where its surface faces the eye, and round an upright surface (a wall, riser or
// lintel) seen from behind; a line with no normal goes everywhere.
const LINE_VERTEX = `#version 300 es
layout(location = 0) in vec3 position;
layout(location = 1) in vec3 normal;
layout(location = 2) in float flags;
uniform mat4 matrix;
uniform vec3 eye;
flat out int vFlags;
flat out int vBehind;
void main() {
    vFlags = int(flags);
    bool facing = dot(normal, normal) == 0.0 || dot(normal, eye - position) > 0.0;
    vBehind = facing ? 0 : 1;
    gl_Position = facing || normal.z == 0.0 ? matrix * vec4(position, 1.0)
        : vec4(0.0, 0.0, 2.0, 1.0);
}`;

const LINE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform bool flaggedOnly;
flat in int vFlags;
flat in int vBehind;
out vec4 colour;
void main() {
    if ((vFlags & ${MARKER}) != 0) {
        colour = vec4(1.0, 0.416, 0.541, 1.0);
    } else if ((vFlags & ${HOVER}) != 0) {
        colour = vec4(1.0, 1.0, 1.0, 0.95);
    } else if ((vFlags & ${SELECTED}) != 0) {
        colour = vec4(1.0, 0.706, 0.235, 1.0);
    } else if (flaggedOnly) {
        discard;
    } else {
        colour = vec4(0.85, 0.87, 0.9, 0.3);
    }
    if (vBehind != 0) {
        colour.a *= ${BEHIND_ALPHA};
    }
}`;

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string): WebGLProgram {
    const program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type as number)!;
        gl.shaderSource(shader, source as string);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error(`a shader doesn't compile: ${gl.getShaderInfoLog(shader)}`);
        }
        gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`the shaders don't link: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
}

// Geometry in a vertex array: a fixed buffer of floats, laid out as the sizes say, and a
// buffer of one flag byte a vertex that changes as the selection does.
class Mesh {
    readonly vao: WebGLVertexArrayObject;
    private readonly data: WebGLBuffer;
    private readonly flagData: WebGLBuffer;
    count = 0;

    constructor(private readonly gl: WebGL2RenderingContext, sizes: readonly number[]) {
        this.vao = gl.createVertexArray();
        this.data = gl.createBuffer();
        this.flagData = gl.createBuffer();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.data);
        const stride = sizes.reduce((sum, n) => sum + n, 0) * 4;
        let offset = 0;
        sizes.forEach((n, location) => {
            gl.enableVertexAttribArray(location);
            gl.vertexAttribPointer(location, n, gl.FLOAT, false, stride, offset);
            offset += n * 4;
        });
        gl.bindBuffer(gl.ARRAY_BUFFER, this.flagData);
        gl.enableVertexAttribArray(sizes.length);
        gl.vertexAttribPointer(sizes.length, 1, gl.UNSIGNED_BYTE, false, 0, 0);
        gl.bindVertexArray(null);
    }

    set(data: Float32Array, flags: Uint8Array) {
        const { gl } = this;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.data);
        gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
        this.setFlags(flags);
        this.count = flags.length;
    }

    setFlags(flags: Uint8Array) {
        const { gl } = this;
        gl.bindBuffer(gl.ARRAY_BUFFER, this.flagData);
        gl.bufferData(gl.ARRAY_BUFFER, flags, gl.DYNAMIC_DRAW);
    }
}

export interface DrawOptions {
    near: number;
    far: number;
    dither: boolean;
    ratio: number;      // device pixels to a CSS pixel
}

export class Renderer {
    private readonly gl: WebGL2RenderingContext;
    private readonly surfaceProgram: WebGLProgram;
    private readonly lineProgram: WebGLProgram;
    private readonly surfaces: Mesh;
    private readonly outlines: Mesh;
    private readonly overlay: Mesh;
    private surfaceOf = new Uint32Array(0);    // each surface vertex's surface
    private outlineOf = new Uint32Array(0);    // each outline vertex's surface

    // Throws if the browser has no WebGL2.
    constructor(private readonly canvas: HTMLCanvasElement) {
        const gl = canvas.getContext('webgl2', { antialias: true });
        if (!gl) {
            throw new Error('this browser has no WebGL2');
        }
        this.gl = gl;
        this.surfaceProgram = compile(gl, SURFACE_VERTEX, SURFACE_FRAGMENT);
        this.lineProgram = compile(gl, LINE_VERTEX, LINE_FRAGMENT);
        this.surfaces = new Mesh(gl, [3, 1]);
        this.outlines = new Mesh(gl, [3, 3]);
        this.overlay = new Mesh(gl, [3, 3]);

        // the shades' tiles: 4 pixels across, two rows a shade
        const texels = new Uint8Array(4 * 2 * NUM_SHADES * 4);
        for (let shade = 0; shade < NUM_SHADES; shade++) {
            shadeTile(shade).forEach((colour, i) => {
                texels.set([...HARDWARE_RGB[colour]!, 255], (shade * 8 + i) * 4);
            });
        }
        gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 4, 2 * NUM_SHADES, 0, gl.RGBA,
            gl.UNSIGNED_BYTE, texels);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }

    setScene(scene: Scene) {
        const triangles = scene.surfaces.reduce((n, s) => n + s.triangles.length, 0);
        const ends = scene.surfaces.reduce((n, s) => n + s.outline.length, 0);
        const surfaceData = new Float32Array(triangles * 4);
        const outlineData = new Float32Array(ends * 6);
        this.surfaceOf = new Uint32Array(triangles);
        this.outlineOf = new Uint32Array(ends);
        let t = 0;
        let o = 0;
        scene.surfaces.forEach((surface, i) => {
            for (const p of surface.triangles) {
                surfaceData.set([...p, surface.shade], t * 4);
                this.surfaceOf[t++] = i;
            }
            for (const p of surface.outline) {
                outlineData.set([...p, ...surface.normal], o * 6);
                this.outlineOf[o++] = i;
            }
        });
        this.surfaces.set(surfaceData, new Uint8Array(triangles));
        this.outlines.set(outlineData, new Uint8Array(ends));
    }

    // Each surface's flags: SELECTED, HOVER.
    setFlags(flags: Uint8Array) {
        this.surfaces.setFlags(Uint8Array.from(this.surfaceOf, (s) => flags[s]!));
        this.outlines.setFlags(Uint8Array.from(this.outlineOf, (s) => flags[s]!));
    }

    // Lines drawn over the scene, two ends each, with a flag (SELECTED, MARKER) a line.
    setOverlay(ends: readonly Vec3[], flags: readonly number[]) {
        const data = new Float32Array(ends.length * 6);
        ends.forEach((p, k) => data.set(p, k * 6));
        this.overlay.set(data, Uint8Array.from(ends, (_, k) => flags[k >> 1]!));
    }

    draw(camera: Camera, options: DrawOptions) {
        const { gl, canvas } = this;
        const matrix = camera.matrix(options.near, options.far);
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.clearColor(BACKGROUND[0]!, BACKGROUND[1]!, BACKGROUND[2]!, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // surfaces, front faces only, pushed back a little so their outlines show over them
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.depthMask(true);
        gl.enable(gl.CULL_FACE);
        gl.frontFace(gl.CW);    // see Camera.matrix
        gl.enable(gl.POLYGON_OFFSET_FILL);
        gl.polygonOffset(1, 1);
        gl.disable(gl.BLEND);
        gl.useProgram(this.surfaceProgram);
        const at = (name: string) => gl.getUniformLocation(this.surfaceProgram, name);
        gl.uniformMatrix4fv(at('matrix'), false, matrix);
        gl.uniform2f(at('pixel'), 4 * options.ratio, 2 * options.ratio);
        gl.uniform1f(at('top'), canvas.height);
        gl.uniform1i(at('dither'), options.dither ? 1 : 0);
        gl.uniform1i(at('tiles'), 0);
        gl.bindVertexArray(this.surfaces.vao);
        gl.drawArrays(gl.TRIANGLES, 0, this.surfaces.count);

        // outlines, then the flagged ones again so they win where outlines meet; then markers
        gl.disable(gl.POLYGON_OFFSET_FILL);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(this.lineProgram);
        const line = (name: string) => gl.getUniformLocation(this.lineProgram, name);
        gl.uniformMatrix4fv(line('matrix'), false, matrix);
        gl.uniform3fv(line('eye'), camera.eye);
        for (const [mesh, flaggedOnly] of [[this.outlines, 0], [this.outlines, 1],
            [this.overlay, 0]] as const) {
            gl.uniform1i(line('flaggedOnly'), flaggedOnly);
            gl.bindVertexArray(mesh.vao);
            gl.drawArrays(gl.LINES, 0, mesh.count);
        }
        gl.bindVertexArray(null);
    }
}
