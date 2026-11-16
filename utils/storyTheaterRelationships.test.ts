import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { createStoryTheaterDraft, normalizeStoryTheater, parseStoryDisplayBlocks } from './storyTheater';
import {
    buildStoryRelationshipGuide, getStoryRelationshipBaseline, reconcileStoryRelationships,
    STORY_RELATIONSHIP_PROMPT, stripStoryRelationshipPanels,
} from './storyTheaterRelationships';

const a = { id: 'a', name: '林星' };
const b = { id: 'b', name: '白露' };
const c = { id: 'c', name: '林星' };
const cast = [a, b, c];
const fact = { trigger: '白露在车站等林星', evidence: '林星注意到对方履行了约定' };

const message = (content: string, id = 1): Message => ({
    id, charId: 'story-theater:test', role: 'assistant', type: 'text', content, timestamp: id,
});

function proposal(primaryId: string, relationships: unknown[], stateNote?: string): string {
    return '<story_text>灯亮了。</story_text><relationship_panel>' + JSON.stringify({
        primaryId, state_note: stateNote, relationships,
    }) + '</relationship_panel>';
}

const snapshot = (content: string) => parseStoryDisplayBlocks(content).find(block => block.relationship)?.relationship;
const baseline = (rows: Message[] = [], primary = a) => getStoryRelationshipBaseline(rows, primary, cast);
const pair = (fromId: string, toId: string, axes: object) => ({ fromId, toId, axes });

