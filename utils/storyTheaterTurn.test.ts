import { describe, expect, it } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';
import { replaceStoryTheaterReply } from './storyTheaterReply';
import { latestStoryPrivateAxes, storyPrivateAxesFromMessage, storyTurnActorIds } from './storyTheaterCast';

const original = (theaterId: string, role: 'user' | 'assistant', content: string): Omit<Message, 'id'> => ({
    charId: storyTheaterThreadId(theaterId), role, type: 'text', content, timestamp: Date.now(),
    metadata: { source: 'story_theater', theaterId },
});

const editCast = (reply: Message, ids: string[]) => DB.commitStoryTheaterTurn(
    reply, undefined, ids, mirrors(reply.metadata.theaterId), { castEdit: reply },
);
async function seedTurn(theater: string, cast: string[], candidates = cast, metadata: Record<string, unknown> = {}) {
    const input = original(theater, 'user', '本轮推进');
    const pending = { ...input, id: await DB.saveMessage(input) };
    const reply = original(theater, 'assistant', '本轮正文');
    await DB.commitStoryTheaterTurn({
        ...reply, metadata: { ...reply.metadata, theaterInputId: pending.id,
            theaterCastIds: cast, theaterCandidateIds: candidates, ...metadata },
    }, pending, cast, mirrors(theater));
    return read(reply.charId);
}

