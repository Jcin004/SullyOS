import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { expandAndFormat } from './formatter';
import { MemoryNodeDB } from './db';
import { retrieveMemories } from './pipeline';
import type { MemoryNode, ScoredMemory } from './types';

vi.mock('./hybridSearch', () => ({ hybridSearch: async () => [] }));

it('详情仅在有经历时间时展示 zh-CN 日期，仍保留创建和最后访问日期', () => {
    const source = readFileSync(new URL('../../apps/MemoryPalaceApp.tsx', import.meta.url), 'utf8');
    expect(source).toMatch(/创建:[^\n]+selectedNode\.createdAt[^\n]+\s+\{selectedNode\.experiencedAt != null && <div>经历时间：\{new Date\(selectedNode\.experiencedAt\)\.toLocaleString\('zh-CN'\)\}<\/div>\}\s+<div>最后访问:[^\n]+selectedNode\.lastAccessedAt/);
});

it('剧场和普通聊天用各自的现在格式化同一条记忆，旧节点继续读取 createdAt', async () => {
    const today = new Date(2026, 10, 13, 12).getTime();
    const scene = new Date(2026, 3, 13, 12).getTime();
    const experience = new Date(2026, 3, 10, 12).getTime();
    const now = vi.spyOn(Date, 'now').mockReturnValue(today);
    const node: MemoryNode = {
        id: 'experience-test', charId: 'experience-actor', content: '修好钟表', room: 'living_room',
        tags: [], importance: 5, mood: 'neutral', createdAt: today, experiencedAt: experience,
        lastAccessedAt: today, accessCount: 0, eventBoxId: null, embedded: false,
    };
    const scored = (memory: MemoryNode): ScoredMemory =>
        ({ node: memory, finalScore: 1, similarity: 1, bm25Score: 0, roomScore: 1 });
    const legacy = { ...node, id: 'old-experience-test', content: '旧记录', createdAt: experience, experiencedAt: undefined };
    try {
        await MemoryNodeDB.saveMany([node, legacy]);
        const recall = [scored(node), scored(legacy)];
        const theater = await expandAndFormat(recall, node.charId, [], undefined, undefined, { referenceTime: scene });
        expect(theater.match(/2026年4月10日（距今约3天）/g)).toHaveLength(2);
        expect(theater).toContain('### 记忆宫殿 (Memory Palace)');
        expect(theater).toContain('重要性: 5');
        const ordinary = await expandAndFormat(recall, node.charId);
        expect(ordinary.match(/2026年4月10日（距今约217天）/g)).toHaveLength(2);
        const fiction = await expandAndFormat(recall, node.charId, [], undefined, undefined, { omitDates: true, referenceTime: scene });
        expect(fiction).toContain('修好钟表');
        expect(fiction).not.toContain('距今');
    } finally {
        now.mockRestore();
    }
});

it('按经历日期召回，同一句昨天在剧场和普通聊天中命中不同的记忆', async () => {
    const realYesterday = new Date(2026, 10, 12, 12).getTime();
    const sceneToday = new Date(2026, 3, 11, 12).getTime();
    const charId = 'experience-date-retrieval';
    const legacy: MemoryNode = {
        id: 'date-retrieval-legacy', charId, content: '现实里寄出明信片', room: 'living_room',
        tags: [], importance: 5, mood: 'neutral', createdAt: realYesterday,
        lastAccessedAt: realYesterday, accessCount: 0, eventBoxId: null, embedded: true,
    };
    await MemoryNodeDB.saveMany([legacy, {
        ...legacy, id: 'date-retrieval-story', content: '剧情里修好钟表',
        experiencedAt: new Date(2026, 3, 10, 12).getTime(),
    }]);
    const embedding = { baseUrl: 'https://embedding.invalid', apiKey: 'test', model: 'test', dimensions: 2 };
    const now = vi.spyOn(Date, 'now').mockReturnValue(new Date(2026, 10, 13, 12).getTime());
    const retrieve = (query: string, referenceTime?: number) => retrieveMemories(
        [], charId, embedding, undefined, 'emotional', 0, query, undefined, undefined, undefined, undefined, { referenceTime },
    );
    try {
        const theater = await retrieve('昨天', sceneToday);
        expect(theater).toContain('剧情里修好钟表');
        expect(theater).not.toContain('现实里寄出明信片');
        expect(await retrieve('2026-04-10')).toContain('剧情里修好钟表');
        const ordinary = await retrieve('昨天');
        expect(ordinary).toContain('现实里寄出明信片');
        expect(ordinary).not.toContain('剧情里修好钟表');
    } finally {
        now.mockRestore();
    }
});
