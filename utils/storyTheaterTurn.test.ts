import { describe, expect, it } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';
import { replaceStoryTheaterReply } from './storyTheaterReply';

const original = (theaterId: string, role: 'user' | 'assistant', content: string): Omit<Message, 'id'> => ({
    charId: storyTheaterThreadId(theaterId), role, type: 'text', content, timestamp: Date.now(),
    metadata: { source: 'story_theater', theaterId },
});
const mirrors = (theaterId: string) => (actor: string, message: Message) =>
    createStoryTheaterMirrorMessage({ id: theaterId, title: '事务验证', characterMemoryDates: {} } as StoryTheaterEntry, actor, message);
const read = (id: string) => DB.getMessagesByCharId(id, true);

describe('剧场整轮提交', () => {
    it('开场没有虚构的用户镜像；虚构剧场只存中央正文和名单', async () => {
        await DB.commitStoryTheaterTurn(original('solo-opening', 'assistant', '开场'), undefined, [['opening-actor']], mirrors('solo-opening'));
        expect((await read('opening-actor')).map(row => row.role)).toEqual(['assistant']);
        await DB.commitStoryTheaterTurn(original('fiction', 'assistant', '虚构开场'), undefined, [['fiction-actor']]);
        expect(await read('fiction-actor')).toHaveLength(0);
        expect((await read(storyTheaterThreadId('fiction')))[0].metadata.theaterCastGroups).toEqual([['fiction-actor']]);
    });

    it('写入部分镜像后失败会整笔回滚；同一输入可重试，但不会被提交两次', async () => {
        const theater = 'atomic-cast';
        const user = original(theater, 'user', '用户原文');
        const reply = original(theater, 'assistant', '完整回复');
        const id = await DB.saveMessage(user);
        const pending = { ...user, id };
        const cast = [['atomic-a', 'atomic-b']];
        const makeMirror = mirrors(theater);
        await expect(DB.commitStoryTheaterTurn(reply, pending, cast, (actor, message) => {
            if (message.role === 'assistant' && actor === 'atomic-b') throw new Error('模拟回复镜像写入失败');
            return makeMirror(actor, message);
        })).rejects.toThrow('模拟回复镜像写入失败');
        expect(await read('atomic-a')).toHaveLength(0);
        expect(await read('atomic-b')).toHaveLength(0);
        expect(await read(user.charId)).toEqual([pending]);

        const outcomes = await Promise.allSettled([
            DB.commitStoryTheaterTurn(reply, pending, cast, makeMirror),
            DB.commitStoryTheaterTurn(reply, pending, cast, makeMirror),
        ]);
        expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
        const [centralUser, centralReply] = await read(user.charId);
        for (const actor of cast[0]) {
            const rows = await read(actor);
            expect(rows.map(row => row.content)).toEqual(['用户原文', '完整回复']);
            expect(rows.map(row => row.metadata.theaterCentralId)).toEqual([centralUser.id, centralReply.id]);
            expect(rows.map(row => row.id)).toEqual([centralUser.metadata.theaterMirrorIds[actor], centralReply.metadata.theaterMirrorIds[actor]]);
            expect(rows.map(row => row.timestamp)).toEqual([centralUser.timestamp, centralReply.timestamp]);
        }
        await DB.saveMessage(original(theater, 'user', '下一次输入'));
        await expect(replaceStoryTheaterReply(centralReply, '过期的重写', {}, true)).rejects.toThrow('已在别处推进');
        expect((await read('atomic-a'))[1].content).toBe('完整回复');
    });
});
