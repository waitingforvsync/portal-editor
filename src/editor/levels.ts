// levels.ts - the dialog that asks which of a WAD's levels to import: a button for each,
// grouped by episode, with its size. A click imports that level; Esc or Cancel imports none.
// Keys and the clipboard stay in the dialog while it's open, away from the plan.

export interface LevelChoice {
    name: string;        // E1M1 or MAP01
    linedefs: number;
    sectors: number;
}

function element<K extends keyof HTMLElementTagNameMap>(
    tag: K, className = '', text = '',
): HTMLElementTagNameMap[K] {
    const e = document.createElement(tag);
    e.className = className;
    e.textContent = text;
    return e;
}

// Levels grouped as Doom groups them: by episode, or Doom II's in tens.
function groups(levels: readonly LevelChoice[]): [string, LevelChoice[]][] {
    const out = new Map<string, LevelChoice[]>();
    for (const level of levels) {
        const episode = /^E(\d)M/.exec(level.name);
        const key = episode ? `Episode ${episode[1]}`
            : `Maps ${Math.floor((Number(level.name.slice(3)) - 1) / 10) * 10 + 1} on`;
        out.set(key, [...(out.get(key) ?? []), level]);
    }
    return [...out];
}

// Ask which level to import: its name, or undefined for none.
export function chooseLevel(
    title: string, levels: readonly LevelChoice[],
): Promise<string | undefined> {
    const dialog = element('dialog', 'level-picker');
    dialog.append(element('h2', '', title));
    for (const [heading, choices] of groups(levels)) {
        dialog.append(element('h3', '', heading));
        const row = element('div', 'levels');
        for (const level of choices) {
            const button = element('button', 'level');
            button.title = `Import ${level.name}`;
            button.append(element('span', 'name', level.name),
                element('span', 'size', `${level.linedefs} lines, ${level.sectors} sectors`));
            button.addEventListener('click', () => dialog.close(level.name));
            row.append(button);
        }
        dialog.append(row);
    }
    const cancel = element('button', 'cancel', 'Cancel');
    cancel.addEventListener('click', () => dialog.close(''));
    const footer = element('div', 'footer');
    footer.append(cancel);
    dialog.append(footer);
    for (const type of ['keydown', 'copy', 'cut', 'paste']) {
        dialog.addEventListener(type, (e) => e.stopPropagation());
    }
    document.body.append(dialog);
    return new Promise((resolve) => {
        dialog.addEventListener('close', () => {
            dialog.remove();
            resolve(dialog.returnValue || undefined);
        });
        dialog.showModal();
        dialog.querySelector<HTMLButtonElement>('button.level')?.focus();
    });
}
