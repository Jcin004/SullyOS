import type { Message } from '../types';
import type { MemoryNode } from './memoryPalace/types';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone } from './timezone';

export function getMemoryMessageClock(message: Message, timeZone?: string): Date {
    const plotTime: unknown = message.metadata?.source === 'story_theater_memory'
        ? message.metadata.theaterTimelineTimestamp : undefined;
    if (typeof plotTime === 'number') {
        const plotClock = new Date(plotTime);
        if (Number.isFinite(plotClock.getTime())) return plotClock;
    }
    return nowInTimeZone(timeZone, new Date(message.timestamp));
}

export function formatMemoryArchiveTime(clock: Date): string {
    const hours = String(clock.getHours()).padStart(2, '0');
    const minutes = String(clock.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
}

export function getDailyMemoryDate(
    memory: Pick<MemoryNode, 'createdAt' | 'experiencedAt' | 'dailyArchiveDate'>,
): string | undefined {
    if (memory.dailyArchiveDate) return memory.dailyArchiveDate;
    const clock = new Date(memory.experiencedAt ?? memory.createdAt);
    if (Number.isFinite(clock.getTime())) return getLocalDateKey(clock);
}
