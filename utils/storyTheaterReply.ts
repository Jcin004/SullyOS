import type { CharacterProfile, Message, StoryTheaterEntry } from '../types';
import { DB, openDB } from './db';
import { loadCharacterContextMessages } from './chatContextRange';
import { storyTimelineTimestampForCharacter } from './storyTheater';
import { readStoryRelationshipHistory, checkStoryRelationshipGuard, type StoryRelationshipGuard } from './storyRelationshipHistory';
import { stripStoryRelationshipPanels, storyTheaterMirrorContent } from './storyTheaterRelationships';
import { syncRealRelationshipMessage, checkRealRelationshipGuard, realRelationshipTransactionError } from './realRelationshipStore';

export async function loadStoryMirrorTimeline(
    entry: StoryTheaterEntry, actorId: string, newestFirst: readonly Message[],
): Promise<number | undefined> {
    for (const layer of newestFirst) {
        const id = layer.metadata?.theaterMirrorIds?.[actorId];
        if (!Number.isSafeInteger(id) || id <= 0) continue;
        const mirror = await DB.getMessageById(id);
        const time: unknown = mirror?.metadata?.theaterTimelineTimestamp;
        if (mirror?.charId === actorId && mirror.metadata?.source === 'story_theater_memory'
            && mirror.metadata?.theaterId === entry.id
            && (mirror.metadata.theaterCentralId == null || mirror.metadata.theaterCentralId === layer.id)
            && typeof time === 'number' && Number.isFinite(new Date(time).getTime())) {
            return storyTimelineTimestampForCharacter(entry, actorId, time);
        }
    }
    return storyTimelineTimestampForCharacter(entry, actorId);
}

/** 本剧情原文已有独立历史槽位，角色镜像不得重复注入或带回待重写回复。 */
export async function loadStoryActorContext(
    char: CharacterProfile,
    theaterId: string,
    currentStoryMessages: readonly Message[] = [],
): Promise<Message[]> {
    const currentMirrors = new Set(currentStoryMessages.map(message => {
        const mirrorIds = message.metadata?.theaterMirrorIds as Record<string, number> | undefined;
        return Number(mirrorIds?.[char.id]);
    }));
    const messages = await loadCharacterContextMessages(char);
    return messages.filter(message => !currentMirrors.has(message.id)
        && !(message.metadata?.source === 'story_theater_memory' && message.metadata?.theaterId === theaterId))
        .map(message => message.role === 'assistant' ? { ...message, content: stripStoryRelationshipPanels(message.content) } : message);
}

export const STORY_REROLL_INSTRUCTION = '本轮是重新生成：从同一处故事落点重新写这一轮，换一个合理的切入角度、对白和细节展开；保留已确立的事实和用户输入，不把这次操作写进故事，不把尚未发生的旧版本当作既定经历。';

/** 成功后一次事务替换正文和镜像；失败/并发编辑时保留原文，不先删后写。 */
export async function replaceStoryTheaterReply(
    original: Message, content: string, metadata: Record<string, unknown>, requireLatest = false,
    timelineByActor?: ReadonlyMap<string, number | undefined>,
    relationshipGuard?: StoryRelationshipGuard,
): Promise<void> {
    const mirrorIds = Object.values((original.metadata?.theaterMirrorIds || {}) as Record<string, number>).map(Number).filter(id => Number.isFinite(id) && id > 0);
    const ids = [...new Set([original.id, ...mirrorIds])];
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(['messages', 'story_theaters', 'assets'], 'readwrite');
        const store = transaction.objectStore('messages');
        let failure: Error | undefined;
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(failure || realRelationshipTransactionError(transaction) || new Error('重写保存失败，原回复已保留'));
        const replace = () => {
            for (const id of ids) {
                const request = store.get(id);
                request.onsuccess = () => {
                    const current = request.result as Message | undefined;
                    const expected = id === original.id ? original.content : storyTheaterMirrorContent(original);
                    if (!current || current.content !== expected || (id === original.id
                        && current.metadata?.theaterInputRevision !== original.metadata?.theaterInputRevision)) {
                        failure = new Error('这条回复已被修改或删除，请刷新后重试');
                        transaction.abort();
                        return;
                    }
                    const nextMetadata = id === original.id ? { ...current.metadata, ...metadata }
                        : timelineByActor?.has(current.charId) && current.metadata?.source === 'story_theater_memory'
                            ? { ...current.metadata, theaterTimelineTimestamp: timelineByActor.get(current.charId) }
                            : current.metadata;
                    const nextContent = id === original.id ? content : storyTheaterMirrorContent({ ...original, content, metadata: { ...original.metadata, ...metadata } });
                    const updated = { ...current, content: nextContent, metadata: nextMetadata };
                    if (id === original.id && relationshipGuard?.signature.startsWith('real-graph:')) {
                        syncRealRelationshipMessage(transaction, updated,
                            content => store.put({ ...updated, content }), original.content);
                    } else store.put(updated).onsuccess = () => syncRealRelationshipMessage(transaction, updated);
                };
            }
        };
        const commit = () => {
            if (!requireLatest) { replace(); return; }
            const latest = store.index('charId').openCursor(IDBKeyRange.only(original.charId), 'prev');
            latest.onsuccess = () => {
                const cursor = latest.result;
                if (cursor && cursor.value.metadata?.source !== 'story_theater') { cursor.continue(); return; }
                if (!cursor || cursor.primaryKey !== original.id) {
                    failure = new Error('剧情已在别处推进，原回复已保留');
                    transaction.abort();
                    return;
                }
                replace();
            };
        };
        if (relationshipGuard?.signature.startsWith('real-graph:')) {
            if (metadata.theaterRelationshipScope !== 'real' || original.metadata?.theaterId !== relationshipGuard.entry.id) {
                failure = new Error('真实关系归属不匹配'); transaction.abort(); return;
            }
            checkRealRelationshipGuard(transaction, relationshipGuard.entry, relationshipGuard.signature, commit);
        } else if (relationshipGuard) readStoryRelationshipHistory(transaction, relationshipGuard.entry, history => {
            try {
                checkStoryRelationshipGuard(history, relationshipGuard);
                if (original.metadata?.theaterId !== relationshipGuard.entry.id
                    || metadata.theaterRelationshipScope !== history.scope) throw new Error('关系世界归属不匹配，本次未保存');
                commit();
            } catch (error) { failure = error as Error; transaction.abort(); }
        });
        else commit();
    });
}
