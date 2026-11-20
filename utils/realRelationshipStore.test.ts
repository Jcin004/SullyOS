import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Message, StoryTheaterEntry } from '../types';
import { DB, openDB } from './db';
import { createStoryTheaterDraft, createStoryTheaterMirrorMessage, storyTheaterThreadId } from './storyTheater';
import { replaceStoryTheaterReply } from './storyTheaterReply';
import { realRelationshipPayload, realRelationshipBaseline, realRelationshipGraphBefore, realRelationshipKey, type RealRelationshipGraph } from './realRelationshipModel';
import { buildStoryRelationshipGuide, parseStoryRelationshipContent, stripStoryRelationshipPanels, STORY_RELATIONSHIP_PROMPT } from './storyTheaterRelationships';
import { REAL_RELATIONSHIP_GRAPH_KEY, realRelationshipSignature } from './realRelationshipStore';
import { exportActivityTextAsset } from './activityBackup';
import { remapIndependentUser } from './independentUserImport';

const fact = { trigger: '如约归还旧信', evidence: '我接过信并亲口道谢' };
const row = (fromId: string, toId: string, axes: object = {}, rest = {}) => ({ fromId, toId, axes, ...rest });
const report = (relationships: unknown[], extra = {}) => '<story_text>旧信如约归还。</story_text><relationship_panel>' + JSON.stringify({ relationships, ...extra }) + '</relationship_panel>';
const direction = (graph: RealRelationshipGraph, fromId: string, toId: string) => graph.directions[realRelationshipKey(fromId, toId)];

async function fixture(prefix: string) {
    const actors = [
        { id: prefix + '-a', name: '狛治' }, { id: prefix + '-b', name: '香奈乎' }, { id: prefix + '-c', name: '狛治' },
    ];
    for (const actor of actors) await DB.saveCharacter({ ...actor, avatar: '', systemPrompt: '独立人物' } as CharacterProfile);
    const a = { ...createStoryTheaterDraft(), id: prefix + '-real-a', title: '真实场景 A', characterIds: actors.map(actor => actor.id), writesToCharacterMemory: true };
    const b = { ...a, id: prefix + '-real-b', title: '真实场景 B' };
    const fiction = { ...a, id: prefix + '-fiction', title: '虚构世界', writesToCharacterMemory: false };
    for (const entry of [a, b, fiction]) await DB.saveStoryTheater(entry);
    return { actors, a, b, fiction, from: actors[0].id, to: actors[1].id, other: actors[2].id };
}
async function seed(entry: StoryTheaterEntry, content: string, metadata = {}) {
    const id = await DB.saveMessage({ charId: storyTheaterThreadId(entry.id), role: 'assistant', type: 'text', content,
        metadata: { source: 'story_theater', theaterId: entry.id, ...metadata } });
    return (await DB.getMessageById(id))!;
}
function prepareReply(content: string, graph: RealRelationshipGraph, actors: Awaited<ReturnType<typeof fixture>>['actors']) {
    const issues: string[] = [];
    const panel = parseStoryRelationshipContent(content, reason => issues.push(reason));
    const payload = panel && realRelationshipPayload(panel, actors, realRelationshipBaseline(graph, actors), reason => issues.push(reason));
    return { content: stripStoryRelationshipPanels(content), payload, issues };
}
async function turn(f: Awaited<ReturnType<typeof fixture>>, entry: StoryTheaterEntry, raw: string,
    options: { castFailed?: boolean; replace?: Message; snapshot?: RealRelationshipGraph; failMirror?: boolean } = {}) {
    const snapshot = options.snapshot || await DB.getRealRelationshipGraph();
    const baseline = realRelationshipGraphBefore(snapshot, options.replace?.id);
    const prepared = prepareReply(raw, baseline, f.actors);
    const pending = options.replace ? undefined : (await DB.getMessageById(await DB.saveMessage({
        charId: storyTheaterThreadId(entry.id), role: 'user', type: 'text', content: '继续本轮',
        metadata: { source: 'story_theater', theaterId: entry.id },
    })))!;
    const cast = options.castFailed ? [] : [f.from, f.to];
    await DB.commitStoryTheaterTurn({ charId: storyTheaterThreadId(entry.id), role: 'assistant', type: 'text', timestamp: 1,
        content: prepared.content, metadata: { source: 'story_theater', theaterId: entry.id, theaterCastIds: cast,
            theaterCandidateIds: f.actors.map(actor => actor.id), theaterCastStatus: options.castFailed ? 'invalid' : 'reported',
            theaterRealRelationshipProtocol: 1, theaterRealRelationshipEvent: prepared.payload,
            theaterRelationshipScope: 'real', theaterInputId: pending?.id || 0,
        } }, pending, cast, (id, original) => {
            if (options.failMirror && original.role === 'assistant') throw new Error('模拟镜像保存失败');
            return createStoryTheaterMirrorMessage(entry, id, original);
        }, options.replace, { entry, signature: realRelationshipSignature(snapshot) });
    return (await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true)).at(-1)!;
}

