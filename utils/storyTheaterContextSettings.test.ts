// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CharacterProfile, StoryTheaterEntry, UserProfile } from '../types';
import StoryTheaterEditor from '../components/date/story/StoryTheaterEditor';
import { createStoryTheaterDraft, normalizeStoryTheater } from './storyTheater';

vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('./db', () => ({ DB: { getMessagesByCharId: async () => [] } }));

it('移除逐角色原文和时间控件，旧字段在保存重开后保留且不恢复人数限制', async () => {
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
        const legacy = {
            ...createStoryTheaterDraft(),
            title: '真实剧情',
            characterIds: ['a', 'b'],
            castLimits: { minGroups: 1, maxGroups: 3, minPeople: 99, maxPeople: 1 },
            writesToCharacterMemory: true,
            carryCharacterMemory: true,
            characterContextLimits: { a: 2, b: 0 },
            characterMemoryDates: { a: '2020-01-02T03:04' },
        };
        await open(legacy, 'initial');
        expect(inputFor('角色甲')).toBeUndefined();
        expect(inputFor('角色乙')).toBeUndefined();
        expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
        expect(container.textContent).not.toContain('初始剧情时间');
        expect(container.textContent).toContain('按各自实际发送的时间记录，无需设置日期');
        await click('角色乙');
        expect(inputFor('角色乙')).toBeUndefined();
        await click('角色乙');
        expect(inputFor('角色乙')).toBeUndefined();
        const castInput = (label: string) => Array.from(container.querySelectorAll('label'))
            .find(node => node.textContent?.startsWith(label))?.querySelector('input[type="number"]') as HTMLInputElement;
        const setCastLimit = async (label: string, value: string) => {
            const input = castInput(label);
            await act(async () => {
                Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
            });
        };
        expect(container.textContent).toContain('每轮随机建议组数');
        expect(castInput('每轮最多出演人数')).toBeUndefined();
        expect(castInput('每轮最少出演人数')).toBeUndefined();
        await setCastLimit('最少交流倾向组数', '');
        expect(container.textContent).toContain('请填写正整数');
        await click('保存并进入');
        expect(onSave).not.toHaveBeenCalled();
        await setCastLimit('最少交流倾向组数', '2');
        await setCastLimit('最多交流倾向组数', '8');
        await click('保存并进入');
        const saved = onSave.mock.calls[0][0];
        expect(saved.characterContextLimits).toEqual(legacy.characterContextLimits);
        expect(saved.characterMemoryDates).toEqual(legacy.characterMemoryDates);
        expect(saved.castLimits).toEqual({ minGroups: 2, maxGroups: 8 });
        expect(legacy.castLimits).toEqual({ minGroups: 1, maxGroups: 3, minPeople: 99, maxPeople: 1 });
        await open(normalizeStoryTheater(saved), 'reopen');
        expect(inputFor('角色乙')).toBeUndefined();
        expect(inputFor('角色甲')).toBeUndefined();
        expect(castInput('最少交流倾向组数').value).toBe('2');
        expect(castInput('每轮最多出演人数')).toBeUndefined();
        await open({ ...saved, writesToCharacterMemory: false, carryCharacterMemory: true }, 'fiction');
        expect(inputFor('角色甲')).toBeUndefined();
        expect(container.querySelector('input[type="datetime-local"]')).toBeNull();
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        vi.unstubAllGlobals();
    }
});
