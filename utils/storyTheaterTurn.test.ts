import { describe, expect, it } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';
import { replaceStoryTheaterReply } from './storyTheaterReply';
import { storyPrivateAxesFromMessage } from './storyTheaterCast';

const original = (theaterId: string, role: 'user' | 'assistant', content: string): Omit<Message, 'id'> => ({
    charId: storyTheaterThreadId(theaterId), role, type: 'text', content, timestamp: Date.now(),
    metadata: { source: 'story_theater', theaterId },
});
const mirrors = (theaterId: string) => (actor: string, message: Message) =>
    createStoryTheaterMirrorMessage({ id: theaterId, title: '事务验证', characterMemoryDates: {} } as StoryTheaterEntry, actor, message);
const read = (id: string) => DB.getMessagesByCharId(id, true);

describe('剧场整轮提交', () => {
    it('输入修改或删除后旧私轴失效，重写仍保存正文和对应私轴', async () => {
        const theater = 'axes-edit';
        const user = original(theater, 'user', '旧输入');
        const input = { ...user, id: await DB.saveMessage(user) };
        const axis = { doing: '修表', thinking: '缺零件', next: '去找工具' };
        const reply = original(theater, 'assistant', '旧正文');
        await DB.commitStoryTheaterTurn({ ...reply, metadata: { ...reply.metadata, theaterInputId: input.id, theaterPrivateAxes: { actor: axis } } },
            input.id, [['actor']], mirrors(theater));
        const [savedInput, savedReply] = await read(user.charId);
        expect(storyPrivateAxesFromMessage(savedReply, new Map([[savedInput.id, savedInput]]))).toEqual({ actor: '修表；缺零件；去找工具' });
        await replaceStoryTheaterReply(savedInput, '新输入', { theaterInputRevision: 'new-input' });
        const edited = (await read(user.charId))[0];
        expect(storyPrivateAxesFromMessage(savedReply, new Map([[edited.id, edited]]))).toEqual({});
        const later = original(theater, 'user', '下一条输入');
        const laterId = await DB.saveMessage(later);
        await replaceStoryTheaterReply(savedReply, '重写正文', { theaterPrivateAxes: { actor: '旧输入下的念头' } });
        const rewritten = (await read(user.charId))[1];
        expect(rewritten.content).toBe('重写正文');
        expect(storyPrivateAxesFromMessage(rewritten, new Map([[edited.id, edited]]))).toEqual({});
        expect(await DB.getMessageById(laterId)).toMatchObject(later);
        const revisedAxis = '修表；缺零件；先问师傅';
        await replaceStoryTheaterReply(rewritten, '新正文', {
            theaterPrivateAxes: { actor: revisedAxis }, theaterPrivateAxesInputRevision: 'new-input',
        });
        const revised = (await read(user.charId))[1];
        expect(storyPrivateAxesFromMessage(revised, new Map([[edited.id, edited]]))).toEqual({ actor: revisedAxis });
        expect((await read('actor')).map(row => row.content)).toEqual(['新输入', '新正文']);
        await DB.deleteMessages([edited.id, edited.metadata.theaterMirrorIds.actor]);
        expect(storyPrivateAxesFromMessage(revised, new Map())).toEqual({});
    });

    it('开场没有虚构的用户镜像；虚构剧场只存中央正文和名单', async () => {
        await DB.commitStoryTheaterTurn(original('solo-opening', 'assistant', '开场'), 0, [['opening-actor']], mirrors('solo-opening'));
        expect((await read('opening-actor')).map(row => row.role)).toEqual(['assistant']);
        await DB.commitStoryTheaterTurn(original('fiction', 'assistant', '虚构开场'), 0, [['fiction-actor']]);
        expect(await read('fiction-actor')).toHaveLength(0);
        expect((await read(storyTheaterThreadId('fiction')))[0].metadata.theaterCastGroups).toEqual([['fiction-actor']]);
    });

    it('镜像写入失败会回滚；有较新楼层时仍能重试并保留已有剧情', async () => {
        const theater = 'atomic-cast';
        const user = original(theater, 'user', '用户原文');
        const reply = original(theater, 'assistant', '完整回复');
        const id = await DB.saveMessage(user);
        const pending = { ...user, id };
        const cast = [['atomic-a', 'atomic-b']];
        const makeMirror = mirrors(theater);
        await expect(DB.commitStoryTheaterTurn(reply, id, cast, (actor, message) => {
            if (message.role === 'assistant' && actor === 'atomic-b') throw new Error('模拟回复镜像写入失败');
            return makeMirror(actor, message);
        })).rejects.toThrow('模拟回复镜像写入失败');
        expect(await read('atomic-a')).toHaveLength(0);
        expect(await read('atomic-b')).toHaveLength(0);
        expect(await read(user.charId)).toEqual([pending]);

        const later = original(theater, 'assistant', '别处已保存的正文');
        const laterId = await DB.saveMessage(later);
        await DB.commitStoryTheaterTurn(reply, id, cast, makeMirror);
        const [centralUser, otherReply, centralReply] = await read(user.charId);
        expect(otherReply).toEqual({ ...later, id: laterId });
        for (const actor of cast[0]) {
            const rows = await read(actor);
            expect(rows.map(row => row.content)).toEqual(['用户原文', '完整回复']);
            expect(rows.map(row => row.metadata.theaterCentralId)).toEqual([centralUser.id, centralReply.id]);
            expect(rows.map(row => row.id)).toEqual([centralUser.metadata.theaterMirrorIds[actor], centralReply.metadata.theaterMirrorIds[actor]]);
            expect(rows.map(row => row.timestamp)).toEqual([centralUser.timestamp, centralReply.timestamp]);
        }
        await DB.commitStoryTheaterTurn({ ...reply, content: '另一个已生成的正文' }, id, [['atomic-c']], makeMirror);
        expect((await read(user.charId)).slice(1, 3)).toEqual([otherReply, centralReply]);
        expect((await read('atomic-a')).map(row => row.content)).toEqual(['用户原文', '完整回复']);
        const [addedInput, addedReply] = await read('atomic-c');
        expect([addedInput.content, addedReply.content]).toEqual(['用户原文', '另一个已生成的正文']);
        expect((await DB.getMessageById(id))?.metadata.theaterMirrorIds).toEqual({
            ...centralUser.metadata.theaterMirrorIds, 'atomic-c': addedInput.id,
        });
    });

    it('生成期间删除输入时仍保存正文，并保留删除结果', async () => {
        const theater = 'deleted-input';
        const user = original(theater, 'user', '被删除的推进');
        const id = await DB.saveMessage(user);
        await DB.deleteMessages([id]);
        await DB.commitStoryTheaterTurn(original(theater, 'assistant', '生成的正文'), id, [['deletion-actor']], mirrors(theater));
        expect((await read(user.charId)).map(row => row.content)).toEqual(['生成的正文']);
        expect((await read('deletion-actor')).map(row => row.role)).toEqual(['assistant']);
    });
});
