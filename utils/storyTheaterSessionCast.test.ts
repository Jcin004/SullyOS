// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import { createBlankStoryPreset, createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, archive: vi.fn(), toast: vi.fn() }));
vi.mock('../context/OSContext', () => ({ useOS: () => mocks.state }));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('../components/date/story/StoryTheaterTheme', () => ({ StoryAppearanceButton: () => null }));
vi.mock('./memoryPalace/pipeline', async importOriginal => ({
    ...await importOriginal<typeof import('./memoryPalace/pipeline')>(),
    retrieveMemories: async () => '',
}));
vi.mock('./memoryPalace/autoArchive', () => ({ processNewMessagesWithAutoArchive: mocks.archive }));
vi.mock('./memoryPalace', () => ({ incrementDigestRound: () => false, runCognitiveDigestion: vi.fn() }));

it('剧场界面单次请求选角，换人后只整理出演者，失败重试和重写不重复写入', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
    const actors = ['a', 'b', 'c'].map(id => ({
        id: 'scene-' + id, name: '演员' + id, systemPrompt: '演员设定' + id,
        memoryPalaceEnabled: true, contextRangeMode: 'manual', contextLimit: 50, contextRangePolicyVersion: 1,
        mountedWorldbooks: id === 'a' ? [{ id: 'test-worldbook', title: '地方设定', content: '城南钟楼已经停摆。', position: 0, constant: true }] : [],
    })) as CharacterProfile[];
    const [a, b, c] = actors;
    Object.assign(mocks.state, {
        characters: actors, userProfile: { name: '本人' }, theme: {},
        apiConfig: { baseUrl: 'https://example.invalid/v1', model: 'mock', apiKey: 'mock' },
        memoryPalaceConfig: { embedding: { baseUrl: 'https://example.invalid', apiKey: 'mock' } },
        addToast: mocks.toast,
    });
    const preset = createBlankStoryPreset('验收预设');
    preset.document.assistantPrefill = '<story_text>';
    const reply = (body: string, groups?: string[][]) => new Response(JSON.stringify({
        choices: [{ message: { content: (groups ? '<turn_cast>' + JSON.stringify(groups) + '</turn_cast>' : '') + body } }],
    }));
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(reply('<story_text>越界回复</story_text>', [['unknown']]))
        .mockResolvedValueOnce(reply('<story_text>第一幕暗号：修表交给我。</story_text>', [[a.id, b.id]]))
        .mockResolvedValueOnce(reply('<story_text>演员 c 自己整理行李。</story_text>', [[c.id]]))
        .mockResolvedValueOnce(reply('演员 c 独自收拾旧信。</story_text>'))
        .mockResolvedValueOnce(reply('<story_text>另一个剧场。</story_text>', [[a.id]]));
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const entry = {
        ...createStoryTheaterDraft(), id: 'cast-session', title: '剧情选角验证',
        characterIds: actors.map(actor => actor.id), writesToCharacterMemory: true, carryCharacterMemory: true,
        selectedWorldbookIds: ['test-worldbook'],
    };
    const render = (id: string) => act(async () => {
        root.render(createElement(StoryTheaterSession, {
            key: id, entry: { ...entry, id }, preset, masks: [], onBack: () => {}, onEdit: () => {}, onEntryChange: () => {},
        }));
    });
    const advance = () => container.querySelector<HTMLButtonElement>('button.story-send-button')!;
    const checked = () => Array.from(container.querySelectorAll<HTMLInputElement>('fieldset input:checked'))
        .map(input => input.parentElement?.textContent);
    const contents = async (id: string) => (await DB.getMessagesByCharId(id, true)).map(row => row.content);
    const thread = storyTheaterThreadId(entry.id);
    const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
    const send = async (button: HTMLButtonElement, calls: number) => {
        await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 15)); });
        await vi.waitFor(async () => {
            await flush();
            expect(fetch).toHaveBeenCalledTimes(calls);
            expect(container.querySelector('button[aria-label="继续当前剧情"]')?.hasAttribute('disabled')).toBe(false);
        });
    };
    const setInput = (text: string) => act(async () => {
        const input = container.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const payload = (index: number) => JSON.parse(String(fetch.mock.calls[index][1]?.body)).messages as { role: string; content: string }[];
    try {
        await render(entry.id);
        await setInput('我在窗边坐下。');
        await send(advance(), 1);
        await send(advance(), 2);
        expect(await contents(thread)).toEqual(['我在窗边坐下。']);
        expect(await contents(a.id)).toEqual([]);
        expect(await contents(b.id)).toEqual([]);
        expect(await contents(c.id)).toEqual([]);
        expect(checked()).toEqual([]);
        expect(mocks.archive).not.toHaveBeenCalled();
        expect(mocks.toast).toHaveBeenLastCalledWith(expect.stringContaining('出演名单无效'), 'error');

        await send(advance(), 3);
        await vi.waitFor(() => expect(mocks.archive.mock.calls.map(call => call[1])).toEqual([a.id, b.id]));
        expect(checked()).toEqual([a.name, b.name]);
        expect(await contents(a.id)).toEqual(['我在窗边坐下。', '<story_text>第一幕暗号：修表交给我。</story_text>']);
        expect(await contents(b.id)).toEqual(await contents(a.id));
        expect(await contents(c.id)).toEqual([]);
        expect(payload(2).at(-1)?.role).toBe('user');
        expect(payload(2).map(row => row.content).join('\n')).toContain('本轮随机建议组合');
        expect(payload(2).map(row => row.content).join('\n')).toContain('名单关闭后，正文沿用预设起始文本');
        expect(payload(2).map(row => row.content).join('\n').match(/城南钟楼已经停摆/g)).toHaveLength(1);
        expect(container.textContent).toContain('第一幕暗号');
        expect(container.textContent).not.toContain('<turn_cast>');

        await setInput('我翻到另一页。');
        await send(advance(), 4);
        await vi.waitFor(() => expect(mocks.archive.mock.calls.map(call => call[1])).toEqual([a.id, b.id, c.id]));
        expect(checked()).toEqual([c.name]);
        expect(await contents(a.id)).toHaveLength(2);
        expect(await contents(b.id)).toHaveLength(2);
        expect(await contents(c.id)).toEqual(['我翻到另一页。', '<story_text>演员 c 自己整理行李。</story_text>']);
        expect(payload(3).map(row => row.content).join('\n').match(/第一幕暗号/g)).toHaveLength(1);

        const reroll = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('换一种写法'))!;
        await vi.waitFor(async () => { await flush(); expect(reroll.disabled).toBe(false); });
        await send(reroll, 5);
        expect(checked()).toEqual([c.name]);
        expect(await contents(c.id)).toEqual(['我翻到另一页。', '<story_text>演员 c 独自收拾旧信。</story_text>']);
        expect(await contents(thread)).toHaveLength(4);
        expect(mocks.archive).toHaveBeenCalledTimes(3);
        expect(payload(4).map(row => row.content).join('\n')).toContain('沿用已确定的出演分组');
        expect(payload(4).map(row => row.content).join('\n')).not.toContain('本轮随机建议组合');

        await render('other-cast-session');
        await setInput('在另一个地方开场。');
        await send(advance(), 6);
        expect(payload(5).map(row => row.content).join('\n')).toContain('第一幕暗号');
        expect(await contents(thread)).toHaveLength(4);
        expect(await contents(a.id)).toHaveLength(4);
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        vi.unstubAllGlobals();
    }
});