describe('真实世界关系网独立状态', () => {
    it('按原楼层 ID 补录旧缓存遗漏的三轴，保留手动编辑和现有事件', async () => {
        const f = await fixture('repair-missing-event');
        const initial = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        // Old clients treated a protocol stamp with missing metadata as final, even with a valid panel.
        const missing = await seed(f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]),
            { theaterRealRelationshipProtocol: 1, theaterRelationshipScope: 'real' });
        await seed(f.fiction, report([row(f.from, f.to, { FL: { score: 99, ...fact } })]));
        const graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to).axes.FL?.score).toBe(10);
        const edited = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '朋友', axes: {}, reason: '校正称谓' }, graph.revision);
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('assets', 'readwrite');
            const oldGraph = { ...edited, historyReconciled: undefined,
                events: edited.events.filter(event => event.id !== `story:${missing.id}`),
                directions: { ...edited.directions, [realRelationshipKey(f.from, f.to)]: {
                    ...direction(edited, f.from, f.to), axes: { FL: { score: 5 } },
                } } };
            tx.objectStore('assets').put({ id: REAL_RELATIONSHIP_GRAPH_KEY, data: JSON.stringify(oldGraph) });
            tx.oncomplete = () => resolve();
            tx.onabort = () => reject(tx.error);
        });
        const repaired = await DB.getRealRelationshipGraph();
        expect(direction(repaired, f.from, f.to)).toMatchObject({ identity: '朋友', axes: { FL: { score: 10 } } });
        expect(repaired.events.filter(event => event.source.messageId === initial.id)).toHaveLength(1);
        expect(repaired.events.filter(event => event.source.messageId === missing.id)).toHaveLength(1);
        expect(repaired.revision).toBeGreaterThan(edited.revision);
        expect(await DB.getRealRelationshipGraph()).toEqual(repaired);
        await DB.deleteMessage(missing.id);
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to)).toMatchObject({ identity: '朋友', axes: { FL: { score: 5 } } });
    });

    it('首次读取兼容旧五维与三轴，旧绝对分不相加；后续读取不再扫描剧情', async () => {
        const f = await fixture('migration');
        await seed(f.a, '<affinity_panel><affinity_person><character_id>' + f.from + '</character_id><trust>99</trust><state_note>我愿再相信一次</state_note></affinity_person></affinity_panel>');
        await seed(f.a, report([row(f.from, f.to, { FL: { score: 0 }, RI: { score: 12 } })]));
        await seed(f.b, report([row(f.to, f.from, { FL: { score: 83 } })]), { theaterCastIds: [] });
        await seed(f.fiction, report([row(f.from, f.to, { FL: { score: 100 } })]));
        const graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to).axes).toMatchObject({ FL: { score: 0 }, RI: { score: 12 } });
        expect(direction(graph, f.from, f.to).axes.DI).toBeUndefined();
        expect(direction(graph, f.to, f.from).axes.FL?.score).toBe(83);
        expect(graph.stateNotes[f.from].note).toBe('我愿再相信一次');
        const scan = vi.spyOn(IDBIndex.prototype, 'openCursor');
        try { await DB.getRealRelationshipGraph(); await DB.getRealRelationshipGraph(); expect(scan).not.toHaveBeenCalled(); }
        finally { scan.mockRestore(); }
    });

    it('FL=5 → 出演名单解析失败（有效关系仍保存）→ 下一轮 FL+5 = 10', async () => {
        const f = await fixture('cast-failed');
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        const failed = await turn(f, f.a, report([row(f.from, f.to, {}, { identity: '可靠的朋友', cognition: '我知道她会履约', ...fact })]), { castFailed: true });
        expect(failed.metadata?.theaterCastIds).toEqual([]);
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to)).toMatchObject({ identity: '可靠的朋友', axes: { FL: { score: 5 } } });
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(10);
        const firstFailed = await fixture('first-cast-failed');
        await turn(firstFailed, firstFailed.a, report([row(firstFailed.from, firstFailed.to, { FL: { score: 5, ...fact } })]), { castFailed: true });
        await turn(firstFailed, firstFailed.b, report([row(firstFailed.from, firstFailed.to, { FL: { delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), firstFailed.from, firstFailed.to).axes.FL?.score).toBe(10);
    });

    it('真实 A / B 正确续接；虚构记录、无变化回合和关系格式失败均不清零', async () => {
        const f = await fixture('continuity');
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        expect(buildStoryRelationshipGuide(realRelationshipBaseline(await DB.getRealRelationshipGraph(), f.actors), '真实世界')).toContain('"score":5');
        const previous = await DB.getRealRelationshipGraph();
        await seed(f.fiction, report([row(f.from, f.to, { FL: { score: 99 } })]), { theaterRealRelationshipProtocol: 1,
            theaterRealRelationshipEvent: prepareReply(report([row(f.from, f.to, { FL: { score: 99, ...fact } })]), previous, f.actors).payload });
        await turn(f, f.a, '<story_text>独自整理信件。</story_text>');
        await turn(f, f.a, '<story_text>剧情仍有效。</story_text><relationship_panel>{broken');
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(5);
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(10);
    });

    it('两个方向及同名人物独立；关系认同变化不带动任何数值', async () => {
        const f = await fixture('directions');
        await turn(f, f.a, report([
            row(f.from, f.to, { FL: { score: 20, ...fact }, RI: { score: 30, ...fact }, DI: { score: 80, ...fact, phase: 'active', strength: 'strong' } }),
            row(f.to, f.from, { FL: { score: 75, ...fact } }), row(f.other, f.to, { FL: { score: 42, ...fact } }),
        ]));
        await turn(f, f.b, report([row(f.from, f.to, {}, { identity: '恋人', cognition: '我愿意承认我们刚确认的约定', ...fact })]));
        let graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to)).toMatchObject({ identity: '恋人', axes: { FL: { score: 20 }, RI: { score: 30 }, DI: { score: 80 } } });
        expect(direction(graph, f.to, f.from).identity).toBeUndefined();
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 2, ...fact } })]));
        graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to)).toMatchObject({ identity: '恋人', axes: { FL: { score: 22 }, DI: { score: 80 } } });
        expect(direction(graph, f.to, f.from).axes.FL?.score).toBe(75);
        expect(direction(graph, f.other, f.to).axes.FL?.score).toBe(42);
        await turn(f, f.b, report([row(f.from, f.to, { DI: { delta: 0, ...fact, phase: 'ended', strength: 'strong' } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.DI?.score).toBe(64);
    });

    it('第一视角认知只存中央 metadata/独立图，文本镜像不携带其他人物的内心', async () => {
        const f = await fixture('privacy'), secret = '只有我知道，我仍对她心存疑虑', selfNote = '我还有一件未对她表达的事';
        const reply = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } }, { identity: '伙伴', cognition: secret, ...fact })], {
            state_notes: { [f.from]: { name: '狛治', note: selfNote } },
        }));
        expect(reply.metadata?.theaterRealRelationshipEvent.updates[0].direction.cognition).toBe(secret);
        expect(reply.content).not.toContain(secret);
        for (const actor of [f.from, f.to]) {
            const mirrors = (await DB.getMessagesByCharId(actor, true)).filter(value => value.metadata?.theaterId === f.a.id);
            expect(mirrors).toHaveLength(2);
            expect(mirrors.some(value => value.content.includes(secret))).toBe(false);
            expect(mirrors.some(value => value.content.includes(selfNote) || value.content.includes('<affinity_panel'))).toBe(false);
            expect(mirrors.some(value => value.metadata?.theaterRealRelationshipEvent)).toBe(false);
        }
        expect(STORY_RELATIONSHIP_PROMPT).toContain('其他人物不能知道未表达的内心');
    });

    it('人工修改真实出演名单继续维护正文镜像，独立关系和私有认知不随名单丢失', async () => {
        const f = await fixture('manual-cast');
        const reply = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } }, { identity: '伙伴', cognition: '我愿意相信她', ...fact })]));
        const before = await DB.getRealRelationshipGraph();
        await DB.commitStoryTheaterTurn(reply, undefined, [f.from, f.other], (id, original) => createStoryTheaterMirrorMessage(f.a, id, original), { castEdit: reply });
        expect(await DB.getRealRelationshipGraph()).toEqual(before);
        expect((await DB.getMessageById(reply.id))?.metadata?.theaterCastIds).toEqual([f.from, f.other]);
        expect((await DB.getMessagesByCharId(f.to, true)).filter(message => message.metadata?.theaterId === f.a.id)).toEqual([]);
        const added = (await DB.getMessagesByCharId(f.other, true)).filter(message => message.metadata?.theaterId === f.a.id);
        expect(added).toHaveLength(2);
        expect(added[1].content).toBe('<story_text>旧信如约归还。</story_text>');
    });

    it('失败整轮回滚；元数据更新、归档和私轴保存不重复加分', async () => {
        const f = await fixture('atomic');
        const before = await DB.getRealRelationshipGraph();
        await expect(turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]), { failMirror: true })).rejects.toThrow('模拟镜像保存失败');
        expect(await DB.getRealRelationshipGraph()).toEqual(before);
        const saved = await turn(f, f.b, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        const original = await DB.getRealRelationshipGraph();
        await DB.updateMessageMetadata(saved.id, metadata => ({ ...metadata, theaterArchived: true }));
        await DB.updateStoryTheaterPrivateAxis(saved, f.from, '我在整理自己的信');
        await DB.updateMessageMetadata(saved.id, metadata => ({ ...metadata, harmless: true }));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(5);
        expect((await DB.getRealRelationshipGraph()).events.filter(event => event.source.messageId === saved.id)).toHaveLength(1);
        expect((await DB.getRealRelationshipGraph()).revision).toBe(original.revision);
    });

    it('重写和删除旧剧情重算后续增量，保留原消息 ID，不让快照复活被删初值', async () => {
        const f = await fixture('rewrite');
        const first = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 10, ...fact } })]));
        const second = await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(15);
        const rewritten = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 30, ...fact } })]), { replace: first });
        expect(rewritten.id).toBe(first.id);
        expect(parseStoryRelationshipContent(rewritten.content)?.relationships[0].axes.FL?.score).toBe(30);
        const graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to).axes.FL?.score).toBe(35);
        const retried = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 30, ...fact } })]), { replace: rewritten });
        expect(retried.content).toBe(rewritten.content);
        expect((await DB.getRealRelationshipGraph()).revision).toBe(graph.revision);
        await DB.deleteMessages([first.id]);
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL).toBeUndefined();
        expect(await DB.getMessageById(second.id)).not.toBeNull();
    });

    it('重写旧的无关系楼层也按原位置插入；手动修正保持其原来时序', async () => {
        const f = await fixture('backdated');
        const first = await turn(f, f.a, '<story_text>独自阅读。</story_text>');
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]));
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 20, ...fact } })]), { replace: first });
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(25);
        let graph = await DB.getRealRelationshipGraph();
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '朋友', cognition: '我选择相信她', axes: { FL: 50, RI: null }, reason: '校正既有关系' }, graph.revision);
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 40, ...fact } })]), { replace: (await DB.getMessageById(first.id))! });
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(50);
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 2, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(52);
        expect(graph.directions[realRelationshipKey(f.from, f.to)].axes.RI).toBeUndefined();
    });

    it('未初始化与真正 0 分独立，手动编辑及并发校验不覆盖新状态', async () => {
        const f = await fixture('zero');
        await turn(f, f.a, report([row(f.from, f.to, {}, { identity: '陌生人', ...fact })]));
        let graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to).axes.FL).toBeUndefined();
        const oldRevision = graph.revision;
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '陌生人', cognition: '', axes: { FL: 0 }, reason: '确认无联结' }, graph.revision);
        expect(direction(graph, f.from, f.to).axes.FL?.score).toBe(0);
        await expect(DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '', cognition: '', axes: { FL: 90 }, reason: '' }, oldRevision)).rejects.toThrow('别处更新');
        await turn(f, f.b, report([row(f.from, f.to, { FL: { score: 99, delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(5);
    });

    it('两个真实场景并发提交同一基线，只有一笔成功；失败重试不叠加旧评分', async () => {
        const f = await fixture('concurrent'), snapshot = await DB.getRealRelationshipGraph();
        const results = await Promise.allSettled([
            turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]), { snapshot }),
            turn(f, f.b, report([row(f.from, f.to, { FL: { score: 9, ...fact } })]), { snapshot }),
        ]);
        expect(results.filter(value => value.status === 'fulfilled')).toHaveLength(1);
        expect(results.filter(value => value.status === 'rejected')).toHaveLength(1);
        const graph = await DB.getRealRelationshipGraph();
        expect([5, 9]).toContain(direction(graph, f.from, f.to).axes.FL?.score);
        const winner = results[0].status === 'fulfilled' ? results[0].value : (results[1] as PromiseFulfilledResult<Message>).value;
        await DB.updateMessageMetadata(winner.id, metadata => ({ ...metadata }));
        expect(await DB.getRealRelationshipGraph()).toEqual(graph);
    });

    it('完整备份恢复独立状态、私有认知、手动事件与布局，旧备份不承接恢复前的关系缓存', async () => {
        const f = await fixture('backup');
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 11, ...fact } })]));
        let graph = await DB.getRealRelationshipGraph();
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '挚友', cognition: '我仍记得她履约', axes: { FL: 50, RI: 0 }, reason: '补回既有经历' }, graph.revision);
        await Promise.all([DB.patchRealRelationshipLayout({ positions: { [f.from]: { x: 73, y: 81 } } }), DB.patchRealRelationshipLayout({ positions: { [f.to]: { x: 302, y: 40 } }, viewport: { x: 20, y: 10, zoom: 0.8 } })]);
        const layout = await DB.getRealRelationshipLayout();
        expect(layout.positions[f.from]).toEqual({ x: 73, y: 81 });
        expect(layout.positions[f.to]).toEqual({ x: 302, y: 40 });
        const backup = JSON.parse(JSON.stringify(await DB.exportFullData()));
        await DB.deleteStoryTheater(f.a.id);
        await DB.importFullData(backup);
        const restored = await DB.getRealRelationshipGraph();
        expect(restored.revision).toBeGreaterThan(graph.revision);
        expect(JSON.parse(JSON.stringify({ ...restored, revision: 0 }))).toEqual(JSON.parse(JSON.stringify({ ...graph, revision: 0 })));
        expect(await DB.getRealRelationshipLayout()).toEqual(layout);
        const oldBackup = JSON.parse(JSON.stringify(await DB.exportFullData()));
        oldBackup.assets = oldBackup.assets.filter((asset: { id: string }) => asset.id !== REAL_RELATIONSHIP_GRAPH_KEY);
        await DB.importFullData(oldBackup);
        const migrated = await DB.getRealRelationshipGraph();
        expect(direction(migrated, f.from, f.to).axes.FL?.score).toBe(11);
        expect(direction(migrated, f.from, f.to).identity).toBeUndefined();
    });

    it('自由续写重写和整剧场删除走同一关系账本，损坏存档不被自动清零', async () => {
        const f = await fixture('free');
        const saved = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        const snapshot = await DB.getRealRelationshipGraph();
        const next = prepareReply(report([row(f.from, f.to, { FL: { score: 22, ...fact } })]), realRelationshipGraphBefore(snapshot, saved.id), f.actors);
        await replaceStoryTheaterReply(saved, next.content, { theaterRelationshipScope: 'real', theaterRealRelationshipProtocol: 1, theaterRealRelationshipEvent: next.payload }, true, undefined,
            { entry: f.a, signature: realRelationshipSignature(snapshot) });
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(22);
        await DB.deleteStoryTheater(f.a.id);
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to)).toBeUndefined();
        const valid = await DB.getRealRelationshipGraph();
        await DB.saveAsset(REAL_RELATIONSHIP_GRAPH_KEY, '{invalid');
        await expect(DB.getRealRelationshipGraph()).rejects.toThrow();
        expect(await DB.getAsset(REAL_RELATIONSHIP_GRAPH_KEY)).toBe('{invalid');
        await DB.saveAsset(REAL_RELATIONSHIP_GRAPH_KEY, JSON.stringify(valid));
    });

    it('仅恢复消息补丁时保留原有手动关系和画布，不把未改动数值当作关系认同的附属状态', async () => {
        const f = await fixture('patch-restore');
        const first = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        let graph = await DB.getRealRelationshipGraph();
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '朋友', axes: {}, reason: '只补关系认同' }, graph.revision);
        await DB.patchRealRelationshipLayout({ positions: { [f.from]: { x: 111, y: 222 } } });
        const prepared = prepareReply(report([row(f.from, f.to, { FL: { score: 20, ...fact } })]), realRelationshipGraphBefore(graph, first.id), f.actors);
        await DB.importFullData({ messages: [{ ...first, content: prepared.content, metadata: { ...first.metadata, theaterRealRelationshipEvent: prepared.payload } }] } as any);
        graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to)).toMatchObject({ identity: '朋友', axes: { FL: { score: 20 } } });
        expect((await DB.getRealRelationshipLayout()).positions[f.from]).toEqual({ x: 111, y: 222 });
        await turn(f, f.b, report([row(f.from, f.to, { FL: { delta: 5, ...fact } })]));
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to).axes.FL?.score).toBe(25);
    });

    it('分批恢复中途失败时仍保留关系账本、手动记录与布局', async () => {
        const f = await fixture('failed-restore');
        let graph = await DB.getRealRelationshipGraph();
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '朋友', axes: { FL: 5 }, reason: '原有关系' }, graph.revision);
        await DB.patchRealRelationshipLayout({ positions: { [f.from]: { x: 17, y: 29 } } });
        const backup = JSON.parse(JSON.stringify(await DB.exportFullData()));
        await expect(DB.importFullData(backup, { onProgress: progress => {
            if (progress.label === '剧情剧场' && progress.stage === 'start') throw new Error('模拟中断');
        } })).rejects.toThrow('模拟中断');
        expect(await DB.getRealRelationshipGraph()).toEqual(graph);
        expect((await DB.getRealRelationshipLayout()).positions[f.from]).toEqual({ x: 17, y: 29 });
    });

    it('纯文字备份保留关系与布局，纯媒体恢复不能覆盖关系；独立用户导入重建人物对键', async () => {
        const f = await fixture('backup-modes');
        await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        let graph = await DB.getRealRelationshipGraph();
        graph = await DB.editRealRelationship({ fromId: f.from, toId: f.to, identity: '朋友', axes: {}, reason: '确认认同' }, graph.revision);
        await DB.patchRealRelationshipLayout({ positions: { [f.from]: { x: 30, y: 50 } } });
        const full = JSON.parse(JSON.stringify(await DB.exportFullData()));
        const textAssets = full.assets.map(exportActivityTextAsset).filter(Boolean);
        expect(textAssets.find((asset: { id: string }) => asset.id === REAL_RELATIONSHIP_GRAPH_KEY)).toBeDefined();
        await DB.importFullData({ collaborationBackupMode: 'media_only', assets: [{ id: REAL_RELATIONSHIP_GRAPH_KEY, data: '{invalid' }] } as any);
        expect(await DB.getRealRelationshipGraph()).toEqual(graph);
        await DB.editRealRelationship({ fromId: f.from, toId: f.to, axes: { FL: 90 }, reason: '临时修改' }, graph.revision);
        await DB.importFullData({ ...full, assets: undefined, activityTextAssets: textAssets });
        graph = await DB.getRealRelationshipGraph();
        expect(direction(graph, f.from, f.to)).toMatchObject({ identity: '朋友', axes: { FL: { score: 5 } } });
        expect((await DB.getRealRelationshipLayout()).positions[f.from]).toEqual({ x: 30, y: 50 });
        const assets = (await DB.exportFullData()).assets!;
        const remapped = remapIndependentUser({ characters: f.actors, assets }, {}, {}, new Map());
        const imported = JSON.parse(remapped.tables.assets.find(asset => asset.id === REAL_RELATIONSHIP_GRAPH_KEY).data);
        const [from, to] = remapped.tables.characters;
        expect(direction(imported, from.id, to.id)).toMatchObject({ fromId: from.id, toId: to.id, axes: { FL: { score: 5 } } });
        expect(imported.directions[realRelationshipKey(f.from, f.to)]).toBeUndefined();
    });

    it('无效人物、重复方向、缺少初始值不被误判为空报告，显式空报告才能撤销重写楼层的事件', async () => {
        const f = await fixture('invalid-rewrite');
        const original = await turn(f, f.a, report([row(f.from, f.to, { FL: { score: 5, ...fact } })]));
        const graph = await DB.getRealRelationshipGraph();
        for (const invalid of [[null], [row('unknown', f.to, { FL: { score: 88, ...fact } })],
            [row(f.from, f.to, { FL: { delta: 5 } })],
            [row(f.from, f.to, { FL: { delta: 5, ...fact } }), row(f.from, f.to, { FL: { delta: 5, ...fact } })]]) {
            const prepared = prepareReply(report(invalid), realRelationshipGraphBefore(graph, original.id), f.actors);
            expect(prepared.payload).toBeUndefined();
        }
        const malformedXml = prepareReply('<affinity_panel mode="three_axes"><FL><delta>5</delta></FL></affinity_panel>', graph, f.actors);
        expect(malformedXml.payload).toBeUndefined();
        expect(malformedXml.issues).toEqual(['三轴关系面板中缺少有效的人物方向或自我记录']);
        await turn(f, f.a, report([]), { replace: original });
        expect(direction(await DB.getRealRelationshipGraph(), f.from, f.to)).toBeUndefined();
    });
});
