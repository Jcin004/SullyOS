import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, MemoryFragment } from '../../types';
import { DB } from '../db';
import type { MemoryNode } from './types';
import { buildConservativeRepairFragments, MEMORY_AUTO_ARCHIVE_SYNC_EVENT, persistAutoArchiveResult, processNewMessagesWithAutoArchive, repairMissingAutoArchiveMemories } from './autoArchive';
import { MemoryNodeDB } from './db';
import { buildAutoArchiveFragments, type PipelineResult } from './pipeline';
import { deleteNodeAndLinkedArchive } from './linkedArchiveDeletion';

const noon = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12).getTime();

function node(
    id: string,
    year: number,
    month: number,
    day: number,
    overrides: Partial<MemoryNode> = {},
): MemoryNode {
    const createdAt = noon(year, month, day);
    return {
        id,
        charId: 'char-1',
        content: `记忆-${id}`,
        room: 'living_room',
        tags: [],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt,
        lastAccessedAt: createdAt,
        accessCount: 0,
        origin: 'extraction',
        ...overrides,
    };
}

describe('全自动记忆双写缺口修复', () => {
    it('统一持久化入口会写入神经链接，并在开关关闭后停止写入', async () => {
        const enabled = {
            id: 'auto-archive-enabled',
            name: '已开启角色',
            memories: [],
            memoryPalaceEnabled: true,
            autoArchiveEnabled: true,
        } as unknown as CharacterProfile;
        const disabled = {
            ...enabled,
            id: 'auto-archive-disabled',
            name: '已关闭角色',
            autoArchiveEnabled: false,
        } as CharacterProfile;
        await DB.saveCharacter(enabled);
        await DB.saveCharacter(disabled);

        const result = {
            stored: 1,
            skipped: 0,
            processedMessages: 20,
            memories: [],
            batches: [],
            autoArchive: {
                fragments: [{ id: 'fragment-1', date: '2026-07-22', summary: '- 已双写', mood: 'palace' }],
                hideBeforeMessageId: 123,
            },
        };
        await persistAutoArchiveResult(enabled.id, result);
        await persistAutoArchiveResult(disabled.id, result);

        const characters = await DB.getAllCharacters();
        const savedEnabled = characters.find(character => character.id === enabled.id)!;
        const savedDisabled = characters.find(character => character.id === disabled.id)!;
        expect(savedEnabled.memories).toEqual(result.autoArchive.fragments);
        expect(savedEnabled.hideBeforeMessageId).toBe(123);
        expect(savedDisabled.memories).toEqual([]);
        expect(savedDisabled.hideBeforeMessageId).toBeUndefined();
    });

    it('按宫殿 ID 补写，保留已有档案并排除未完成或非个人提取节点', () => {
        const existing: MemoryFragment[] = [
            { id: 'old', date: '2026-07-21', mood: 'palace', summary: '- 已同步' },
            { id: 'manual', date: '2026-07-26', mood: 'calm', summary: '用户手动写过的记忆' },
            { id: 'custom-link', date: '2026-07-20', mood: 'palace', summary: '已有链接', palaceMemoryId: 'linked' },
        ];
        const nodes = [
            node('before', 2026, 7, 20),
            node('missing-a', 2026, 7, 22),
            node('missing-b', 2026, 7, 22),
            node('digestion', 2026, 7, 23, { origin: 'digestion' }),
            node('group', 2026, 7, 24, { groupId: 'group-1' }),
            node('box-summary', 2026, 7, 25, { isBoxSummary: true }),
            node('occupied-day', 2026, 7, 26),
            node('linked', 2026, 7, 20),
            node('not-stored', 2026, 7, 26, { embedded: false }),
        ];

        const repaired = buildConservativeRepairFragments(existing, nodes);

        expect(repaired.map(item => item.palaceMemoryId)).toEqual(['before', 'missing-a', 'missing-b', 'occupied-day']);
        expect(repaired[1]).toMatchObject({ date: '2026-07-22', mood: 'palace', summary: '记忆-missing-a' });
    });

    it.each(['startup', 'missing-result'] as const)('空档案按经历日期补写并广播一次：%s', async mode => {
        const id = `repair-${mode}`;
        await DB.saveCharacter({ id, name: '角色', memoryPalaceEnabled: true, autoArchiveEnabled: true, memories: [], hideBeforeMessageId: 12 } as CharacterProfile);
        const source = node(`memory-${mode}`, 2026, 11, 13, { charId: id, experiencedAt: noon(2026, 4, 10) });
        await MemoryNodeDB.save(source);
        localStorage.setItem(`mp_lastMsgId_${id}`, '45');
        const events = new EventTarget();
        const onSync = vi.fn();
        events.addEventListener(MEMORY_AUTO_ARCHIVE_SYNC_EVENT, onSync);
        vi.stubGlobal('window', events);
        const fetch = vi.fn();
        vi.stubGlobal('fetch', fetch);
        try {
            const result: PipelineResult = { stored: 1, skipped: 0, memories: [], batches: [], autoArchive: null };
            const sync = () => mode === 'startup' ? repairMissingAutoArchiveMemories(id) : persistAutoArchiveResult(id, result);
            expect(await Promise.all([sync(), sync()])).toEqual([{ changed: true, fragments: 1 }, { changed: false, fragments: 0 }]);
            const saved = await DB.getCharacter(id);
            expect(saved?.memories).toEqual([expect.objectContaining({ palaceMemoryId: source.id, date: '2026-04-10' })]);
            expect(saved?.hideBeforeMessageId).toBe(12);
            expect(localStorage.getItem(`mp_lastMsgId_${id}`)).toBe('45');
            expect(await MemoryNodeDB.getById(source.id)).toEqual(source);
            expect(fetch).not.toHaveBeenCalled();
            expect(onSync).toHaveBeenCalledTimes(1);
            expect(onSync.mock.calls[0][0].detail).toEqual({ charId: id, fragments: saved?.memories, hideBeforeMessageId: undefined });
            await DB.saveCharacter({ ...saved!, autoArchiveEnabled: false, memories: [] });
            expect(await sync()).toEqual({ changed: false, fragments: 0 });
            expect((await DB.getCharacter(id))?.memories).toEqual([]);
        } finally {
            vi.unstubAllGlobals();
            localStorage.removeItem(`mp_lastMsgId_${id}`);
        }
    });

    it.each(['chat', 'chat-tz', 'story'] as const)('真实整理入口保存节点并新增关联档案：%s', async source => {
        const charId = `archive-flow-${source}`;
        const customTimezoneEnabled = source !== 'chat';
        await DB.saveCharacter({
            id: charId, name: '角色', memories: [], memoryPalaceEnabled: true, autoArchiveEnabled: true,
            customTimezoneEnabled, customTimezone: 'America/New_York',
        } as unknown as CharacterProfile);
        const timestamp = customTimezoneEnabled ? Date.parse('2026-11-13T02:30:00Z') : noon(2026, 11, 13);
        await DB.saveMessage({
            charId, role: 'assistant', type: 'text', content: '在钟楼修好了钟表。', timestamp,
            metadata: source === 'story' ? { source: 'story_theater_memory', theaterTimelineTimestamp: noon(2026, 4, 10) } : undefined,
        });
        const config = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', dimensions: 3 };
        const prompts: string[] = [];
        const fetch = vi.fn(async (url: string, init: RequestInit) => {
            if (!url.endsWith('/embeddings')) prompts.push(String(JSON.parse(String(init.body)).messages[1].content));
            const data = url.endsWith('/embeddings')
                ? { data: [{ index: 0, embedding: [1, 0, 0] }] }
                : { choices: [{ message: { content: JSON.stringify([{ content: '我修好了钟表。', room: 'living_room', date: '2026-11-13', experienceSource: 'M0' }]) } }] };
            return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetch);
        try {
            const result = await processNewMessagesWithAutoArchive([], charId, '角色', config, config, '用户', true, undefined, {
                drainBuffer: true, retainRecentMessages: 0, requireAllBatches: true,
            });
            expect(result?.stored).toBe(1);
            const [memory] = await MemoryNodeDB.getByCharId(charId);
            const expectedDate = source === 'story' ? '2026-04-10' : source === 'chat-tz' ? '2026-11-12' : '2026-11-13';
            if (source === 'chat-tz') expect(prompts[0]).toContain('[2026-11-12 21:30]');
            expect(result?.autoArchive?.fragments).toEqual([expect.objectContaining({ palaceMemoryId: memory.id, date: expectedDate })]);
            expect((await DB.getCharacter(charId))?.memories).toEqual(result?.autoArchive?.fragments);
            expect(await persistAutoArchiveResult(charId, result)).toEqual({ fragments: 0, changed: false });
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('原文保留量为 0 时按缓冲阈值整理并推进水位线', async () => {
        const charId = 'archive-zero-hot-zone';
        await DB.saveCharacter({
            id: charId, name: '角色', memories: [], memoryPalaceEnabled: true, autoArchiveEnabled: true,
            memoryPalaceWaterline: { preset: 'custom', hotZoneSize: 0, bufferThreshold: 10 },
        } as CharacterProfile);
        const ids: number[] = [];
        for (let index = 1; index <= 9; index++) {
            ids.push(await DB.saveMessage({
                charId, role: 'user', type: 'text', content: `钟楼修理记录第 ${index} 条`,
            }));
        }
        const config = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test', dimensions: 3 };
        const fetch = vi.fn(async (url: string) => {
            const data = url.endsWith('/embeddings')
                ? { data: [{ index: 0, embedding: [1, 0, 0] }] }
                : { choices: [{ message: { content: JSON.stringify([{ content: '我记录了钟楼的维修过程。', room: 'living_room' }]) } }] };
            return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
        });
        vi.stubGlobal('fetch', fetch);
        try {
            const runArchive = () => processNewMessagesWithAutoArchive([], charId, '角色', config, config, '用户');
            expect(await runArchive()).toMatchObject({ skipReason: 'threshold' });
            expect(fetch).not.toHaveBeenCalled();

            await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '钟楼的维修记录已完成。' });
            expect(await runArchive()).toMatchObject({ stored: 1, processedMessages: 9 });
            expect(localStorage.getItem(`mp_lastMsgId_${charId}`)).toBe(String(ids[8]));
            fetch.mockClear();
            expect(await runArchive()).toMatchObject({ skipReason: 'threshold' });
            expect(fetch).not.toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
            localStorage.removeItem(`mp_lastMsgId_${charId}`);
        }
    });

    it('rejects a delayed auto archive for a palace node deleted before the write', async () => {
        const charId = 'archive-after-delete';
        const source = node('deleted-before-archive', 2026, 11, 13, { charId });
        await DB.saveCharacter({ id: charId, memoryPalaceEnabled: true, autoArchiveEnabled: true, memories: [] } as unknown as CharacterProfile);
        await MemoryNodeDB.save(source);
        const autoArchive = buildAutoArchiveFragments([source], 0, true);
        await deleteNodeAndLinkedArchive(source);
        await persistAutoArchiveResult(charId, { stored: 1, skipped: 0, memories: [source], batches: [], autoArchive });
        expect((await DB.getCharacter(charId))?.memories).toEqual([]);
    });
});
