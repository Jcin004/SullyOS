import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { getStoryRelationshipBaseline, reconcileStoryRelationships } from './storyTheaterRelationships';
import { loadStoryActorContext, replaceStoryTheaterReply } from './storyTheaterReply';

describe('剧情重写上下文和保存', () => {
    it('本剧情的用户/助手镜像都不回流，仍保留其他来源和剧情的可见原文', async () => {
        const char = { id: 'reroll-actor', contextRangeMode: 'manual', contextLimit: 20, contextRangePolicyVersion: 1 } as CharacterProfile;
        for (const [content, metadata] of [
            ['私聊', { source: 'chat' }],
            ['别的剧情', { source: 'story_theater_memory', theaterId: 'other' }],
            ['本轮输入', { source: 'story_theater_memory', theaterId: 'current' }],
            ['旧回复', { source: 'story_theater_memory', theaterId: 'current' }],
        ] as const) await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content, metadata });
        expect((await loadStoryActorContext(char, 'current', 20)).map(message => message.content)).toEqual(['私聊', '别的剧情']);
    });
    const seed = async (id: string): Promise<Message> => {
        const centralId = await DB.saveMessage({ charId: id, role: 'assistant', type: 'text', content: '旧回复' });
        const mirrorId = await DB.saveMessage({ charId: id + '-actor', role: 'assistant', type: 'text', content: '旧回复' });
        await DB.updateMessageMetadata(centralId, () => ({ theaterMirrorIds: { actor: mirrorId } }));
        return (await DB.getMessagesByCharId(id, true)).find(row => row.id === centralId)!;
    };
    it('成功后原位原子替换，中央正文和镜像不会多出一条', async () => {
        const old = await seed('reroll-save');
        await replaceStoryTheaterReply(old, '新回复', { theaterPromptTokens: 123 });
        const rows = await DB.getMessagesByCharId(old.charId, true);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: old.id, content: '新回复', metadata: { theaterPromptTokens: 123 } });
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('新回复');
    });
    it('从被替换回复之前的双向关系重算，并用新结果替换旧记录', async () => {
        const thread = 'reroll-relationship';
        const u = { id: 'u', name: '小雨' };
        const c = { id: 'c', name: '阿泽' };
        const panel = '<relationship_panel>' + JSON.stringify({
            primaryId: u.id, state_note: '先听对方说完',
            relationships: [{ fromId: u.id, toId: c.id, axes: { FL: { score: 30 } } }],
        }) + '</relationship_panel>';
        await DB.saveMessage({ charId: thread, role: 'assistant', type: 'text', content: '前一轮' + panel });
        const target = await seed(thread);
        const rows = await DB.getMessagesByCharId(thread, true);
        const history = rows.filter(row => row.id !== target.id);
        const baseline = getStoryRelationshipBaseline(history, u, [u, c]);
        const alternative = (delta: number) => reconcileStoryRelationships(
            '新正文<relationship_panel>' + JSON.stringify({ primaryId: u.id, relationships: [{
                fromId: u.id, toId: c.id,
                axes: { FL: { delta, trigger: '在雨中等待', evidence: '对方实践了约定' } },
            }] }) + '</relationship_panel>', baseline,
        );
        await replaceStoryTheaterReply(target, alternative(4), {});
        const updated = await DB.getMessagesByCharId(thread, true);
        expect(updated).toHaveLength(2);
        expect(getStoryRelationshipBaseline(updated, u, [u, c]).relationships[1].axes.FL?.score).toBe(34);
        const latest = updated.find(row => row.id === target.id)!;
        await replaceStoryTheaterReply(latest, alternative(2), {});
        const rerolled = getStoryRelationshipBaseline(await DB.getMessagesByCharId(thread, true), u, [u, c]);
        expect(rerolled.relationships[1].axes.FL?.score).toBe(32);
        expect(rerolled.state_note).toBe('先听对方说完');
    });
    it('任意镜像在请求期间被编辑，整个事务回滚保留用户修改和原正文', async () => {
        const old = await seed('reroll-conflict');
        const mirrorId = Number((old.metadata?.theaterMirrorIds as Record<string, number>).actor);
        await DB.updateMessage(mirrorId, '手动编辑');
        await expect(replaceStoryTheaterReply(old, '新回复', {})).rejects.toThrow('已被修改');
        expect((await DB.getMessagesByCharId(old.charId, true))[0].content).toBe('旧回复');
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('手动编辑');
    });
});
