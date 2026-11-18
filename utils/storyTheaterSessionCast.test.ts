// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import StoryTheaterSession from '../components/date/story/StoryTheaterSession';
import type { CharacterProfile, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { createBlankStoryPreset, createStoryTheaterDraft, storyTheaterThreadId } from './storyTheater';
import { STORY_RELATIONSHIP_PROMPT_ID } from './storyTheaterRelationships';
import { moveStoryInLibrary, saveStoryLibrary, STORY_LIBRARY_STORAGE_KEY, type StoryLibrary } from './storyTheaterLibrary';

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

it('单次请求处理出演、私轴、自由续写和场外对话，并保留镜像、时间线与共通剧场行为', async () => {
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
        apiConfig: { baseUrl: 'https://example.invalid/v1', model: 'mock', apiKey: 'theater-fixture-api-key' },
        memoryPalaceConfig: { embedding: { baseUrl: 'https://example.invalid', apiKey: 'mock' } },
        addToast: mocks.toast,
    });
    const preset = createBlankStoryPreset('验收预设');
    preset.document.prompts[0].content += ' 检查隐藏 theater-fixture-api-key。';
    preset.document.assistantPrefill = '<story_text>';
    const privateAxes = (ids: string[], note = '整理旧线索') => '<private_axes>' + JSON.stringify(Object.fromEntries(
        ids.map(id => [id, note]),
    )) + '</private_axes>';
    const reply = (body: string, groups?: string[][]) => {
        const castIds = groups ? [...new Set(groups.flat())] : [];
        const interactions = (groups ?? []).filter(group => group.length > 1);
        return new Response(JSON.stringify({
            choices: [{ message: { content: body + (groups
                ? '<turn_cast>' + JSON.stringify(castIds) + '</turn_cast><interaction_result>' + JSON.stringify(interactions) + '</interaction_result>'
                    + privateAxes(actors.map(actor => actor.id))
                : '') } }],
        }));
    };
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(new Response('{}', { status: 503 }))
        .mockResolvedValueOnce(reply('<story_text>越界回复</story_text>', [['unknown']]))
        .mockResolvedValueOnce(reply('<story_text>第一幕暗号：修表交给我。</story_text><scene_header><time>2026-04-13 09:00</time></scene_header>', [[a.id, c.id]]))
        .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content:
            '<story_text>演员 c 自己整理行李。演员 b 沉默地坐在门边。</story_text><scene_header><time>3天后</time></scene_header>'
            + '<turn_cast>' + JSON.stringify([b.id, c.id]) + '</turn_cast>' + privateAxes([b.id, c.id]),
        } }] })))
        .mockResolvedValueOnce(reply('<story_text>演员 c 独自收拾旧信。演员 a 在楼上修钟。</story_text><scene_header><time>5天后</time></scene_header>', [[a.id], [c.id]]))
        .mockResolvedValueOnce(reply('<story_text>另一个剧场。</story_text>', [[a.id]]))
        .mockResolvedValueOnce(reply('<out_of_story>可以把旧信留到下一幕揭晓。</out_of_story>'))
        .mockResolvedValueOnce(reply('<out_of_story>这样能让悬念多留一幕。</out_of_story>'))
        .mockResolvedValueOnce(reply('<out_of_story>也可以先让读者看见信封。</out_of_story>'))
        .mockResolvedValueOnce(reply('<story_text>演员 c 把旧信放回抽屉。</story_text><scene_header><time>2天后</time></scene_header>', [[c.id]]));
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let entry: StoryTheaterEntry = {
        ...createStoryTheaterDraft(), id: 'cast-session', title: '剧情选角验证',
        characterIds: actors.map(actor => actor.id), castLimits: { minGroups: 1, maxGroups: 1 }, writesToCharacterMemory: true, carryCharacterMemory: true,
        characterContextLimits: Object.fromEntries(actors.map(actor => [actor.id, 0])),
        selectedWorldbookIds: ['test-worldbook'],
        characterMemoryDates: { [a.id]: '2026-04-10T09:00', [b.id]: '2026-04-11T09:00', [c.id]: '2026-04-10T09:00' },
    };
    let second = { ...entry, id: 'other-cast-session', title: '第二剧场' };
    const render = (id: string, onEntryChange: (next: StoryTheaterEntry) => void | Promise<void> = () => {}) => act(async () => {
        root.render(createElement(StoryTheaterSession, {
            key: id, entry: id === second.id ? second : entry, preset, masks: [], onBack: () => {}, onEdit: () => {}, onEntryChange,
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
            expect(advance().querySelector('.animate-spin')).toBeNull();
        });
    };
    const setInput = (text: string) => act(async () => {
        const input = container.querySelector('textarea')!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const payload = (index: number) => JSON.parse(String(fetch.mock.calls[index][1]?.body)).messages as { role: string; content: string }[];
    const promptText = (index: number) => payload(index).map(row => row.content).join('\n');
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.25);
    try {
        await DB.saveStoryTheater(entry);
        await DB.saveStoryTheater(second);
        const library: StoryLibrary = {
            folders: [{ id: 'folder', name: '共同世界', parentId: null, mode: 'normal' }],
            locations: { [entry.id]: 'folder', [second.id]: 'folder' },
        };
        saveStoryLibrary(library);
        await render(entry.id);
        await setInput('我在窗边坐下。');
        await send(advance(), 1);
        const [pending] = await DB.getMessagesByCharId(thread, true);
        expect(pending.metadata.theaterCastIds).toBeUndefined();
        await send(advance(), 2);
        expect(await contents(thread)).toEqual(['我在窗边坐下。', '<story_text>越界回复</story_text>']);
        const tendencies = (call: number) => payload(call).find(row => row.content.startsWith('本轮随机交流倾向：'))?.content;
        expect(tendencies(0)).toBeTruthy();
        expect(tendencies(1)).toBe(tendencies(0));
        const invalidReply = (await DB.getMessagesByCharId(thread, true)).at(-1)!;
        expect(invalidReply.metadata.theaterCastIds).toEqual([]);
        expect(invalidReply.metadata.theaterPrivateAxes).toBeUndefined();
        expect(mocks.archive).not.toHaveBeenCalled();
        expect(await Promise.all(actors.map(actor => contents(actor.id)))).toEqual([[], [], []]);
        expect(checked()).toEqual([]);

        await setInput('我在窗边坐下。');
        await send(advance(), 3);
        await vi.waitFor(() => expect(mocks.archive.mock.calls.map(call => call[1])).toEqual([a.id, c.id]));
        expect(checked()).toEqual([a.name, c.name]);
        expect((await DB.getMessagesByCharId(thread, true)).at(-1)?.metadata.theaterInteractionGroups)
            .toEqual([[a.id, c.id]]);
        expect(await contents(a.id)).toEqual(['我在窗边坐下。', '<story_text>第一幕暗号：修表交给我。</story_text><scene_header><time>2026-04-13 09:00</time></scene_header>']);
        expect(await timeline(a.id)).toEqual([at(10), at(13)]);
        expect(await contents(b.id)).toEqual([]);
        expect(await contents(c.id)).toHaveLength(2);
        expect(payload(2).at(-1)?.role).toBe('user');
        expect(promptText(2)).toContain('候选角色（ID、姓名）');
        expect(promptText(2)).toContain('演员设定c');
        expect(promptText(2)).not.toContain('尚未实现的交流倾向');
        const previewButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === '查看本次发送的提示词')!;
        await act(async () => previewButton.click());
        const preview = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="发送消息与预设原文"]')!.value;
        expect(preview).toContain('【预设原文】');
        expect(preview).toContain('{{theater_interaction_tendencies}}');
        expect(preview).toContain(tendencies(2));
        expect(preview).toContain('运行时注入');
        expect(preview).toContain('演员设定c');
        expect(preview).not.toContain('Authorization');
        expect(promptText(2)).toContain('theater-fixture-api-key');
        expect(preview).not.toContain('theater-fixture-api-key');
        expect(preview).toContain('[已隐藏]');
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭提示词"]')!.click());
        expect(promptText(2)).toContain('本轮随机交流倾向');
        expect(promptText(2)).toContain('完整正文（起始：');
        expect(payload(2).map(row => row.content).join('\n').match(/城南钟楼已经停摆/g)).toHaveLength(1);
        expect(container.textContent).toContain('第一幕暗号');
        expect(container.textContent).not.toContain('<turn_cast>');
        expect(container.textContent).not.toContain('<private_axes>');
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="查看演员a的私轴"]')!.click());
        expect(container.querySelector('[role="dialog"]')?.textContent).toContain('整理旧线索');
        await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="关闭私轴"]')!.click());
        expect((await DB.getMessagesByCharId(thread, true)).at(-1)?.metadata.theaterPrivateAxes)
            .toEqual({ [a.id]: '整理旧线索', [c.id]: '整理旧线索' });

        await setInput('我翻到另一页。');
        await send(advance(), 4);
        await vi.waitFor(() => expect(mocks.archive.mock.calls.map(call => call[1])).toEqual([a.id, c.id, b.id, c.id]));
        expect(checked()).toEqual([b.name, c.name]);
        expect(await contents(a.id)).toHaveLength(2);
        expect(await contents(b.id)).toHaveLength(2);
        const beforeRewrite = (await DB.getMessagesByCharId(thread, true)).slice(-2);
        expect(beforeRewrite[1].metadata.theaterInteractionGroups).toEqual([]);
        expect(await timeline(c.id)).toEqual([at(10), at(13), at(13), at(16)]);
        expect(lastReference(a.id)).toBe(at(13));
        expect(payload(3).map(row => row.content).join('\n').match(/第一幕暗号/g)).toHaveLength(1);
        expect(promptText(3)).toContain('整理旧线索');

        const reroll = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('换一种写法'))!;
        await vi.waitFor(async () => { await flush(); expect(reroll.disabled).toBe(false); });
        await send(reroll, 5);
        expect(checked()).toEqual([a.name, c.name]);
        expect(await contents(b.id)).toEqual([]);
        expect((await contents(a.id)).at(-1)).toContain('楼上修钟');
        expect(await contents(c.id)).toHaveLength(4);
        expect(await timeline(c.id)).toEqual([at(10), at(13), at(13), at(18)]);
        expect(lastReference(c.id)).toBe(at(13));
        expect(await contents(thread)).toHaveLength(6);
        const afterRewrite = (await DB.getMessagesByCharId(thread, true)).slice(-2);
        expect(afterRewrite.map(row => row.id)).toEqual(beforeRewrite.map(row => row.id));
        expect(afterRewrite.map(row => row.metadata.theaterMirrorIds[c.id]))
            .toEqual(beforeRewrite.map(row => row.metadata.theaterMirrorIds[c.id]));
        expect(afterRewrite[1].metadata.theaterPrivateAxes).toEqual({ [a.id]: '整理旧线索', [c.id]: '整理旧线索' });
        expect(mocks.archive).toHaveBeenCalledTimes(4);
        expect(promptText(4)).toContain('候选角色（ID、姓名）');
        expect(tendencies(4)).toBe(tendencies(3));
        expect(promptText(4)).toContain('整理旧线索');

        await render('other-cast-session');
        await setInput('在另一个地方开场。');
        await send(advance(), 6);
        expect(lastReference(a.id)).toBe(at(10));
        expect(payload(5).map(row => row.content).join('\n')).toContain('第一幕暗号');
        expect(promptText(5)).not.toContain('共通文件夹 · 其他剧场原文');
        expect(await contents(thread)).toHaveLength(6);
        expect(await contents(a.id)).toHaveLength(6);

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
        expect(promptText(8)).toContain('本轮模式：场外重写');
        expect(payload(8).at(-1)).toEqual({ role: 'user', content: '为什么？' });
        expect(vi.mocked(retrieveMemories)).toHaveBeenCalledTimes(recallCalls);
        expect(container.textContent).toContain('也可以先让读者看见信封。');
        expect(container.textContent).not.toContain('这样能让悬念多留一幕。');
        const outOfStoryRows = (await DB.getMessagesByCharId(thread, true)).slice(6);
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
        expect(archiveCalls).toBe(5);
        expect(mocks.archive).toHaveBeenCalledTimes(archiveCalls);
        expect(await timeline(c.id)).toEqual([at(10), at(13), at(13), at(18)]);

        historyPrompt.enabled = true;
        await render('other-cast-session');
        await render(entry.id);
        await send(container.querySelector<HTMLButtonElement>('button[aria-label="继续当前剧情"]')!, 10);
        expect(promptText(9)).toContain('本轮模式：剧情续写');
        expect(lastReference(c.id)).toBe(at(18));
        expect(promptText(9)).toContain('整理旧线索');
        expect(await timeline(c.id)).toEqual([at(10), at(13), at(13), at(18), at(18), at(20)]);
        expect(checked()).toEqual([c.name]);
        await vi.waitFor(() => expect(mocks.archive).toHaveBeenCalledTimes(archiveCalls + 1));

        library.folders[0].mode = 'shared';
        saveStoryLibrary(library);
        const secondThread = storyTheaterThreadId(second.id);
        second = { ...second, writesToCharacterMemory: false, carryCharacterMemory: false };
        await DB.saveStoryTheater(second);
        const addPeerLayer = (role: 'user' | 'assistant' | 'system', content: string, extra = {}) =>
            DB.saveMessage({ charId: secondThread, role, type: 'text', content, metadata: { source: 'story_theater', ...extra } });
        await addPeerLayer('user', '归档用户原文', { theaterArchived: true });
        await addPeerLayer('assistant', '归档回复原文', { theaterArchived: true });
        await addPeerLayer('user', '场外用户原文', { theaterOutOfStory: true });
        await addPeerLayer('assistant', '场外回复原文', { theaterOutOfStory: true });
        await addPeerLayer('system', '来源剧场系统规则');
        await addPeerLayer('user', '第二剧场完整轮输入 {{user}}');
        await addPeerLayer('assistant', '第二剧场完整轮回复');
        await addPeerLayer('user', '尚未回复的输入');
        fetch.mockImplementation(async () => reply('<story_text>共通验证</story_text>', [[c.id]]));
        await setInput('接着从当前地点继续。');
        await send(advance(), 11);
        const sharedScenario = payload(10).find(row => row.content.includes('### 当前剧情'))?.content;
        expect(sharedScenario).toContain('来源剧场：第二剧场');
        expect(sharedScenario).toContain('第二剧场完整轮输入 {{user}}\n剧场：第二剧场完整轮回复');
        expect(sharedScenario).not.toMatch(/归档用户原文|归档回复原文|场外用户原文|场外回复原文|来源剧场系统规则|尚未回复的输入|第一幕暗号/);
        expect(promptText(10).match(/第一幕暗号/g)).toHaveLength(1);

        await render(second.id);
        await setInput('回到第二剧场。');
        await send(advance(), 12);
        const reverse = payload(11).find(row => row.content.includes('共通文件夹 · 其他剧场原文'))?.content;
        expect(reverse).toContain('来源剧场：剧情选角验证');
        expect(reverse).toContain('第一幕暗号');
        expect(reverse).not.toContain('可以把旧信留到下一幕揭晓。');

        const archivedRealReply = (await DB.getMessagesByCharId(thread, true)).find(row => row.content.includes('第一幕暗号'))!;
        const watermarks = Object.entries(archivedRealReply.metadata.theaterMirrorIds);
        for (const [id, watermark] of watermarks) localStorage.setItem(`mp_lastMsgId_${id}`, String(watermark));

        saveStoryLibrary(moveStoryInLibrary(library, entry.id, null));
        await setInput('移出后的新一轮。');
        await send(advance(), 13);
        expect(promptText(12)).not.toContain('共通文件夹 · 其他剧场原文');
        saveStoryLibrary(moveStoryInLibrary(library, entry.id, 'folder'));
        await setInput('移回后的新一轮。');
        await send(advance(), 14);
        expect(promptText(13)).toContain('来源剧场：剧情选角验证');
        expect(promptText(13)).not.toContain('第一幕暗号');
        expect(promptText(13)).toContain('越界回复');
        for (const [id] of watermarks) localStorage.removeItem(`mp_lastMsgId_${id}`);

        await setInput('本剧场长输入' + '长'.repeat(26_000));
        await send(advance(), 15);
        expect(promptText(14)).toContain('本剧场长输入' + '长'.repeat(26_000));
        expect(promptText(14)).toContain('移回后的新一轮。');
        expect(promptText(14)).not.toContain('共通文件夹 · 其他剧场原文');
        expect((await contents(secondThread)).join('\n')).not.toContain('第一幕暗号');

        const freeEntry = { ...entry, id: 'free-story-session', castModeEnabled: false, archiveAfter: 3 };
        entry = freeEntry;
        await render(freeEntry.id);
        const beforeFree = await Promise.all(actors.map(actor => contents(actor.id)));
        const archiveBeforeFree = mocks.archive.mock.calls.length;
        fetch.mockImplementation(async () => reply('自由生成的正文。'));
        for (const [index, input] of ['自由第一轮', '自由第二轮', '自由第三轮'].entries()) {
            await setInput(input);
            await send(advance(), 16 + index);
        }
        expect(promptText(17)).not.toContain('自由第一轮');
        expect(promptText(17)).toContain('自由第二轮');
        expect(promptText(17)).not.toMatch(/<turn_cast>|<private_axes>|本轮随机建议组合|根据最新输入选择回复模式/);
        expect(promptText(17)).toContain('演员设定c');
        for (const [index, input] of ['自由第一轮', '自由第二轮', '自由第三轮'].entries()) {
            expect(payload(15 + index).slice(-2)).toEqual([
                { role: 'user', content: input },
                { role: 'assistant', content: '<story_text>' },
            ]);
        }
        expect(await Promise.all(actors.map(actor => contents(actor.id)))).toEqual(beforeFree);
        expect(mocks.archive).toHaveBeenCalledTimes(archiveBeforeFree);
        const freeRows = await DB.getMessagesByCharId(storyTheaterThreadId(freeEntry.id), true);
        expect(freeRows).toHaveLength(6);
        expect(freeRows.filter(row => row.role === 'assistant').map(row => row.content))
            .toEqual(Array(3).fill('<story_text>自由生成的正文。'));
        expect(freeRows.every(row => !row.metadata.theaterMirrorIds && !row.metadata.theaterCastGroups && !row.metadata.theaterPrivateAxes)).toBe(true);
        expect(freeRows.slice(0, 4).every(row => row.metadata.theaterArchived)).toBe(true);
        expect(freeRows.slice(4).every(row => !row.metadata.theaterArchived)).toBe(true);
        fetch.mockImplementationOnce(async () => reply('<out_of_story>我们聊聊这一段。</out_of_story>'));
        await setInput('出戏聊聊？');
        await send(advance(), 19);
        expect(container.textContent).toContain('我们聊聊这一段。');

        entry = {
            ...entry, id: 'cast-fallback-session', castModeEnabled: true,
            castLimits: { minGroups: 99, maxGroups: 99 },
        };
        preset.document = {
            ...preset.document,
            prompts: [...preset.document.prompts, { id: STORY_RELATIONSHIP_PROMPT_ID, name: '关系', enabled: true, role: 'system', content: '' }],
        };
        const saveEntry = async (next: StoryTheaterEntry) => {
            await DB.saveStoryTheater(next);
            entry = next;
        };
        await render(entry.id, saveEntry);
        const picker = container.querySelector<HTMLSelectElement>('select[aria-label="关系三轴主要角色"]')!;
        expect(picker.value).toBe(a.id);
        await act(async () => {
            picker.value = b.id;
            picker.dispatchEvent(new Event('change', { bubbles: true }));
        });
        expect((await DB.getStoryTheaters()).find(row => row.id === entry.id)?.primaryCharacterId).toBe(b.id);
        await render(entry.id, saveEntry);
        const castFallbackThread = storyTheaterThreadId(entry.id);
        const serializedPanel = '<relationship_panel>' + JSON.stringify({
            primaryId: b.id,
            state_note: '他记得自己还欠一句谢谢',
            relationships: [{ fromId: b.id, toId: a.id, relation_note: '信任刚刚回暖', axes: {
                FL: { score: 5, trigger: '递来纸条', evidence: '伸手接下' },
            } }],
        }) + '</relationship_panel>';
        fetch.mockImplementationOnce(async () => reply(serializedPanel, [[a.id]]));
        await setInput('她递来纸条。');
        await send(advance(), 20);
        expect(await contents(castFallbackThread)).toEqual(['她递来纸条。']);
        expect(mocks.toast.mock.calls.at(-1)?.[0]).toContain('未生成有效剧情正文');
        fetch.mockImplementationOnce(async () => reply('<story_text>他伸手接下纸条。</story_text>' + serializedPanel, [[a.id, b.id]]));
        await send(advance(), 21);
        expect(promptText(20)).toContain('"primaryId":"' + b.id + '"');
        expect(container.textContent).toContain('关系记录 · ' + b.name);
        expect(container.textContent).toContain('信任刚刚回暖');
        expect(container.textContent).toContain('他记得自己还欠一句谢谢');
        expect(checked()).toEqual([a.name, b.name]);
        for (const actor of [a, b]) {
            const rows = (await DB.getMessagesByCharId(actor.id, true)).filter(row => row.metadata.theaterId === entry.id);
            expect(rows).toHaveLength(2);
            expect(rows[1].content).toContain('他伸手接下纸条。');
        }
        expect((await DB.getMessagesByCharId(c.id, true)).filter(row => row.metadata.theaterId === entry.id)).toEqual([]);
    } finally {
        await act(async () => { root.unmount(); });
        container.remove();
        localStorage.removeItem(STORY_LIBRARY_STORAGE_KEY);
        if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        randomSpy.mockRestore();
        vi.unstubAllGlobals();
    }
});

