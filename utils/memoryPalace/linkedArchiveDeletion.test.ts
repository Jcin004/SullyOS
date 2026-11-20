// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../db';
import { EventBoxDB, MemoryNodeDB } from './db';
import { expandAndFormat } from './formatter';
import { vectorSearch } from './vectorSearch';
import type { CharacterProfile, MemoryFragment } from '../../types';
import type { MemoryNode } from './types';
import { askLinkedArchiveDeletion, deleteNodeAndLinkedArchive, LINKED_ARCHIVE_DELETED } from './linkedArchiveDeletion';

afterEach(() => { vi.restoreAllMocks(); document.querySelectorAll('dialog').forEach(dialog => dialog.remove()); });
async function seed(id: string) {
    const node: MemoryNode = { id, charId: `char-${id}`, content: '宫殿后来修改的内容', createdAt: 1, room: 'living_room', tags: [], importance: 5, mood: '', embedded: false, lastAccessedAt: 1, accessCount: 0 };
    const memories: MemoryFragment[] = [
        { id: 'linked', date: '2026-09-16', summary: '最初的快照', mood: 'palace', palaceMemoryId: id },
        { id: 'legacy', date: '2026-09-16', summary: '最初的快照', mood: 'palace' },
        { id: 'unrelated', date: '2026-09-16', summary: '其他关联', palaceMemoryId: 'other-node' },
    ];
    await DB.saveCharacter({ id: node.charId, name: '测试', memories } as CharacterProfile);
    await MemoryNodeDB.save(node);
    return { node, memories };
}
describe('palace deletion archive choice', () => {
    it('removes a deleted archived member from recall without losing the rest of the box', async () => {
        const { node } = await seed('delete-box-member');
        const boxId = 'delete-box';
        const remaining = { ...node, id: 'remaining', content: '保留的经历', eventBoxId: boxId, archived: true };
        const summary = { ...remaining, id: 'summary', content: '含有已删除经历的旧摘要', isBoxSummary: true, archived: false };
        await MemoryNodeDB.save({ ...node, eventBoxId: boxId, archived: true });
        await MemoryNodeDB.save(remaining);
        await MemoryNodeDB.save(summary);
        await EventBoxDB.save({
            id: boxId, charId: node.charId, name: '已删除经历标题', tags: ['已删除经历标签'],
            summaryNodeId: summary.id, archivedMemoryIds: [node.id, remaining.id], liveMemoryIds: [],
            compressionCount: 1, createdAt: 1, updatedAt: 1, lastCompressedAt: 1,
        });
        await deleteNodeAndLinkedArchive(node, 'delete');
        const prompt = await expandAndFormat([{
            node: remaining, finalScore: 1, similarity: 1, bm25Score: 0, roomScore: 1,
        }], node.charId);
        expect(prompt).toContain(remaining.content);
        expect(prompt).not.toContain('已删除经历');
        expect(await MemoryNodeDB.getById(summary.id)).toMatchObject({ archived: true, content: summary.content });
        expect(await MemoryNodeDB.getById(remaining.id)).toMatchObject({ archived: false, content: remaining.content });
    });
    it('uses only current local nodes when Supabase still returns deleted or archived candidates', async () => {
        const { node: surviving } = await seed('remote-surviving');
        const remoteRows = [
            { memory_id: 'deleted', content: 'deleted candidate', similarity: 0.99 },
            { memory_id: 'retired', content: 'retired summary', similarity: 0.98 },
            { memory_id: surviving.id, content: 'stale copy', similarity: 0.97 },
        ];
        await MemoryNodeDB.save({ ...surviving, id: 'retired', archived: true });
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(remoteRows))));
        try {
            const hits = await vectorSearch([1, 0], surviving.charId, 0.3, 20, {
                enabled: true, initialized: true, supabaseUrl: 'https://example.test', supabaseAnonKey: 'test',
            });
            expect(hits.map(hit => hit.node)).toEqual([surviving]);
        } finally {
            vi.unstubAllGlobals();
        }
    });
    it('yes deletes only explicit linked archives and the source node', async () => {
        const { node, memories } = await seed('delete-yes');
        const event = vi.fn(); window.addEventListener(LINKED_ARCHIVE_DELETED, event);
        try {
            await deleteNodeAndLinkedArchive(node, 'delete');
            expect(await MemoryNodeDB.getById(node.id)).toBeUndefined();
            expect((await DB.getCharacter(node.charId))?.memories).toEqual(memories.slice(1));
            expect(event).toHaveBeenCalledTimes(1);
        } finally { window.removeEventListener(LINKED_ARCHIVE_DELETED, event); }
    });
    it('no detaches links and keeps the original snapshot instead of current palace text', async () => {
        const { node, memories } = await seed('delete-no');
        await deleteNodeAndLinkedArchive(node, 'keep');
        const saved = (await DB.getCharacter(node.charId))!.memories!;
        expect(saved[0]).toEqual({ id: 'linked', date: '2026-09-16', summary: '最初的快照', mood: 'palace' });
        expect(saved.slice(1)).toEqual(memories.slice(1));
        expect(await MemoryNodeDB.getById(node.id)).toBeUndefined();
    });
    it('aborts both writes if a new link appears without an explicit choice', async () => {
        const { node, memories } = await seed('delete-no-choice');
        await expect(deleteNodeAndLinkedArchive(node)).rejects.toThrow('重新删除');
        expect(await MemoryNodeDB.getById(node.id)).toEqual(node);
        expect((await DB.getCharacter(node.charId))?.memories).toEqual(memories);
    });
    it.each([
        ['是，删除', 'delete'], ['否，取消链接并保留原始快照', 'keep'], ['取消本次删除', null],
    ])('dialog action %s resolves the corresponding choice', async (label, choice) => {
        HTMLDialogElement.prototype.showModal = vi.fn();
        HTMLDialogElement.prototype.close = vi.fn();
        const answer = askLinkedArchiveDeletion();
        const dialog = document.querySelector('dialog')!;
        expect(dialog.textContent).toContain('神经链接的日度记忆中，有该记忆的备份');
        [...dialog.querySelectorAll('button')].find(button => button.textContent === label)!.click();
        expect(await answer).toBe(choice); expect(document.querySelector('dialog')).toBeNull();
    });
    it('Escape cancels the whole deletion instead of selecting keep', async () => {
        HTMLDialogElement.prototype.showModal = vi.fn(); HTMLDialogElement.prototype.close = vi.fn();
        const answer = askLinkedArchiveDeletion();
        document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
        expect(await answer).toBeNull();
    });
});