describe('人工编辑本轮', () => {
    it('修改旧轮的两条来源链接，删除原镜像，保留有效的实际互动组并可幂等保存', async () => {
        const [a, b, c, added] = ['edit-A', 'edit-B', 'edit-C', 'edit-D'];
        const [input, reply] = await seedTurn('manual-turn', [a, b, c], [a, b, c, added], {
            theaterInteractionGroups: [[a, b, c], [a, b]],
            theaterInteractionTendencies: [[a, added]], theaterPrivateAxes: { [c]: '保留我的记录' },
        });
        const next = original('manual-turn', 'user', '下一轮正等待回复');
        const nextId = await DB.saveMessage(next);
        await Promise.all([editCast(reply, [a, b, added]), editCast(reply, [a, b, added])]);
        const [updatedInput, updatedReply, stillPending] = await read(reply.charId);
        for (const [updated, old] of [[updatedInput, input], [updatedReply, reply]]) {
            expect(updated).toMatchObject({ id: old.id, content: old.content, timestamp: old.timestamp,
                metadata: { theaterCastIds: [a, b, added], theaterMirrorIds: { [a]: old.metadata.theaterMirrorIds[a] } } });
            expect(updated.metadata.theaterMirrorIds).not.toHaveProperty(c);
            const mirror = await DB.getMessageById(updated.metadata.theaterMirrorIds[added]);
            expect(mirror).toMatchObject({ charId: added, role: old.role, content: old.content, timestamp: old.timestamp,
                metadata: { theaterCentralId: old.id, theaterId: 'manual-turn' } });
        }
        expect(stillPending).toEqual({ ...next, id: nextId });
        expect(await read(c)).toEqual([]);
        expect(await read(added)).toHaveLength(2);
        expect(updatedReply.metadata.theaterInteractionGroups).toEqual([[a, b]]);
        expect(updatedReply.metadata.theaterInteractionTendencies).toEqual([[a, added]]);
        expect(updatedReply.metadata.theaterPrivateAxes).toEqual({ [c]: '保留我的记录' });
        await expect(editCast(reply, [c])).rejects.toThrow('出演名单已被修改');
    });

    it.each(['正文改过又还原', '来源不符', '独立元数据修改', '已归档', '未链接镜像'])('遇到%s时保留两个中央楼层与镜像', async kind => {
        const theater = 'protected-' + kind;
        const a = theater + '-a';
        const b = theater + '-b';
        const [input, reply] = await seedTurn(theater, [a], [a, b]);
        const id = reply.metadata.theaterMirrorIds[a];
        if (kind === '正文改过又还原') {
            await DB.updateMessage(id, '单独修改的剧情');
            await DB.updateMessage(id, reply.content);
        }
        if (kind === '来源不符') await DB.updateMessageMetadata(id, current => ({ ...current, theaterId: 'another' }));
        if (kind === '独立元数据修改') await DB.updateMessageMetadata(id, current => ({ ...current, annotation: '自留笔记' }));
        if (kind === '已归档') await DB.saveAsset('mp_hwm_v1_' + a, { msgId: id });
        if (kind === '未链接镜像') await DB.saveMessage(mirrors(theater)(b, reply));
        const before = await Promise.all([read(a), read(b)]);
        await expect(editCast(reply, [b])).rejects.toThrow('原记录已保留');
        expect(await read(reply.charId)).toEqual([input, reply]);
        expect(await Promise.all([read(a), read(b)])).toEqual(before);
    });

    it('旧分组与相邻旧输入可编辑，已有存档正文保留，空名单后仍可补回角色', async () => {
        const theater = 'legacy-manual-turn';
        const a = 'legacy-manual-a';
        const user = original(theater, 'user', '旧输入');
        const input = { ...user, id: await DB.saveMessage(user) };
        const oldReply = original(theater, 'assistant', '旧正文');
        await DB.commitStoryTheaterTurn({ ...oldReply, metadata: { ...oldReply.metadata, theaterCastGroups: [[a]] } },
            input, [a], mirrors(theater));
        const [savedInput, reply] = await read(user.charId);
        await DB.updateMessageMetadata(reply.id, ({ theaterCandidateIds: _candidates, theaterCastIds: _cast, ...rest }) => rest);
        const legacyReply = (await DB.getMessageById(reply.id))!;
        expect(storyTurnActorIds(legacyReply)).toEqual([a]);
        await editCast(legacyReply, []);
        const [newInput, newReply] = await read(user.charId);
        expect(newInput.content).toBe(savedInput.content);
        expect(newReply.content).toBe(reply.content);
        expect(newReply.metadata.theaterCastIds).toEqual([]);
        expect(await read(a)).toEqual([]);
        await editCast(newReply, [a]);
        expect(await read(a)).toHaveLength(2);
        expect((await read(user.charId))[1].metadata.theaterInteractionGroups).toBeUndefined();
    });

    it('私轴独立合并，候选人可补写；清空后下一轮不再承接该角色的更旧私轴', async () => {
        const [a, b, c, stranger] = ['axis-a', 'axis-b', 'axis-c', 'axis-other'];
        const [, reply] = await seedTurn('private-axis-manual', [a, c], [a, b, c], {
            theaterInteractionGroups: [[a, c]], theaterPrivateAxes: { [a]: { doing: '旧记录', next: '回来' }, [c]: '不变的私轴' },
        });
        await Promise.all([
            DB.updateStoryTheaterPrivateAxis(reply, a, '  修正后的记录  '),
            DB.updateStoryTheaterPrivateAxis(reply, b, '候选人私轴'),
            editCast(reply, [a, b, c]),
        ]);
        const after = (await DB.getMessageById(reply.id))!;
        expect(after).toMatchObject({ content: reply.content, metadata: {
            theaterCastIds: [a, b, c], theaterInteractionGroups: [[a, c]],
            theaterPrivateAxes: { [a]: '修正后的记录', [b]: '候选人私轴', [c]: '不变的私轴' },
        } });
        await expect(DB.updateStoryTheaterPrivateAxis(after, stranger, '越界')).rejects.toThrow('角色已变更');
        await expect(DB.updateStoryTheaterPrivateAxis(reply, a, '过时写入')).rejects.toThrow('私轴已被修改');
        await DB.updateStoryTheaterPrivateAxis(after, a, '   ');
        const cleared = (await DB.getMessageById(reply.id))!;
        const expected = { [b]: '候选人私轴', [c]: '不变的私轴' };
        expect(storyPrivateAxesFromMessage(cleared)).toEqual(expected);
        expect(Object.fromEntries(latestStoryPrivateAxes([reply, cleared], [a, b, c]))).toEqual(expected);
    });
});
const mirrors = (theaterId: string) => (actor: string, message: Message) =>
    createStoryTheaterMirrorMessage({ id: theaterId, title: '事务验证', characterMemoryDates: {} } as StoryTheaterEntry, actor, message);
const read = (id: string) => DB.getMessagesByCharId(id, true);

