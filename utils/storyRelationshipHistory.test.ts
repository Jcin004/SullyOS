import { describe, expect, it } from 'vitest';
import type { Message, StoryTheaterEntry } from '../types';
import { DB } from './db';
import { createStoryTheaterDraft, createStoryTheaterMirrorMessage, storyTheaterThreadId, formatSharedStoryHistory, formatStoryActorContexts } from './storyTheater';
import { getStoryRelationshipBaseline, reconcileStoryRelationships } from './storyTheaterRelationships';
import { selectStoryRelationshipHistory, storyRelationshipScope } from './storyRelationshipHistory';
import { replaceStoryTheaterReply } from './storyTheaterReply';

const actors = (key: string) => [{ id: key + '-a', name: '狛治' }, { id: key + '-b', name: '香奈乎' }, { id: key + '-c', name: '狛治' }];
async function entry(id: string, real = false) {
    const value = { ...createStoryTheaterDraft(), id, writesToCharacterMemory: real, carryCharacterMemory: true };
    await DB.saveStoryTheater(value);
    return value;
}
const legacy = (from: string, to: string, score: number) => '<story_text>对方履约了。</story_text><relationship_panel>'
    + JSON.stringify({ primaryId: from, relationships: [{ fromId: from, toId: to, axes: { FL: { score } } }] }) + '</relationship_panel>';
async function save(story: StoryTheaterEntry, content: string, metadata = {}, timestamp = 10) {
    const id = await DB.saveMessage({ charId: storyTheaterThreadId(story.id), role: 'assistant', type: 'text', content, timestamp,
        metadata: { source: 'story_theater', theaterId: story.id, ...metadata } });
    return (await DB.getMessageById(id))!;
}
async function state(story: StoryTheaterEntry, cast: ReturnType<typeof actors>) {
    return getStoryRelationshipBaseline((await DB.getStoryRelationshipHistory(story)).messages, cast);
}
const score = (value: ReturnType<typeof getStoryRelationshipBaseline>, from: string, to: string) =>
    value.relationships.find(row => row.fromId === from && row.toId === to)?.axes.FL?.score;
const propose = (fromId: string, toId: string, value: object) => '<story_text>道谢后接下纸条。</story_text><affinity_panel mode="three_axes"><affinity_person>'
    + `<from_id>${fromId}</from_id><to_id>${toId}</to_id><FL>` + Object.entries(value).map(([k, v]) => `<${k}>${v}</${k}>`).join('')
    + '<trigger>履约</trigger><evidence>接下纸条并道谢</evidence></FL></affinity_person></affinity_panel>';

