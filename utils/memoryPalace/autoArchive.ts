import type { CharacterProfile, MemoryFragment } from '../../types';
import { DB, openDB } from '../db';
import { MemoryNodeDB } from './db';
import type { MemoryNode } from './types';
import {
    buildAutoArchiveFragments,
    getMemoryPalaceHighWaterMark,
    mergePalaceFragmentsIntoMemories,
    processNewMessages,
    type PipelineResult,
} from './pipeline';

/**
 * React 外的记忆后处理完成后，用这个事件把刚落进 IndexedDB 的传统记忆同步回 OSContext。
 * detail 只带增量，OSContext 会基于自己那份最新角色状态再 merge，避免整对象回灌覆盖其它字段。
 */
export const MEMORY_AUTO_ARCHIVE_SYNC_EVENT = 'memory-auto-archive-synced';

export type AutoArchiveFragment = NonNullable<PipelineResult['autoArchive']>['fragments'][number];

export interface MemoryAutoArchiveSyncDetail {
    charId: string;
    fragments: AutoArchiveFragment[];
    hideBeforeMessageId?: number;
}

const persistChains = new Map<string, Promise<unknown>>();

function enqueuePersist<T>(charId: string, task: () => Promise<T>): Promise<T> {
    const previous = persistChains.get(charId) || Promise.resolve();
    const current = previous.catch(() => undefined).then(task);
    persistChains.set(charId, current);
    void current.finally(() => {
        if (persistChains.get(charId) === current) persistChains.delete(charId);
    }).catch(() => undefined);
    return current;
}

function dispatchSync(detail: MemoryAutoArchiveSyncDetail): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent<MemoryAutoArchiveSyncDetail>(MEMORY_AUTO_ARCHIVE_SYNC_EVENT, { detail }));
}

async function writeAutoArchive(
    charId: string,
    getFragments: (current: MemoryFragment[]) => AutoArchiveFragment[],
    hideBeforeMessageId = 0,
): Promise<{ fragments: number; changed: boolean }> {
    const db = await openDB();
    const detail = await new Promise<MemoryAutoArchiveSyncDetail | undefined>((resolve, reject) => {
        const tx = db.transaction('characters', 'readwrite');
        const store = tx.objectStore('characters');
        const request = store.get(charId);
        let change: MemoryAutoArchiveSyncDetail | undefined;
        let failure: unknown;
        tx.oncomplete = () => resolve(change);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error('神经链接档案保存失败'));
        request.onsuccess = () => {
            const character = request.result as CharacterProfile | undefined;
            if (!character?.memoryPalaceEnabled || !character.autoArchiveEnabled) return;
            const current: MemoryFragment[] = character.memories || [];
            try {
                const ids = new Set(current.map(memory => memory.id));
                const linked = new Set(current.map(memory => memory.palaceMemoryId));
                const fragments = getFragments(current).filter(fragment =>
                    !ids.has(fragment.id) && (!fragment.palaceMemoryId || !linked.has(fragment.palaceMemoryId)));
                const hideChanged = hideBeforeMessageId > (character.hideBeforeMessageId || 0);
                if (!fragments.length && !hideChanged) return;
                change = { charId, fragments, hideBeforeMessageId: hideChanged ? hideBeforeMessageId : undefined };
                store.put({
                    ...character,
                    ...(fragments.length ? { memories: mergePalaceFragmentsIntoMemories(current, fragments) } : {}),
                    ...(hideChanged ? { hideBeforeMessageId } : {}),
                });
            } catch (error) {
                failure = error;
                tx.abort();
            }
        };
    });
    if (!detail) return { fragments: 0, changed: false };
    dispatchSync(detail);
    return { fragments: detail.fragments.length, changed: true };
}

/**
 * 把 processNewMessages 的自动归档建议真正写入角色档案。
 *
 * 过去这一步散落在 React 调用方：Push、彼方、家园等入口只接了宫殿写入，忘了接返回值，
 * 于是出现“宫殿有总结、神经链接没副本”。现在所有自动入口统一走本函数。
 */
export function persistAutoArchiveResult(
    charId: string,
    result: PipelineResult | null,
): Promise<{ fragments: number; changed: boolean }> {
    if (!result || result.skipReason === 'lock') {
        return Promise.resolve({ fragments: 0, changed: false });
    }

    return enqueuePersist(charId, async () => {
        const character = await DB.getCharacter(charId);
        if (!character?.memoryPalaceEnabled || !character.autoArchiveEnabled) {
            return { fragments: 0, changed: false };
        }

        const fragments = result.autoArchive?.fragments ?? [];
        if (!fragments.length && result.stored > 0) {
            const nodes = await MemoryNodeDB.getByCharId(charId);
            return writeAutoArchive(charId, current => buildConservativeRepairFragments(current, nodes));
        }
        const nextHide = Math.max(
            result.autoArchive?.hideBeforeMessageId || 0,
            getMemoryPalaceHighWaterMark(charId),
        );
        return writeAutoArchive(charId, () => fragments, nextHide);
    });
}

/** 自动总结的唯一常规入口：宫殿写入成功后，紧接着完成神经链接双写。 */
export async function processNewMessagesWithAutoArchive(
    ...args: Parameters<typeof processNewMessages>
): Promise<PipelineResult | null> {
    const result = await processNewMessages(...args);
    await persistAutoArchiveResult(args[1], result);
    return result;
}

/** 只从已向量化的个人提取节点补缺失关联，保留旧日度档案。 */
export function buildConservativeRepairFragments(
    existing: MemoryFragment[],
    nodes: MemoryNode[],
): AutoArchiveFragment[] {
    const linked = new Set(existing.map(memory => memory.palaceMemoryId));
    const candidates = nodes.filter(node => {
        if (linked.has(node.id) || node.embedded === false || node.origin !== 'extraction'
            || node.groupId || node.isBoxSummary || node.sourceId) return false;
        return !!node.content?.trim() && Number.isFinite(new Date(node.experiencedAt ?? node.createdAt).getTime());
    });
    return buildAutoArchiveFragments(candidates, 0, true)?.fragments ?? [];
}

/** 启动时跑一次的旧缺口修复；不调 LLM、不重做向量、不改宫殿水位线。 */
export function repairMissingAutoArchiveMemories(
    charId: string,
): Promise<{ fragments: number; changed: boolean }> {
    return enqueuePersist(charId, async () => {
        const character = await DB.getCharacter(charId);
        if (!character?.memoryPalaceEnabled || !character.autoArchiveEnabled) {
            return { fragments: 0, changed: false };
        }

        const nodes = await MemoryNodeDB.getByCharId(charId);
        return writeAutoArchive(charId, current => buildConservativeRepairFragments(current, nodes));
    });
}