describe('剧场双向关系三轴', () => {
    it('分别依据每个方向的证据更新三轴，并校正越界值和错误绝对值', () => {
        const content = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { FL: { score: 98, ...fact }, RI: { score: 20, ...fact }, DI: { score: 0 } }),
            pair(b.id, a.id, { FL: { score: 10, ...fact }, RI: { score: 2, ...fact }, DI: { score: 0 } }),
        ]), baseline());
        const next = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { FL: { score: 12, delta: 9, ...fact }, RI: { delta: -10 } }),
            pair(b.id, a.id, { FL: { delta: -20, ...fact }, RI: { delta: 7, ...fact } }),
            pair(b.id, c.id, { FL: { score: 99, ...fact } }),
        ]), baseline([message(content)]));
        expect(snapshot(next)?.relationships).toEqual([
            expect.objectContaining({ fromId: b.id, toId: a.id, axes: {
                FL: { score: 0, delta: -10, ...fact },
                RI: { score: 9, delta: 7, ...fact },
                DI: expect.objectContaining({ score: 0 }),
            } }),
            expect.objectContaining({ fromId: a.id, toId: b.id, axes: {
                FL: { score: 100, delta: 2, ...fact },
                RI: expect.objectContaining({ score: 20, delta: 0 }),
                DI: expect.objectContaining({ score: 0 }),
            } }),
        ]);
        expect(STORY_RELATIONSHIP_PROMPT).toContain('普通好奇不计入');
        expect(STORY_RELATIONSHIP_PROMPT).toContain('时间和距离本身不扣分');
        expect(STORY_RELATIONSHIP_PROMPT).toContain('成长激励');
    });

    it('切换主要角色时，只续接相同 ID 和方向的关系，重名角色互不影响', () => {
        const content = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { FL: { score: 37, ...fact } }),
            pair(c.id, a.id, { RI: { score: 80, ...fact } }),
        ], '林星仍在犹豫'), baseline());
        const switched = baseline([message(content)], b);
        expect(switched.state_note).toBe('');
        expect(switched.relationships.find(row => row.fromId === a.id && row.toId === b.id)?.axes.FL?.score).toBe(37);
        expect(switched.relationships.find(row => row.fromId === b.id && row.toId === a.id)?.axes).toEqual({});
        expect(switched.relationships.find(row => row.fromId === c.id && row.toId === b.id)?.axes).toEqual({});
        expect(reconcileStoryRelationships(proposal(a.id, [pair(c.id, b.id, { FL: { score: 100, ...fact } })]), switched))
            .not.toContain('"score":100');
    });

    it('沿用并更新主要角色自己的 state_note，单人剧场也可记录', () => {
        const selfBaseline = getStoryRelationshipBaseline([], a, [a]);
        const start = reconcileStoryRelationships(proposal(a.id, [], '愿意先把话说清楚'), selfBaseline);
        expect(snapshot(start)).toMatchObject({ primaryId: a.id, state_note: '愿意先把话说清楚', relationships: [] });
        const prior = getStoryRelationshipBaseline([message(start)], a, [a]);
        expect(snapshot(reconcileStoryRelationships('<story_text>稍等。</story_text>', prior))?.state_note).toBe('愿意先把话说清楚');
        expect(snapshot(reconcileStoryRelationships(proposal(a.id, [], '决定接受道歉'), prior))?.state_note).toBe('决定接受道歉');
    });

    it('旧剧场保留历史温度和五维供回看，选择 U 后独立建立三轴', () => {
        const draft = normalizeStoryTheater({ ...createStoryTheaterDraft(), characterIds: [a.id, b.id] });
        expect(draft.primaryCharacterId).toBeUndefined();
        expect(normalizeStoryTheater({ ...draft, primaryCharacterId: a.id }).primaryCharacterId).toBe(a.id);
        expect(normalizeStoryTheater({ ...draft, primaryCharacterId: a.id, characterIds: [b.id] }).primaryCharacterId).toBeUndefined();
        const old = '<story_text>旧事发生。</story_text><affinity_panel><affinity_person><character_id>a</character_id><c_to_u_score>83</c_to_u_score><trust>91</trust><possessive_pull>77</possessive_pull><state_note>终于愿意听完</state_note></affinity_person></affinity_panel>';
        expect(parseStoryDisplayBlocks(old).map(block => block.kind)).toEqual(['story', 'affinity']);
        expect(buildStoryRelationshipGuide()).toContain('尚未选择主要角色');
        expect(reconcileStoryRelationships(old)).toBe('<story_text>旧事发生。</story_text>');
        const prior = baseline([message(old)]);
        expect(prior.state_note).toBe('终于愿意听完');
        expect(baseline([message(old)], c).state_note).toBe('');
        expect(prior.relationships.every(row => Object.keys(row.axes).length === 0)).toBe(true);
        const initialized = reconcileStoryRelationships(proposal(a.id, [pair(a.id, b.id, { FL: { score: 12, ...fact } })]), prior);
        expect(snapshot(initialized)?.relationships[0].axes.FL?.score).toBe(12);
    });

    it.each([
        ['mild', 75, 70],
        ['moderate', 56, 39],
        ['strong', 64, 51],
    ] as const)('DI %s 在事件结束和空轮分别衰减，FL 和 RI 保持原值', (strength, ended, idle) => {
        const first = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, {
                FL: { score: 57, ...fact }, RI: { score: 23, ...fact },
                DI: { score: 80, ...fact, strength, phase: 'active' },
            }),
        ]), baseline());
        const second = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { DI: { delta: 0, ...fact, strength, phase: 'ended' } }),
        ]), baseline([message(first)]));
        expect(snapshot(second)?.relationships[0].axes.DI).toMatchObject({ score: ended, delta: ended - 80, ...fact });
        const third = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { DI: { score: 100, delta: 30, strength, phase: 'active' } }),
        ]), baseline([message(second)]));
        expect(snapshot(third)?.relationships[0].axes).toMatchObject({
            FL: { score: 57 }, RI: { score: 23 }, DI: { score: idle, delta: idle - ended },
        });
        expect(baseline([message(first), message('没有面板', 2)]).relationships[1].axes.DI?.score).toBe(ended);
    });

    it('丢弃损坏的关系面板，保留正文与已建立的关系', () => {
        const first = reconcileStoryRelationships(proposal(a.id, [
            pair(a.id, b.id, { FL: { score: 15, ...fact } }),
        ]), baseline());
        const content = reconcileStoryRelationships('<story_text>新正文</story_text><relationship_panel>{bad', baseline([message(first)]));
        expect(stripStoryRelationshipPanels(content)).toBe('<story_text>新正文</story_text>');
        expect(snapshot(content)?.relationships[0].axes.FL?.score).toBe(15);
    });
});