describe('关系世界历史与原子保存', () => {
    it('真实剧场共享历史；虚构剧场即使开启角色记忆输入也各自独立', async () => {
        const cast = actors('world'), [a, b] = cast;
        const realA = await entry('world-real-A', true), realB = await entry('world-real-B', true);
        const fictionA = await entry('world-fiction-A'), fictionB = await entry('world-fiction-B');
        const first = await save(realA, legacy(a.id, b.id, 40));
        await save(fictionA, legacy(a.id, b.id, 99));
        await save(fictionB, legacy(a.id, b.id, 88), { theaterRelationshipScope: 'real' });
        await DB.saveMessage({ charId: a.id, role: 'assistant', type: 'text', content: legacy(a.id, b.id, 100),
            metadata: { source: 'story_theater_memory', theaterId: realA.id, theaterCentralId: first.id } });
        expect(score(await state(realB, cast), a.id, b.id)).toBe(40);
        expect(score(await state(fictionA, cast), a.id, b.id)).toBe(99);
        expect(score(await state(fictionB, cast), a.id, b.id)).toBeUndefined();
        const pending = { id: await DB.saveMessage({ charId: storyTheaterThreadId(realB.id), role: 'user', type: 'text', content: '继续',
            metadata: { source: 'story_theater', theaterId: realB.id } }) };
        const history = await DB.getStoryRelationshipHistory(realB);
        const content = reconcileStoryRelationships(propose(a.id, b.id, { score: 45 }), getStoryRelationshipBaseline(history.messages, cast));
        await DB.commitStoryTheaterTurn({ charId: storyTheaterThreadId(realB.id), role: 'assistant', type: 'text', content, timestamp: 1,
            metadata: { source: 'story_theater', theaterId: realB.id, theaterRelationshipScope: history.scope } },
            (await DB.getMessageById(pending.id))!, [], undefined, undefined, { entry: realB, signature: history.signature });
        expect(score(await state(realA, cast), a.id, b.id)).toBe(45);
        expect(score(await state(fictionA, cast), a.id, b.id)).toBe(99);
    });

    it('旧三轴按消息 ID 选绝对快照，不相加；孤立/伪来源/场外/错世界记录不进入历史', async () => {
        const cast = actors('old-world'), [a, b] = cast;
        const one = await entry('old-real-1', true), two = await entry('old-real-2', true);
        const first = await save(one, legacy(a.id, b.id, 23), {}, 999999);
        const last = await save(two, legacy(a.id, b.id, 31), {}, 1);
        await save(two, legacy(a.id, b.id, 100), { theaterOutOfStory: true });
        await save(two, legacy(a.id, b.id, 100), { theaterRelationshipScope: 'theater:another' });
        const foreign = { ...last, id: last.id + 10, charId: a.id };
        const orphan = { ...last, id: last.id + 11, charId: 'story-theater:missing', metadata: { source: 'story_theater', theaterId: 'missing' } };
        const history = selectStoryRelationshipHistory([one, two], [last, foreign, orphan, first], one);
        expect(history.messages.map(row => row.id)).toEqual([first.id, last.id]);
        expect(score(await state(one, cast), a.id, b.id)).toBe(31);
    });

    it.each(['create', 'edit', 'delete', 'cast'] as const)('并发 %s 同世界关系后拒绝旧基线，正文和镜像一起回滚', async action => {
        const cast = actors('guard-' + action), [a, b] = cast;
        const one = await entry('guard-main-' + action, true), peer = await entry('guard-peer-' + action, true);
        const old = await save(peer, legacy(a.id, b.id, 20));
        const inputId = await DB.saveMessage({ charId: storyTheaterThreadId(one.id), role: 'user', type: 'text', content: '推进', metadata: { source: 'story_theater', theaterId: one.id } });
        const input = (await DB.getMessageById(inputId))!;
        const history = await DB.getStoryRelationshipHistory(one);
        if (action === 'create') await save(peer, legacy(a.id, b.id, 30));
        if (action === 'edit') await DB.updateMessage(old.id, legacy(a.id, b.id, 29));
        if (action === 'delete') await DB.deleteMessages([old.id]);
        if (action === 'cast') await DB.updateMessageMetadata(old.id, prev => ({ ...prev, theaterCastIds: [b.id] }));
        const content = reconcileStoryRelationships(propose(a.id, b.id, { score: 25 }), getStoryRelationshipBaseline(history.messages, cast));
        await expect(DB.commitStoryTheaterTurn({ charId: input.charId, role: 'assistant', type: 'text', content, timestamp: 2,
            metadata: { source: 'story_theater', theaterId: one.id, theaterCastIds: [a.id, b.id], theaterRelationshipScope: history.scope } },
            input, [a.id, b.id], (id, original) => createStoryTheaterMirrorMessage(one, id, original), undefined,
            { entry: one, signature: history.signature })).rejects.toThrow('同一世界的关系历史已更新');
        expect(await DB.getMessagesByCharId(input.charId, true)).toEqual([input]);
        expect((await DB.getMessagesByCharId(a.id, true)).filter(row => row.metadata?.theaterId === one.id)).toEqual([]);
        expect((await DB.getMessagesByCharId(b.id, true)).filter(row => row.metadata?.theaterId === one.id)).toEqual([]);
    });

    it('不同虚构世界、归档标记和摘要变更不使基线冲突；删除所属剧场使基线失效', async () => {
        const cast = actors('archive-world'), [a, b] = cast;
        const story = await entry('archive-world'), other = await entry('archive-other');
        const old = await save(story, legacy(a.id, b.id, 62));
        const history = await DB.getStoryRelationshipHistory(story);
        await DB.updateMessageMetadata(old.id, prev => ({ ...prev, theaterArchived: true }));
        await DB.saveStoryTheater({ ...story, archives: [{ id: 'box', strategy: 'summary', summary: '摘要', fromMessageId: old.id, toMessageId: old.id, messageCount: 1, createdAt: 3 }] });
        await save(other, legacy(a.id, b.id, 100));
        expect((await DB.getStoryRelationshipHistory(story)).signature).toBe(history.signature);
        expect(score(await state(story, cast), a.id, b.id)).toBe(62);
        await DB.deleteStoryTheater(story.id);
        expect((await DB.getStoryRelationshipHistory(story)).exists).toBe(false);
        expect((await DB.getStoryRelationshipHistory(story)).signature).not.toBe(history.signature);
    });

    it('同一基线的两个真实剧场并发完成时只提交一次，另一轮可重新读取基线重试', async () => {
        const cast = actors('race-world'), [a, b] = cast;
        const one = await entry('race-main', true), two = await entry('race-peer', true);
        const submit = async (story: StoryTheaterEntry, initial: number, history: Awaited<ReturnType<typeof DB.getStoryRelationshipHistory>>) => {
            const pending = await DB.saveMessage({ charId: storyTheaterThreadId(story.id), role: 'user', type: 'text', content: '推进',
                metadata: { source: 'story_theater', theaterId: story.id } });
            await DB.commitStoryTheaterTurn({ charId: storyTheaterThreadId(story.id), role: 'assistant', type: 'text', timestamp: 3,
                content: reconcileStoryRelationships(propose(a.id, b.id, { score: initial }), getStoryRelationshipBaseline(history.messages, cast)),
                metadata: { source: 'story_theater', theaterId: story.id, theaterRelationshipScope: history.scope } },
                (await DB.getMessageById(pending))!, [], undefined, undefined, { entry: story, signature: history.signature });
        };
        const [first, second] = await Promise.all([DB.getStoryRelationshipHistory(one), DB.getStoryRelationshipHistory(two)]);
        const results = await Promise.allSettled([submit(one, 20, first), submit(two, 30, second)]);
        expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
        expect(score(await state(one, cast), a.id, b.id)).toBe(score(await state(two, cast), a.id, b.id));
    });

    it('自由续写重写也核对世界快照，并发变更时保留原回复', async () => {
        const cast = actors('free-guard'), [a, b] = cast;
        const one = await entry('free-guard-1', true), peer = await entry('free-guard-2', true);
        const original = await save(one, legacy(a.id, b.id, 20));
        const history = await DB.getStoryRelationshipHistory(one);
        await save(peer, legacy(a.id, b.id, 31));
        await expect(replaceStoryTheaterReply(original, '新正文', { theaterRelationshipScope: 'real' }, true, undefined,
            { entry: one, signature: history.signature })).rejects.toThrow('同一世界的关系历史已更新');
        expect(await DB.getMessageById(original.id)).toEqual(original);
    });

    it('重写旧真实剧场在原消息边界计算，后续跨剧场增量重放；删除初始楼层不复活旧值', async () => {
        const cast = actors('replay-world'), [a, b] = cast;
        const one = await entry('replay-real-1', true), two = await entry('replay-real-2', true);
        const initial = await save(one, reconcileStoryRelationships(propose(a.id, b.id, { score: 40 }), getStoryRelationshipBaseline([], cast)), { theaterRelationshipScope: 'real' });
        const next = await save(two, propose(a.id, b.id, { delta: 7 }), { theaterRelationshipScope: 'real' });
        const history = await DB.getStoryRelationshipHistory(one);
        const boundary = getStoryRelationshipBaseline(history.messages.filter(row => row.id < initial.id), cast);
        const rewritten = reconcileStoryRelationships(propose(a.id, b.id, { score: 60 }), boundary);
        await replaceStoryTheaterReply(initial, rewritten, { theaterRelationshipScope: 'real' }, true, undefined, { entry: one, signature: history.signature });
        expect((await DB.getMessageById(initial.id))?.id).toBe(initial.id);
        expect(score(await state(two, cast), a.id, b.id)).toBe(67);
        await DB.deleteMessages([initial.id]);
        expect(score(await state(two, cast), a.id, b.id)).toBeUndefined();
        expect(await DB.getMessageById(next.id)).toBeDefined();
    });

    it('完整备份往返保留作用域、事件协议和 ID，世界间不合并', async () => {
        const cast = actors('backup-world'), [a, b] = cast;
        const story = await entry('backup-world'), peer = await entry('backup-world-peer', true);
        const initial = await save(story, reconcileStoryRelationships(propose(a.id, b.id, { score: 35 }), getStoryRelationshipBaseline([], cast)),
            { theaterRelationshipScope: storyRelationshipScope(story), theaterArchived: true });
        await save(peer, legacy(a.id, b.id, 91));
        const exported = JSON.parse(JSON.stringify(await DB.exportFullData()));
        await DB.deleteMessages([initial.id]);
        await DB.deleteStoryTheater(story.id);
        await DB.importFullData(exported);
        expect(await DB.getMessageById(initial.id)).toEqual(initial);
        expect(score(await state(story, cast), a.id, b.id)).toBe(35);
        expect(score(await state(peer, cast), a.id, b.id)).toBe(91);
    });

    it('共享档案和演员既有原文只带故事事实，不带其他世界的分数面板', () => {
        const story = { ...createStoryTheaterDraft(), id: 'shared-fiction', title: '另一世界' };
        const row: Message = { id: 1, charId: storyTheaterThreadId(story.id), type: 'text', role: 'assistant', timestamp: 1,
            content: legacy('a', 'b', 88), metadata: { source: 'story_theater', theaterId: story.id, theaterInputId: 0 } };
        const shared = formatSharedStoryHistory([{ entry: story, rows: [row] }], () => false, 0, 100);
        expect(shared).toContain('对方履约了');
        expect(shared).not.toContain('relationship_panel');
        const context = formatStoryActorContexts([{ actor: { id: 'a', name: '狛治' } as any, core: '角色卡', recent: [row] }], '用户', '用户', false);
        expect(context).toContain('对方履约了');
        expect(context).not.toContain('relationship_panel');
    });
});
