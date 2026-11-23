import { getLocalDateKey } from '../localDate';
import { formatMemoryExperienceDate, getMemoryExperienceTime } from './memoryDate';
import type { MemoryNode } from './types';

export function searchMemoryByKeywords(nodes: MemoryNode[], query: string): MemoryNode[] {
    const keywords = query.trim().toLowerCase().split(/\s+/);
    return nodes
        .filter(node => {
            const dateKey = getLocalDateKey(new Date(getMemoryExperienceTime(node)));
            const text = [node.content, ...node.tags, node.mood, dateKey, formatMemoryExperienceDate(node)].join(' ').toLowerCase();
            return keywords.every(keyword => text.includes(keyword));
        })
        .sort((a, b) => b.importance - a.importance)
        .slice(0, 20);
}
