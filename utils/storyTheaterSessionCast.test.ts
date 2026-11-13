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
    retrieveMemories: vi.fn(async (..._args: unknown[]) => ''),
}));
vi.mock('./memoryPalace/autoArchive', () => ({ processNewMessagesWithAutoArchive: mocks.archive }));
vi.mock('./memoryPalace', () => ({ incrementDigestRound: () => false, runCognitiveDigestion: vi.fn() }));
import { retrieveMemories } from './memoryPalace/pipeline';

it('剧场单次请求选角，场外讨论和重写只存中央历史，恢复续写后沿用剧情时间', async () => {
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
        .mockResolvedValueOnce(reply('<story_text>第一幕暗号：修表交给我。</story_text><scene_header><time>2026-04-13 09:00</time></scene_header>', [[a.id, b.id]]))
        .mockResolvedValueOnce(reply('<story_text>演员 c 自己整理行李。</story_text><scene_header><time>3天后</time></scene_header>', [[c.id]]))
        .mockResolvedValueOnce(reply('演员 c 独自收拾旧信。</story_text><scene_header><time>5天后</time></scene_header>'))
        .mockResolvedValueOnce(reply('<story_text>另一个剧场。</story_text>', [[a.id]]))
        .mockResolvedValueOnce(reply('<out_of_story>可以把旧信留到下一幕揭晓。</out_of_story>'))
        .mockResolvedValueOnce(reply('<out_of_story>这样能让悬念多留一幕。</out_of_story>'))
        .mockResolvedValueOnce(reply('<out_of_story>也可以先让读者看见信封。</out_of_story>'))
        .mockResolvedValueOnce(reply('<story_text>演员 c 把旧信放回抽屉。</story_text><scene_header><time>2天后</time></scene_header>', [[c.id]]));
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const entry = {
        ...createStoryTheaterDraft(), id: 'cast-session', title: '剧情选角验证',
        characterIds: actors.map(actor => actor.id), writesToCharacterMemory: true, carryCharacterMemory: true,
        selectedWorldbookIds: ['test-worldbook'],
        characterMemoryDates: { [a.id]: '2026-04-10T09:00', [b.id]: '2026-04-11T09:00', [c.id]: '2026-04-10T09:00' },
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
    const timeline = async (id: string) => (await DB.getMessagesByCharId(id, true)).map(row => {
        expect(row.timestamp).toBe(row.metadata.theaterReceivedAt);
        return row.metadata.theaterTimelineTimestamp;
    });
    const at = (day: number) => new Date(2026, 3, day, 9).getTime();
    const lastReference = (id: string) => vi.mocked(retrieveMemories).mock.calls.filter(call => call[1] === id).at(-1)?.[11]?.referenceTime;
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
        expect(await contents(a.id)).toEqual(['我在窗边坐下。', '<story_text>第一幕暗号：修表交给我。</story_text><scene_header><time>2026-04-13 09:00</time></scene_header>']);
        expect(await timeline(a.id)).toEqual([at(10), at(13)]);
        expect(await timeline(b.id)).toEqual([at(11), at(13)]);
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
        expect(await timeline(c.id)).toEqual([at(10), at(13)]);
        expect(lastReference(a.id)).toBe(at(13));
        expect(payload(3).map(row => row.content).join('\n').match(/第一幕暗号/g)).toHaveLength(1);

        const reroll = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('换一种写法'))!;
        await vi.waitFor(async () => { await flush(); expect(reroll.disabled).toBe(false); });
        await send(reroll, 5);
        expect(checked()).toEqual([c.name]);
        expect(await contents(c.id)).toEqual(['我翻到另一页。', '<story_text>演员 c 独自收拾旧信。</story_text><scene_header><time>5天后</time></scene_header>']);
        expect(await timeline(c.id)).toEqual([at(10), at(15)]);
        expect(lastReference(c.id)).toBe(at(10));
        expect(await contents(thread)).toHaveLength(4);
        expect(mocks.archive).toHaveBeenCalledTimes(3);
        expect(payload(4).map(row => row.content).join('\n')).toContain('沿用已确定的出演分组');
        expect(payload(4).map(row => row.content).join('\n')).not.toContain('本轮随机建议组合');

        await render('other-cast-session');
        await setInput('在另一个地方开场。');
        await send(advance(), 6);
        expect(lastReference(a.id)).toBe(at(10));
        expect(payload(5).map(row => row.content).join('\n')).toContain('第一幕暗号');
        expect(await contents(thread)).toHaveLength(4);
        expect(await contents(a.id)).toHaveLength(4);

        const historyPrompt = preset.document.prompts.find(prompt => prompt.marker === 'history')!;
        historyPrompt.enabled = false;
        await render(entry.id);
        await setInput('跳出剧情聊一下，什么时候揭晓旧信？');
        await send(advance(), 7);
        expect(checked()).toEqual([]);
        expect(container.textContent).toContain('场外 · 你');
        expect(container.textContent).toContain('场外 · AI');
        expect(container.textContent).toContain('可以把旧信留到下一幕揭晓。');
        expect(container.textContent).not.toContain('<out_of_story>');
        await setInput('为什么？');
        await send(advance(), 8);
        expect(payload(7)).toContainEqual({ role: 'user', content: '[场外对话 · 用户]\n跳出剧情聊一下，什么时候揭晓旧信？' });
        expect(payload(7)).toContainEqual({ role: 'assistant', content: '[场外对话 · AI]\n可以把旧信留到下一幕揭晓。' });
        const actorHistory = await Promise.all(actors.map(actor => DB.getMessagesByCharId(actor.id, true)));
        const archiveCalls = mocks.archive.mock.calls.length;
        const recallCalls = vi.mocked(retrieveMemories).mock.calls.length;
        await send(Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('换一种写法'))!, 9);
        expect(payload(8).some(row => row.content.includes('必须继续场外交流'))).toBe(true);
        expect(payload(8).at(-1)).toEqual({ role: 'user', content: '为什么？' });
        expect(vi.mocked(retrieveMemories)).toHaveBeenCalledTimes(recallCalls);
        expect(container.textContent).toContain('也可以先让读者看见信封。');
        expect(container.textContent).not.toContain('这样能让悬念多留一幕。');
        const outOfStoryRows = (await DB.getMessagesByCharId(thread, true)).slice(4);
        expect(outOfStoryRows.map(row => [row.role, row.content])).toEqual([
            ['user', '跳出剧情聊一下，什么时候揭晓旧信？'],
            ['assistant', '可以把旧信留到下一幕揭晓。'],
            ['user', '为什么？'],
            ['assistant', '也可以先让读者看见信封。'],
        ]);
        for (const row of outOfStoryRows) {
            expect(row.metadata.theaterOutOfStory).toBe(true);
            expect(row.metadata.theaterCastGroups).toBeUndefined();
            expect(row.metadata.theaterMirrorIds).toBeUndefined();
            expect(row.metadata.theaterTimelineTimestamp).toBeUndefined();
        }
        expect(await Promise.all(actors.map(actor => DB.getMessagesByCharId(actor.id, true)))).toEqual(actorHistory);
        expect(archiveCalls).toBe(4);
        expect(mocks.archive).toHaveBeenCalledTimes(archiveCalls);
        expect(await timeline(c.id)).toEqual([at(10), at(15)]);

        historyPrompt.enabled = true;
        await render('other-cast-session');
        await render(entry.id);
        await send(container.querySelector<HTMLButtonElement>('button[aria-label="继续当前剧情"]')!, 10);
        expect(payload(9).some(row => row.content.includes('本轮使用剧情续写模式'))).toBe(true);
        expect(lastReference(c.id)).toBe(at(15));
        expect(await timeline(c.id)).toEqual([at(10), at(15), at(15), at(17)]);
        expect(checked()).toEqual([c.name]);
        await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledTimes(archiveCalls + 1));
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        vi.unstubAllGlobals();
    }
});
