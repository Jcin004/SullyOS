import type { Message, StoryTheaterEntry } from '../types';

export type StoryRelationshipScope = 'real' | `theater:${string}`;
type WorldEntry = Pick<StoryTheaterEntry, 'id' | 'writesToCharacterMemory'>;

export const storyRelationshipScope = (entry: WorldEntry): StoryRelationshipScope =>
    entry.writesToCharacterMemory ? 'real' : `theater:${entry.id}`;

export interface StoryRelationshipHistory {
    scope: StoryRelationshipScope;
    messages: Message[];
    signature: string;
    exists: boolean;
}

export interface StoryRelationshipGuard {
    entry: WorldEntry;
    signature: string;
}

/** Only central originals with a known owner may contribute; folders, mirrors and recall never do. */
export function selectStoryRelationshipHistory(
    entries: readonly WorldEntry[], rows: readonly Message[], entry: WorldEntry,
): StoryRelationshipHistory {
    const scope = storyRelationshipScope(entry);
    const owners = new Map(entries.map(item => [item.id, item]));
    const exists = owners.has(entry.id) && storyRelationshipScope(owners.get(entry.id)!) === scope;
    const messages = rows.filter(row => {
        const owner = owners.get(row.metadata?.theaterId);
        if (!owner || row.charId !== `story-theater:${owner.id}` || row.metadata?.source !== 'story_theater'
            || row.role !== 'assistant' || row.type !== 'text' || row.groupId || row.metadata.theaterOutOfStory
            || storyRelationshipScope(owner) !== scope || !hasRelationshipPanel(row)) return false;
        const stamped = row.metadata.theaterRelationshipScope;
        return stamped === undefined || stamped === scope;
    }).sort((a, b) => a.id - b.id);
    // Archive flags, summaries and timestamps don't change a relationship event or its commit order.
    const signature = JSON.stringify([scope, exists, messages.map(row => [row.id, row.content,
        row.metadata.theaterId, row.metadata.theaterRelationshipScope, row.metadata.theaterCastIds])]);
    return { scope, messages, signature, exists };
}

/** Shared by the read snapshot and the write transaction's optimistic concurrency check. */
export function readStoryRelationshipHistory(
    tx: IDBTransaction, entry: WorldEntry, done: (history: StoryRelationshipHistory) => void,
): void {
    const stories = tx.objectStore('story_theaters').getAll();
    stories.onsuccess = () => {
        const entries = stories.result as StoryTheaterEntry[];
        const peers = entries.filter(item => storyRelationshipScope(item) === storyRelationshipScope(entry));
        const rows: Message[] = [];
        let pending = peers.length;
        if (!pending) { done(selectStoryRelationshipHistory(entries, rows, entry)); return; }
        const store = tx.objectStore('messages');
        for (const peer of peers) {
            const request = store.indexNames.contains('charId_source')
                ? store.index('charId_source').openCursor(IDBKeyRange.only([`story-theater:${peer.id}`, 'story_theater']))
                : store.index('charId').openCursor(IDBKeyRange.only(`story-theater:${peer.id}`));
            request.onsuccess = () => {
                const cursor = request.result;
                if (cursor) {
                    const row = cursor.value as Message;
                    if (hasRelationshipPanel(row)) rows.push(row);
                    cursor.continue();
                    return;
                }
                if (--pending === 0) done(selectStoryRelationshipHistory(entries, rows, entry));
            };
        }
    };
}

const hasRelationshipPanel = (row: Message) => /<(?:affinity_panel|relationship_panel)\b/i.test(row.content);

export function checkStoryRelationshipGuard(history: StoryRelationshipHistory, guard: StoryRelationshipGuard): void {
    if (!history.exists || history.signature !== guard.signature) {
        throw new Error('同一世界的关系历史已更新或剧场已变更，请重试以使用最新关系；本次未保存');
    }
}
