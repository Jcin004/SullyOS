import type { CharacterProfile, MemoryFragment } from '../../types';
import { openDB } from '../db';
import { bm25Index } from './bm25Index';
import { notifyMemoryNodesChanged } from './nodeChanges';
import type { EventBox, MemoryNode, RemoteVectorConfig } from './types';

export type LinkedArchiveDeletionChoice = 'delete' | 'keep';
export const LINKED_ARCHIVE_DELETED = 'sully:linked-archive-deleted';
export interface LinkedArchiveDeletionDetail { charId: string; nodeId: string; choice: LinkedArchiveDeletionChoice }

export function applyLinkedArchiveDeletion(memories: MemoryFragment[], nodeId: string, choice: LinkedArchiveDeletionChoice): MemoryFragment[] {
    if (choice === 'delete') return memories.filter(memory => memory.palaceMemoryId !== nodeId);
    return memories.map(memory => {
        if (memory.palaceMemoryId !== nodeId) return memory;
        // Keep the original archive snapshot, not the current palace text.
        const { palaceMemoryId: _link, ...snapshot } = memory;
        return snapshot;
    });
}

/** Commit the source deletion and the explicit archive decision together. */
export async function deleteNodeAndLinkedArchive(
    node: MemoryNode, choice?: LinkedArchiveDeletionChoice, remote?: RemoteVectorConfig,
): Promise<void> {
    const db = await openDB();
    let changed = false;
    const archivedSummaries: string[] = [];
    const restoredNodes: MemoryNode[] = [];
    await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['memory_nodes', 'memory_vectors', 'memory_links', 'event_boxes', 'characters'], 'readwrite');
        const characters = tx.objectStore('characters');
        const nodes = tx.objectStore('memory_nodes');
        const boxes = tx.objectStore('event_boxes');
        let failure: Error | undefined;
        const request = characters.get(node.charId);
        request.onsuccess = () => {
            const character = request.result as CharacterProfile | undefined;
            if (character?.memories?.some(memory => memory.palaceMemoryId === node.id)) {
                if (!choice) {
                    failure = new Error('此记忆刚刚新增了日度档案关联，请重新删除并选择是否同步删除');
                    tx.abort(); return;
                }
                characters.put({ ...character, memories: applyLinkedArchiveDeletion(character.memories, node.id, choice) });
                changed = true;
            }
            const readNode = nodes.get(node.id);
            readNode.onsuccess = () => {
                const current = readNode.result as MemoryNode | undefined;
                if (!current) return;
                if (current.charId !== node.charId) {
                    failure = new Error('记忆所属角色已变更，请重新删除');
                    tx.abort();
                    return;
                }
                if (current.eventBoxId) {
                    const readBox = boxes.get(current.eventBoxId);
                    readBox.onsuccess = () => {
                        const box = readBox.result as EventBox | undefined;
                        if (!box || box.charId !== current.charId) return;
                        const wasSummarized = box.archivedMemoryIds.includes(current.id);
                        const deletingSummary = box.summaryNodeId === current.id;
                        box.liveMemoryIds = box.liveMemoryIds.filter(id => id !== current.id);
                        box.archivedMemoryIds = box.archivedMemoryIds.filter(id => id !== current.id);
                        box.updatedAt = Date.now();
                        box.name = '未命名事件';
                        box.tags = [];
                        if (deletingSummary) box.summaryNodeId = null;
                        if (wasSummarized || deletingSummary) {
                            box.lastCompressedAt = null;
                            if (box.summaryNodeId) {
                                const readSummary = nodes.get(box.summaryNodeId);
                                readSummary.onsuccess = () => {
                                    const summary = readSummary.result as MemoryNode | undefined;
                                    if (summary?.charId !== current.charId || summary.eventBoxId !== box.id) return;
                                    nodes.put({ ...summary, archived: true });
                                    archivedSummaries.push(summary.id);
                                };
                            }
                            // Keep the remaining source memories available while the old summary is retired.
                            for (const id of box.archivedMemoryIds) {
                                const readMember = nodes.get(id);
                                readMember.onsuccess = () => {
                                    const member = readMember.result as MemoryNode | undefined;
                                    if (member?.charId !== current.charId || member.eventBoxId !== box.id || member.isBoxSummary) return;
                                    const restored = { ...member, archived: false };
                                    nodes.put(restored);
                                    restoredNodes.push(restored);
                                };
                            }
                            box.liveMemoryIds = [...new Set([...box.liveMemoryIds, ...box.archivedMemoryIds])];
                            box.archivedMemoryIds = [];
                        }
                        if (!box.summaryNodeId && !box.liveMemoryIds.length && !box.archivedMemoryIds.length) boxes.delete(box.id);
                        else boxes.put(box);
                    };
                }
                const links = tx.objectStore('memory_links');
                for (const index of ['sourceId', 'targetId']) {
                    const cursor = links.index(index).openKeyCursor(IDBKeyRange.only(current.id));
                    cursor.onsuccess = () => {
                        const match = cursor.result;
                        if (!match) return;
                        links.delete(match.primaryKey);
                        match.continue();
                    };
                }
                tx.objectStore('memory_vectors').delete(current.id);
                nodes.delete(current.id);
            };
        };
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(failure || tx.error);
        tx.onabort = () => reject(failure || tx.error || new Error('删除未完成'));
    });
    bm25Index.onNodeDeleted(node.id);
    bm25Index.onNodesSaved(restoredNodes);
    if (changed && choice && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent<LinkedArchiveDeletionDetail>(LINKED_ARCHIVE_DELETED, {
            detail: { charId: node.charId, nodeId: node.id, choice },
        }));
    }
    notifyMemoryNodesChanged(node.charId);
    if (remote?.enabled && remote.initialized) {
        const { bulkSetArchived, deleteVector } = await import('./supabaseVector');
        void deleteVector(remote, node.id).catch(() => {});
        if (archivedSummaries.length) void bulkSetArchived(remote, archivedSummaries, true).catch(() => {});
        if (restoredNodes.length) void bulkSetArchived(remote, restoredNodes.map(member => member.id), false).catch(() => {});
    }
}

