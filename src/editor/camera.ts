// camera.ts - the 3D view's camera. It orbits a target point at a distance: turned by yaw about
// the vertical (0 looking up the page, along +x; a quarter turn looking right, along +y) and
// tilted by pitch (positive looking down, a quarter turn straight down, the plan's view). It
// projects in perspective. Points are (x, y, height), height up.

export type Vec3 = [number, number, number];

export const FIELD_OF_VIEW = Math.PI / 3;    // vertical
export const MAX_PITCH = Math.PI / 2;

export function dot(a: Vec3, b: Vec3): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function add(a: Vec3, b: Vec3, scale = 1): Vec3 {
    return [a[0] + b[0] * scale, a[1] + b[1] * scale, a[2] + b[2] * scale];
}

export function normalize(a: Vec3): Vec3 {
    const length = Math.hypot(...a);
    return [a[0] / length, a[1] / length, a[2] / length];
}

// The distance at which the target's surroundings take scale pixels a unit, in a view this
// many pixels high: so the 3D view zooms as the plan does.
export function distanceFor(height: number, scale: number): number {
    return height / (2 * scale * Math.tan(FIELD_OF_VIEW / 2));
}

export interface Ray {
    origin: Vec3;
    direction: Vec3;    // unit length
}

export class Camera {
    yaw = 0;
    pitch = 0.9;
    target: Vec3 = [0, 0, 0];
    distance = 1000;
    width = 1;          // the view, in CSS pixels
    height = 1;

    copy(): Camera {
        return Object.assign(new Camera(), this, { target: [...this.target] });
    }

    get forward(): Vec3 {
        const c = Math.cos(this.pitch);
        return [c * Math.cos(this.yaw), c * Math.sin(this.yaw), -Math.sin(this.pitch)];
    }

    get right(): Vec3 {
        return [-Math.sin(this.yaw), Math.cos(this.yaw), 0];
    }

    get up(): Vec3 {
        return cross(this.forward, this.right);
    }

    get eye(): Vec3 {
        return add(this.target, this.forward, -this.distance);
    }

    // The ray from the eye through a point of the view.
    ray(sx: number, sy: number): Ray {
        const t = Math.tan(FIELD_OF_VIEW / 2);
        const across = (2 * sx / this.width - 1) * t * (this.width / this.height);
        const upward = (1 - 2 * sy / this.height) * t;
        const direction = add(add(this.forward, this.right, across), this.up, upward);
        return { origin: this.eye, direction: normalize(direction) };
    }

    // The view and projection together, for WebGL, column by column. The world's (x, y,
    // height) turns the other way from the view's (right, up, back), so a face anticlockwise
    // about its normal shows clockwise on the screen.
    matrix(near: number, far: number): Float32Array {
        const eye = this.eye;
        const rows: Vec3[] = [this.right, this.up, add([0, 0, 0], this.forward, -1)];
        const view = rows.map((r) => [...r, -dot(r, eye)]);
        const f = 1 / Math.tan(FIELD_OF_VIEW / 2);
        const aspect = this.width / this.height;
        const depth = (far + near) / (near - far);
        const shift = (2 * far * near) / (near - far);
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            const [x, y, z] = view.map((r) => r[col]!) as [number, number, number];
            const w = col === 3 ? 1 : 0;
            out[col * 4] = (f / aspect) * x;
            out[col * 4 + 1] = f * y;
            out[col * 4 + 2] = depth * z + shift * w;
            out[col * 4 + 3] = -z;
        }
        return out;
    }

    // Where a ray meets the level plane at a height, if it does, ahead.
    static onLevel(ray: Ray, height: number): Vec3 | undefined {
        const dz = ray.direction[2];
        if (Math.abs(dz) < 1e-9) {
            return undefined;
        }
        const t = (height - ray.origin[2]) / dz;
        return t > 0 ? add(ray.origin, ray.direction, t) : undefined;
    }
}
