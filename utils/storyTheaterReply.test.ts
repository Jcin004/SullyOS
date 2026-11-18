import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { loadStoryActorContext, loadStoryMirrorTimeline, replaceStoryTheaterReply } from './storyTheaterReply';
import { createStoryTheaterDraft, createStoryTheaterMirrorMessage, normalizeStoryTheater } from './storyTheater';

describe('剧情重写上下文和保存', () => {
    it('本剧情的用户/助手镜像都不回流，仍保留其他来源和剧情的可见原文', async () => {
        const char = { id: 'reroll-actor', contextRangeMode: 'manual', contextLimit: 20, contextRangePolicyVersion: 1 } as CharacterProfile;
        for (const [content, metadata] of [
            ['私聊', { source: 'chat' }],
            ['别的剧情', { source: 'story_theater_memory', theaterId: 'other' }],
            ['本轮输入', { source: 'story_theater_memory', theaterId: 'current' }],
            ['旧回复', { source: 'story_theater_memory', theaterId: 'current' }],
        ] as const) await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content, metadata });
        expect((await loadStoryActorContext(char, 'current')).map(message => message.content)).toEqual(['私聊', '别的剧情']);
    });

    it('用中央消息的副本映射排除失去来源标记的当前剧情原文，不改数据库', async () => {
        const char = { id: 'legacy-mirror-actor', contextRangeMode: 'manual', contextLimit: 20, contextRangePolicyVersion: 1 } as CharacterProfile;
        await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: '私聊' });
        const mirrorId = await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content: '当前剧情原文' });
        const centralId = await DB.saveMessage({
            charId: 'story-theater:current',
            role: 'assistant',
            type: 'text',
            content: '当前剧情原文',
            metadata: { source: 'story_theater', theaterId: 'current', theaterMirrorIds: { [char.id]: mirrorId } },
        });
        const current = (await DB.getMessagesByCharId('story-theater:current', true)).filter(row => row.id === centralId);
        expect((await loadStoryActorContext(char, 'current', current)).map(row => row.content)).toEqual(['私聊']);
        expect((await DB.getMessagesByCharId(char.id, true)).map(row => row.content)).toEqual(['私聊', '当前剧情原文']);
    });

    it.each(['manual', 'adaptive'] as const)('沿用角色的 %s 范围和断点，不再额外限制为 100 条', async mode => {
        const char = { id: `native-context-${mode}`, contextRangeMode: mode, contextLimit: mode === 'manual' ? 125 : 10,
            autoArchiveEnabled: mode === 'adaptive', contextRangePolicyVersion: 1 } as CharacterProfile;
        const ids: number[] = [];
        for (let i = 0; i < 130; i++) ids.push(await DB.saveMessage({ charId: char.id, role: 'user', type: 'text', content: `原文${i}` }));
        const key = `mp_lastMsgId_${char.id}`;
        localStorage.setItem(key, String(ids[4]));
        try {
            const recent = await loadStoryActorContext(char, 'current');
            expect(recent).toHaveLength(125);
            expect(recent[0].id).toBe(ids[5]);
            expect((await loadStoryActorContext({ ...char, contextUserStartMessageId: ids[10] }, 'current'))[0].id).toBe(ids[10]);
            expect(await loadStoryActorContext({ ...char, contextUserStartMessageId: ids[10] }, 'current')).toHaveLength(120);
        } finally { localStorage.removeItem(key); }
    });

    it('移除时间控件后仍优先续接已有镜像的剧情时间，旧起点与现实收发时间保留', async () => {
        const entry = normalizeStoryTheater({ ...createStoryTheaterDraft(), id: 'continued-timeline',
            characterMemoryDates: { actor: '2020-01-01T09:00' } });
        const previous = new Date(2020, 0, 5, 9).getTime();
        const central = { id: 991, role: 'assistant', content: '旧正文', timestamp: Date.now() } as Message;
        const id = await DB.saveMessage(createStoryTheaterMirrorMessage(entry, 'actor', central, previous));
        const base = await loadStoryMirrorTimeline(entry, 'actor', [{ ...central, metadata: { theaterMirrorIds: { actor: id } } }]);
        expect(base).toBe(previous);
        const next = createStoryTheaterMirrorMessage(entry, 'actor', { ...central, content: '<scene_header><time>3天后</time></scene_header>新正文' }, base);
        expect(next.metadata.theaterTimelineTimestamp).toBe(new Date(2020, 0, 8, 9).getTime());
        expect(next.timestamp).toBe(central.timestamp);
        expect(await loadStoryMirrorTimeline(entry, 'actor', [])).toBe(new Date(2020, 0, 1, 9).getTime());
    });

    const seed = async (id: string): Promise<Message> => {
        const centralId = await DB.saveMessage({ charId: id, role: 'assistant', type: 'text', content: '旧回复' });
        const mirrorId = await DB.saveMessage({ charId: id + '-actor', role: 'assistant', type: 'text', content: '旧回复' });
        await DB.updateMessageMetadata(centralId, () => ({ theaterMirrorIds: { actor: mirrorId } }));
        return (await DB.getMessagesByCharId(id, true))[0];
    };
    it('成功后原位原子替换，中央正文和镜像不会多出一条', async () => {
        const old = await seed('reroll-save');
        await replaceStoryTheaterReply(old, '新回复', { theaterPromptTokens: 123 });
        const rows = await DB.getMessagesByCharId(old.charId, true);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: old.id, content: '新回复', metadata: { theaterPromptTokens: 123 } });
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('新回复');
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
