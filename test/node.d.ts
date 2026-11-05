// node.d.ts - the little of Node's API the tests use, without all of Node's types.

declare module 'node:fs' {
    export function existsSync(path: string | URL): boolean;
    export function readFileSync(path: string | URL): Uint8Array;
}