it('楼层里可纠正出演、补写未出演候选人的私轴，并在生成中编辑本轮用户推进', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const scroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: () => {} });
    const characters = [{ id: 'manual-ui-a', name: '小甲' }, { id: 'manual-ui-b', name: '小乙' }, { id: 'manual-ui-c', name: '小丙' }];
    const [a, b, c] = characters;
    Object.assign(mocks.state, {
        characters, userProfile: { name: '本人' }, theme: {},
        apiConfig: { baseUrl: 'https://example.invalid/v1', model: 'mock', apiKey: 'mock' },
        memoryPalaceConfig: {}, addToast: mocks.toast,
    });
    const entry = { ...createStoryTheaterDraft(), id: 'manual-edit-ui', characterIds: characters.map(actor => actor.id),
        writesToCharacterMemory: true };
    const preset = createBlankStoryPreset('人工编辑测试');
    const result = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }));
    let finishGeneration!: (response: Response) => void;
    const deferred = new Promise<Response>(resolve => { finishGeneration = resolve; });
    const fetch = vi.fn<typeof globalThis.fetch>()
        .mockResolvedValueOnce(result('<story_text>保留缺名单的正文</story_text><turn_cast>["越界"]</turn_cast>'))
        .mockResolvedValueOnce(result('<story_text>角色开始交谈</story_text>'
            + `<turn_cast>["${a.id}","${b.id}"]</turn_cast><interaction_result>[["${a.id}","${b.id}"]]</interaction_result>`
            + `<private_axes>{"${a.id}":"AI 原私轴"}</private_axes>`))
        .mockReturnValueOnce(deferred);
    vi.stubGlobal('fetch', fetch);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const render = (key: string) => act(async () => root.render(createElement(StoryTheaterSession, {
        key, entry, preset, masks: [], onBack: () => {}, onEdit: () => {}, onEntryChange: () => {},
    })));
    const dialog = () => container.querySelector('[role="dialog"]')!;
    const buttons = (scope: ParentNode = container) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button'));
    const press = (label: string, scope: ParentNode = container) => act(async () => {
        const button = buttons(scope).find(node => node.getAttribute('aria-label') === label || node.textContent?.trim() === label);
        expect(button).toBeTruthy();
        button!.click();
    });
    const type = (selector: string, value: string, scope: ParentNode = container) => act(async () => {
        const textarea = scope.querySelector<HTMLTextAreaElement>(selector)!;
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, value);
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const turnButtons = () => container.querySelectorAll<HTMLButtonElement>('[aria-label="编辑本轮出演名单及私轴"]');
    const openTurn = (index: number) => act(async () => turnButtons()[index].click());
    const rows = () => DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
    const waitFor = (assertion: () => void | Promise<void>) => vi.waitFor(async () => {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
        await assertion();
    });
    const submit = async (text: string) => {
        await type('textarea', text);
        await act(async () => { container.querySelector<HTMLButtonElement>('button.story-send-button')!.click(); });
    };
    const setAxis = async (name: string, value: string, initial: string) => {
        await press(`查看${name}的私轴`, dialog());
        await press('编辑私轴', dialog());
        expect(dialog().querySelector('textarea')?.value).toBe(initial);
        await type('textarea', value, dialog());
        await press('保存私轴', dialog());
        await waitFor(() => expect(dialog().querySelector('textarea')).toBeNull());
        await press('关闭私轴', dialog());
    };
    const toggle = (index: number) => act(async () => dialog().querySelectorAll<HTMLInputElement>('input[type=checkbox]')[index].click());
    const checked = () => Array.from(dialog().querySelectorAll<HTMLInputElement>('input:checked')).map(input => input.parentElement?.textContent);
    const request = (call: number) => JSON.stringify(JSON.parse(String(fetch.mock.calls[call][1]?.body)).messages);
    try {
        await render('initial');
        await submit('第一轮输入');
        await waitFor(() => expect(turnButtons()).toHaveLength(1));
        expect((await DB.getMessagesByCharId(a.id, true))).toEqual([]);
        await openTurn(0);
        expect(dialog().querySelectorAll('input[type=checkbox]')).toHaveLength(3);
        expect(checked()).toEqual([]);
        await setAxis(b.name, '小乙的候选私轴', '');
        await toggle(0);
        await press('保存出演名单', dialog());
        await waitFor(() => expect(dialog()).toBeNull());
        expect((await rows())[1].metadata.theaterCastIds).toEqual([a.id]);
        expect((await rows())[1].content).toContain('保留缺名单的正文');

        await submit('第二轮输入');
        await waitFor(() => expect(turnButtons()).toHaveLength(2));
        expect(request(1)).toContain('小乙的候选私轴');
        await openTurn(1);
        expect(checked()).toEqual([a.name, b.name]);
        await setAxis(a.name, '更新小甲的私轴', 'AI 原私轴');
        await setAxis(b.name, '', '');
        await toggle(1);
        await toggle(2);
        await press('保存出演名单', dialog());
        await waitFor(() => expect(dialog()).toBeNull());
        await render('refreshed');
        await waitFor(() => expect(turnButtons()).toHaveLength(2));
        await openTurn(1);
        expect(checked()).toEqual([a.name, c.name]);
        expect((await rows())[3].metadata.theaterInteractionGroups).toEqual([]);
        expect(await DB.getMessagesByCharId(b.id, true)).toEqual([]);
        await press('关闭出演名单', dialog());

        await submit('生成中的输入');
        await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
        expect(request(2)).toContain('更新小甲的私轴');
        expect(request(2)).not.toContain('小乙的候选私轴');
        const pending = Array.from(container.querySelectorAll('.meeting-user-turn')).at(-1)!;
        await act(async () => pending.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
        await act(async () => buttons().find(button => button.textContent?.includes('编辑这一层'))!.click());
        await type('textarea', '生成中修订的输入', container.querySelector('.story-keyboard-sheet')!);
        await press('保存这一层');
        await waitFor(() => expect(container.textContent).toContain('生成中修订的输入'));
        await act(async () => finishGeneration(result(`<story_text>第三轮正文</story_text><turn_cast>["${c.id}"]</turn_cast>`)));
        await waitFor(() => expect(turnButtons()).toHaveLength(3));
        const [, , , , input, reply] = await rows();
        expect(input.content).toBe('生成中修订的输入');
        expect(reply.metadata.theaterInputId).toBe(input.id);
        expect(await DB.getMessageById(input.metadata.theaterMirrorIds[c.id])).toMatchObject({
            content: input.content, metadata: { theaterCentralId: input.id },
        });
    } finally {
        await act(async () => root.unmount());
        container.remove();
        if (scroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scroll);
        else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
        vi.unstubAllGlobals();
    }
});
