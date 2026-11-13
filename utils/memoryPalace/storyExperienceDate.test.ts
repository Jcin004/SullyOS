import { expect, it, vi } from 'vitest';
import { expandAndFormat } from './formatter';
import type { MemoryNode, ScoredMemory } from './types';

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
