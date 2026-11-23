import { expect, it } from 'vitest';
import { searchMemoryByKeywords } from './keywordSearch';
import { formatMemoryExperienceDate } from './memoryDate';
import type { MemoryNode } from './types';

it('宫殿搜索支持日期和关键词混搜，并沿用重要性排序', () => {
    const legacy: MemoryNode = {
        id: 'legacy', charId: 'search-actor', content: '海边车站告别', room: 'living_room',
        tags: ['旅行'], importance: 8, mood: 'neutral', embedded: true,
        createdAt: new Date(2026, 10, 12, 12).getTime(), lastAccessedAt: 0, accessCount: 0,
    };
    const story = { ...legacy, id: 'story', importance: 5, experiencedAt: new Date(2026, 3, 10, 12).getTime() };
    const nodes = [story, legacy];
    expect(searchMemoryByKeywords(nodes, '2026-04 旅行')).toEqual([story]);
    expect(searchMemoryByKeywords(nodes, '2026-04-10 海边')).toEqual([story]);
    expect(searchMemoryByKeywords(nodes, formatMemoryExperienceDate(story))).toEqual([story]);
    expect(searchMemoryByKeywords(nodes, '2026-11-12')).toEqual([legacy]);
    expect(searchMemoryByKeywords(nodes, '车站')).toEqual([legacy, story]);
});