describe('剧场整轮提交', () => {
    it('编辑输入后已生成的私轴仍可读取，并允许按当前正文重写镜像', async () => {
        const theater = 'axes-edit';
        const user = original(theater, 'user', '旧输入');
        const input = { ...user, id: await DB.saveMessage(user) };
        const axis = { doing: '修表', thinking: '缺零件', next: '去找工具' };
        const reply = original(theater, 'assistant', '旧正文');
        await DB.commitStoryTheaterTurn({
            ...reply, metadata: { ...reply.metadata, theaterInputId: input.id, theaterPrivateAxes: { actor: axis } },
        }, input, ['actor'], mirrors(theater));
        const [savedInput, savedReply] = await read(user.charId);
        const oldAxis = { actor: '修表；缺零件；去找工具' };
        expect(storyPrivateAxesFromMessage(savedReply)).toEqual(oldAxis);

        await replaceStoryTheaterReply(savedInput, '新输入', { theaterInputRevision: 'new-input' });
        const edited = (await read(user.charId))[0];
        expect(storyPrivateAxesFromMessage((await read(user.charId))[1])).toEqual(oldAxis);

        const revisedAxis = { ...axis, next: '先问师傅' };
        await replaceStoryTheaterReply(savedReply, '新正文', {
            theaterPrivateAxes: { actor: revisedAxis }, theaterPrivateAxesInputRevision: 'new-input',
        }, true);
        const revised = (await read(user.charId))[1];
        expect(storyPrivateAxesFromMessage(revised))
            .toEqual({ actor: '修表；缺零件；先问师傅' });
        expect((await read('actor')).map(row => row.content)).toEqual(['新输入', '新正文']);
        await DB.deleteMessages([edited.id, edited.metadata.theaterMirrorIds.actor]);
        expect(storyPrivateAxesFromMessage((await read(user.charId))[0]))
            .toEqual({ actor: '修表；缺零件；先问师傅' });
    });

    it('模型自主开场不创建虚构用户镜像，普通虚构剧场不写角色镜像', async () => {
        await DB.commitStoryTheaterTurn(original('solo-opening', 'assistant', '开场'), undefined,
            ['opening-actor'], mirrors('solo-opening'));
        expect((await read('opening-actor')).map(row => row.role)).toEqual(['assistant']);
        await DB.commitStoryTheaterTurn(original('fiction', 'assistant', '虚构开场'), undefined, ['fiction-actor']);
        expect(await read('fiction-actor')).toHaveLength(0);
        expect((await read(storyTheaterThreadId('fiction')))[0].metadata.theaterCastIds).toEqual(['fiction-actor']);
    });

    it('镜像写入失败整笔回滚；编辑输入期间完成的回复仍保存', async () => {
        const theater = 'atomic-cast';
        const user = original(theater, 'user', '用户原文');
        const reply = original(theater, 'assistant', '完整回复');
        const id = await DB.saveMessage(user);
        const pending = { ...user, id };
        const cast = ['atomic-a', 'atomic-b'];
        const makeMirror = mirrors(theater);
        await expect(DB.commitStoryTheaterTurn(reply, pending, cast, (actor, message) => {
            if (message.role === 'assistant' && actor === 'atomic-b') throw new Error('模拟回复镜像写入失败');
            return makeMirror(actor, message);
        })).rejects.toThrow('模拟回复镜像写入失败');
        expect(await read('atomic-a')).toHaveLength(0);
        expect(await read('atomic-b')).toHaveLength(0);
        expect(await read(user.charId)).toEqual([pending]);

        await replaceStoryTheaterReply(pending, '编辑后的用户原文', { theaterInputRevision: 'edited' });
        const outcomes = await Promise.allSettled([
            DB.commitStoryTheaterTurn(reply, pending, cast, makeMirror),
            DB.commitStoryTheaterTurn(reply, pending, cast, makeMirror),
        ]);
        expect(outcomes.map(outcome => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
        const [centralUser, centralReply] = await read(user.charId);
        expect(centralUser.content).toBe('编辑后的用户原文');
        expect(centralReply.content).toBe('完整回复');
        for (const actor of cast) {
            const rows = await read(actor);
            expect(rows.map(row => row.content)).toEqual(['编辑后的用户原文', '完整回复']);
            expect(rows.map(row => row.metadata.theaterCentralId)).toEqual([centralUser.id, centralReply.id]);
            expect(rows.map(row => row.id)).toEqual([
                centralUser.metadata.theaterMirrorIds[actor], centralReply.metadata.theaterMirrorIds[actor],
            ]);
        }
        await DB.saveMessage(original(theater, 'user', '下一次输入'));
        await expect(replaceStoryTheaterReply(centralReply, '过期的重写', {}, true))
            .rejects.toThrow('已在别处推进');
        expect((await read('atomic-a'))[1].content).toBe('完整回复');
    });

    it('重写换人时，新增镜像失败会回滚已经移除的原出演镜像', async () => {
        const theater = 'rewrite-atomic';
        const user = original(theater, 'user', '原输入');
        const pending = { ...user, id: await DB.saveMessage(user) };
        const reply = original(theater, 'assistant', '原正文');
        const makeMirror = mirrors(theater);
        await DB.commitStoryTheaterTurn(reply, pending, ['rewrite-a'], makeMirror);
        const before = await read(user.charId);
        const previousMirrors = await read('rewrite-a');
        await expect(DB.commitStoryTheaterTurn({
            ...reply, content: '改写正文', metadata: { ...reply.metadata, theaterCastIds: ['rewrite-b'] },
        }, before[0], ['rewrite-b'], (actor, row) => {
            if (row.role === 'assistant') throw new Error('模拟重写镜像失败');
            return makeMirror(actor, row);
        }, before[1])).rejects.toThrow('模拟重写镜像失败');
        expect(await read(user.charId)).toEqual(before);
        expect(await read('rewrite-a')).toEqual(previousMirrors);
        expect(await read('rewrite-b')).toEqual([]);
    });
});