/** A separate cancel action means dismissing the dialog never means “keep and delete”. */
export function askLinkedArchiveDeletion(): Promise<LinkedArchiveDeletionChoice | null> {
    return new Promise(resolve => {
        const previousFocus = document.activeElement;
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', '同步删除日度记忆');
        dialog.style.cssText = 'max-width:360px;width:calc(100% - 40px);padding:24px;border:1px solid #e2e8f0;border-radius:20px;background:white;color:#334155;box-shadow:0 20px 80px #0005;';
        const message = document.createElement('p');
        message.textContent = '神经链接的日度记忆中，有该记忆的备份，您需要同步删除吗？';
        message.style.cssText = 'font-size:15px;line-height:1.7;margin:0 0 16px;';
        dialog.append(message);
        let settled = false;
        const finish = (choice: LinkedArchiveDeletionChoice | null) => {
            if (settled) return;
            settled = true; dialog.close(); dialog.remove();
            if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
            resolve(choice);
        };
        for (const [label, choice] of [
            ['是，删除', 'delete'],
            ['否，取消链接并保留原始快照', 'keep'],
            ['取消本次删除', null],
        ] as const) {
            const button = document.createElement('button');
            button.textContent = label; button.type = 'button';
            button.style.cssText = `display:block;width:100%;padding:12px;margin-top:8px;border:0;border-radius:12px;font-size:14px;cursor:pointer;background:${choice === 'delete' ? '#fef2f2' : '#f1f5f9'};color:${choice === 'delete' ? '#b91c1c' : '#334155'};`;
            button.onclick = () => finish(choice);
            // Initial focus on cancel avoids accidental Enter deleting a backup.
            if (choice === null) button.autofocus = true;
            dialog.append(button);
        }
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        document.body.append(dialog);
        dialog.showModal();
    });
}
