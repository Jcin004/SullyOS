// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CharacterProfile, StoryTheaterEntry, UserProfile } from '../types';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { createStoryTheaterDraft, normalizeStoryTheater } from './storyTheater';

vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('./db', () => ({ DB: { getMessagesByCharId: async () => [] } }));

it('真实剧情可以把单个角色设为 0，移除再加入或保存重开后仍为 0', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const characters = [
        { id: 'a', name: '角色甲' },
        { id: 'b', name: '角色乙' },
    ] as CharacterProfile[];
    const onSave = vi.fn<(entry: StoryTheaterEntry) => void>();
    const open = async (entry: StoryTheaterEntry, key: string) => {
        await act(async () => {
            root.render(createElement(StoryTheaterEditor, {
                key,
                initial: entry,
                characters,
                user: { name: '本人' } as UserProfile,
                masks: [],
                maskLocked: true,
                presets: [],
                onCancel: () => {},
                onManualArchive: async draft => draft,
                onSave,
                onImportPreset: async () => null,
                onEditPreset: () => {},
                onOpenMaskBox: () => {},
            }));
        });
    };
    const inputFor = (name: string) => Array.from(container.querySelectorAll('label'))
        .find(label => label.textContent?.includes(name + ' 最近原文'))?.querySelector('input');
    const click = async (name: string) => {
        const button = Array.from(container.querySelectorAll('button')).find(node => node.textContent === name);
        expect(button).toBeDefined();
        await act(async () => { button!.click(); });
    };
    try {
        await open({
            ...createStoryTheaterDraft(),
            title: '真实剧情',
            characterIds: ['a', 'b'],
            writesToCharacterMemory: true,
            carryCharacterMemory: true,
        }, 'initial');
        expect(inputFor('角色甲')?.value).toBe('100');
        const input = inputFor('角色乙')!;
        expect(input.min).toBe('0');
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, '0');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(inputFor('角色乙')?.value).toBe('0');
        await click('角色乙');
        expect(inputFor('角色乙')).toBeUndefined();
        await click('角色乙');
        expect(inputFor('角色乙')?.value).toBe('0');
        const castSelect = (label: string) => Array.from(container.querySelectorAll('label'))
            .find(node => node.textContent?.startsWith(label))?.querySelector('select');
        const setCastLimit = async (label: string, value: string) => {
            const select = castSelect(label)!;
            await act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); });
        };
        await setCastLimit('最少组数', '2');
        await setCastLimit('最多组数', '3');
        await setCastLimit('每组最少人数', '1');
        await setCastLimit('每组最多人数', '2');
        await click('保存并进入');
        const saved = onSave.mock.calls[0][0];
        expect(saved.characterContextLimits.b).toBe(0);
        expect(saved.castLimits).toEqual({ minGroups: 2, maxGroups: 3, minPeople: 1, maxPeople: 2 });
        await open(normalizeStoryTheater(saved), 'reopen');
        expect(inputFor('角色乙')?.value).toBe('0');
        expect(inputFor('角色甲')?.value).toBe('100');
        expect(castSelect('最少组数')?.value).toBe('2');
        expect(castSelect('每组最多人数')?.value).toBe('2');
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
    }
});
