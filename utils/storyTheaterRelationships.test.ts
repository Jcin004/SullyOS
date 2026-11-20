import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { createStoryTheaterDraft, normalizeStoryTheater, parseStoryDisplayBlocks, BUILTIN_NIGHT_SCREENING_PRESET, resolveStoryPresetDocument } from './storyTheater';
import { buildStoryRelationshipGuide, buildStoryRelationshipPayload, getStoryRelationshipBaseline, parseStoryRelationshipContent,
    reconcileStoryRelationships, restrictStoryRelationshipsToCast,
    stripStoryRelationshipPanels, STORY_RELATIONSHIP_PROMPT, STORY_RELATIONSHIP_PROMPT_ID,
    LEGACY_CENTERED_STORY_RELATIONSHIP_PROMPT, LEGACY_PAIR_STORY_RELATIONSHIP_PROMPT, LEGACY_REAL_STORY_RELATIONSHIP_PROMPT } from './storyTheaterRelationships';

const a = { id: 'a', name: '狛治' }, b = { id: 'b', name: '香奈乎' }, c = { id: 'c', name: '狛治' };
const actors = [a, b, c];
const fact = { trigger: '在车站等候', evidence: '注意到对方履行了约定' };
const message = (content: string, id = 1, metadata = {}): Message => ({
    id, charId: 'story-theater:test', role: 'assistant', type: 'text', content, timestamp: 100 - id, metadata,
});
const pair = (fromId: string, toId: string, axes: object) => ({ fromId, toId, axes });
const proposal = (relationships: unknown[], extra = {}) => '<story_text>灯亮了。</story_text><relationship_panel>'
    + JSON.stringify({ relationships, ...extra }) + '</relationship_panel>';
const snapshot = (content: string) => parseStoryDisplayBlocks(content).find(block => block.relationship)?.relationship;
const baseline = (rows: Message[] = []) => getStoryRelationshipBaseline(rows, actors);
const direction = (panel: ReturnType<typeof baseline> | undefined, from = a.id, to = b.id) =>
    panel?.relationships.find(row => row.fromId === from && row.toId === to);
const generate = (rows: unknown[], history: Message[] = []) => reconcileStoryRelationships(proposal(rows), baseline(history));

describe('按实际人物对的三轴关系', () => {
    it('轻微心动、好奇、共因双轴与结束阶段独立结算，只有 score 能初始化', () => {
        const curiosity = '<affinity_panel mode="three_axes"><affinity_person><from_id>a</from_id><to_id>b</to_id>'
            + '<DI><score>12</score><trigger>好奇</trigger><evidence>反复观察对方，错过报站</evidence></DI></affinity_person></affinity_panel>';
        const first = reconcileStoryRelationships(curiosity, baseline());
        expect(direction(snapshot(first))?.axes).toMatchObject({ DI: { score: 12, strength: 'mild', phase: 'active' } });
        expect(direction(snapshot(first))?.axes.RI).toBeUndefined();
        const second = generate([pair(a.id, b.id, {
            RI: { score: 2, trigger: '轻声答谢', evidence: '微微想以恋人身份靠近' },
        })], [message(first)]);
        expect(direction(snapshot(second))?.axes.RI?.score).toBe(2);
        expect(direction(snapshot(second))?.axes.FL).toBeUndefined();
        const third = generate([pair(a.id, b.id, {
            RI: { delta: 1, trigger: '突然靠近', evidence: '期待将来还会亲近' },
            DI: { delta: 6, trigger: '突然靠近', evidence: '忘了下一句话' },
        })], [message(first), message(second, 2)]);
        expect(direction(snapshot(third))?.axes).toMatchObject({ RI: { score: 3 }, DI: { score: 18 } });
        const carried = [message(first), message(second, 2), message(third, 3)];
        const ended = generate([pair(a.id, b.id, { DI: { phase: 'ended', ...fact } })], carried);
        expect(direction(snapshot(ended))?.axes.DI?.score).toBe(13);
        expect(direction(baseline([...carried, message(ended, 4)]))?.axes.RI?.score).toBe(3);
        expect(snapshot(generate([pair(a.id, b.id, { RI: { delta: 1, ...fact }, DI: { delta: 5, ...fact } })]))).toBeUndefined();
        const zero = generate([pair(a.id, b.id, { RI: { score: 0, ...fact } })]);
        expect(direction(snapshot(generate([pair(a.id, b.id, { RI: { delta: 1, ...fact } })], [message(zero)])))?.axes.RI?.score).toBe(1);
    });

    it('结构化回放承接独立文字和三轴，无需从正文重复解析，也不把变化证据放入快照', () => {
        const start = generate([pair(a.id, b.id, { FL: { score: 30, ...fact }, RI: { score: 7, ...fact } })]);
        const previous = baseline([message(start)]);
        const raw = proposal([{ ...pair(a.id, b.id, {}), ...fact, identity: '朋友', cognition: '我更愿意主动交谈',
            relation_note: '信任逐渐稳定', relation_fragments: ['她主动归还旧信'] }], {
            state_notes: { a: { name: a.name, note: '我决定兑现承诺' } },
        });
        const payload = buildStoryRelationshipPayload(parseStoryRelationshipContent(raw), actors, previous, () => {});
        const content = reconcileStoryRelationships(stripStoryRelationshipPanels(raw), previous, { payload });
        expect(snapshot(content)?.relationships[0]).toMatchObject({ relation_note: '信任逐渐稳定', axes: {} });
        expect(content).not.toContain('我更愿意主动交谈');
        const state = baseline([message(start), message('<story_text>正文。</story_text>', 2, { theaterStoryRelationshipEvent: payload })]);
        expect(direction(state)).toMatchObject({ identity: '朋友', cognition: '我更愿意主动交谈', relation_fragments: ['她主动归还旧信'],
            axes: { FL: { score: 30 }, RI: { score: 7 } } });
        const guide = buildStoryRelationshipGuide(state);
        expect(guide).toContain('信任逐渐稳定');
        expect(guide).toContain('我决定兑现承诺');
        expect(guide).not.toContain('她主动归还旧信');
        expect(guide).not.toContain(fact.evidence);
    });

    it('多人同楼层仅给实际交流的人物方向结算衰减', () => {
        const first = generate([pair(a.id, b.id, { DI: { score: 20, ...fact } }),
            pair(a.id, c.id, { DI: { score: 20, ...fact } })]);
        const state = baseline([message(first)]);
        const cast = new Set(actors.map(actor => actor.id));
        expect(buildStoryRelationshipPayload(undefined, actors, state, () => {}, { cast, interactions: [] })).toBeUndefined();
        const payload = buildStoryRelationshipPayload(undefined, actors, state, () => {}, { cast, interactions: [[a.id, b.id]] });
        const carried = baseline([message(first), message('一起等车', 2, { theaterStoryRelationshipEvent: payload })]);
        expect(direction(carried, a.id, b.id)?.axes.DI?.score).toBe(15);
        expect(direction(carried, a.id, c.id)?.axes.DI?.score).toBe(20);
    });

    it('首次 FL 依据角色卡、既有关系和共同经历，两个方向独立初始化', () => {
        expect(STORY_RELATIONSHIP_PROMPT).toContain('既有经历、关系状态和当下情境');
        const guide = buildStoryRelationshipGuide(baseline(), '虚构剧场 test');
        expect(guide).toContain('关系历史归属：虚构剧场 test');
        expect(guide).toContain('"actors":[{"id":"a"');
        expect(guide).not.toContain('trigger');
        expect(STORY_RELATIONSHIP_PROMPT).toContain('各自写 trigger 和 evidence');
        const first = generate([pair(a.id, b.id, { FL: { score: 74, ...fact } }), pair(b.id, a.id, { FL: { score: 63, ...fact } })]);
        expect(direction(snapshot(first))?.axes.FL).toMatchObject({ score: 74, initial: true });
        expect(direction(snapshot(first), b.id, a.id)?.axes.FL?.score).toBe(63);
    });

    it('更新任意人物对，忽略错误绝对值、无证据增量、自指和未知 ID', () => {
        const first = generate([
            pair(a.id, b.id, { FL: { score: 98, ...fact }, RI: { score: 20, ...fact } }),
            pair(b.id, a.id, { FL: { score: 10, ...fact }, RI: { score: 2, ...fact } }),
        ]);
        const next = generate([
            pair(a.id, b.id, { FL: { score: 12, delta: 9, ...fact }, RI: { delta: -10 } }),
            pair(b.id, a.id, { FL: { delta: -20, ...fact }, RI: { delta: 7, ...fact } }),
            pair(b.id, c.id, { FL: { score: 99, ...fact } }), pair(c.id, b.id, { FL: { score: 34, ...fact } }),
            pair(a.id, a.id, { FL: { score: 100, ...fact } }), pair('unknown', a.id, { FL: { score: 100, ...fact } }),
        ], [message(first)]);
        const panel = snapshot(next)!;
        expect(panel.relationships).toHaveLength(4);
        expect(direction(panel)?.axes).toMatchObject({ FL: { score: 100, delta: 2 } });
        expect(direction(panel)?.axes.RI).toBeUndefined();
        expect(direction(baseline([message(first), message(next, 2)]))?.axes.RI?.score).toBe(20);
        expect(direction(panel, b.id, a.id)?.axes).toMatchObject({ FL: { score: 0, delta: -10 }, RI: { score: 9, delta: 7 } });
        expect(direction(panel, b.id, c.id)?.axes.FL?.score).toBe(99);
        expect(direction(panel, c.id, b.id)?.axes.FL?.score).toBe(34);
        expect(next.match(/<affinity_panel\b/g)).toHaveLength(1);
    });

    it('同名不同 ID 和两个方向不合并，旧 primaryId 不限制新人物对', () => {
        const old = proposal([pair(a.id, b.id, { FL: { score: 37 } })], { primaryId: a.id });
        const updated = reconcileStoryRelationships(proposal([pair(c.id, b.id, { RI: { score: 81, ...fact } })], { primaryId: 'obsolete' }), baseline([message(old)]));
        const state = baseline([message(old), message(updated, 2)]);
        expect(direction(state)?.axes.FL?.score).toBe(37);
        expect(direction(state, c.id, b.id)?.axes.RI?.score).toBe(81);
        expect(direction(state, b.id, c.id)?.axes).toEqual({});
    });

    it('自我记录按人物 ID 保存，单人剧场可以更新', () => {
        const solo = getStoryRelationshipBaseline([], [b]);
        const first = reconcileStoryRelationships(proposal([], { primaryId: b.id, state_note: '愿意先把话说清楚' }), solo);
        expect(snapshot(first)?.state_notes).toEqual({ b: { name: b.name, note: '愿意先把话说清楚' } });
        expect(baseline([message(first)]).state_notes?.a).toBeUndefined();
        const next = reconcileStoryRelationships('<story_text>稍等。</story_text>', baseline([message(first)]));
        expect(snapshot(next)).toBeUndefined();
        expect(baseline([message(first), message(next, 2)]).state_notes?.b.note).toBe('愿意先把话说清楚');
    });

    it('旧五维原文可回看，只承接明确 ID 的自我记录，不换算三轴', () => {
        const draft = normalizeStoryTheater({ ...createStoryTheaterDraft(), characterIds: [a.id, b.id], primaryCharacterId: a.id });
        expect(draft.primaryCharacterId).toBe(a.id);
        const old = '<story_text>旧事。</story_text><affinity_panel><affinity_person><character_id>a</character_id>'
            + '<c_to_u_score>83</c_to_u_score><trust>91</trust><state_note>愿意听完</state_note></affinity_person></affinity_panel>';
        expect(parseStoryDisplayBlocks(old).map(block => block.kind)).toEqual(['story', 'affinity']);
        expect(baseline([message(old)]).state_notes).toEqual({ a: { name: a.name, note: '愿意听完' } });
        expect(baseline([message(old)]).relationships.every(row => Object.keys(row.axes).length === 0)).toBe(true);
        expect(buildStoryRelationshipGuide()).toBe('');
        expect(reconcileStoryRelationships(old)).toBe('<story_text>旧事。</story_text>');
        expect(baseline([message('<affinity_panel><active_char>狛治</active_char><state_note>无法辨别同名人物</state_note></affinity_panel>')]).state_notes).toEqual({});
    });

    it.each([['mild', 75, 70], ['moderate', 56, 39], ['strong', 64, 51]] as const)(
        'DI %s 保留结束/回落逻辑；未记录的人物对保持历史', (strength, ended, idle) => {
            const first = generate([pair(a.id, b.id, { FL: { score: 57, ...fact }, RI: { score: 23, ...fact }, DI: { score: 80, ...fact, strength, phase: 'active' } })]);
            const second = generate([pair(a.id, b.id, { DI: { delta: 0, ...fact, strength, phase: 'ended' } })], [message(first)]);
            expect(direction(snapshot(second))?.axes.DI).toMatchObject({ score: ended, delta: ended - 80, ...fact });
            const history = [message(first), message(second, 2)];
            const state = baseline(history);
            const payload = buildStoryRelationshipPayload(undefined, actors, state, () => {}, { cast: new Set([a.id, b.id]), interactions: [] });
            const third = reconcileStoryRelationships('<story_text>他们照常等车。</story_text>', state, { payload });
            expect(direction(snapshot(third))?.axes).toMatchObject({ DI: { score: idle } });
            expect(direction(baseline([...history, message(third, 3, { theaterStoryRelationshipEvent: payload })]))?.axes)
                .toMatchObject({ FL: { score: 57 }, RI: { score: 23 }, DI: { score: idle } });
            expect(direction(baseline([message(first), message('无面板', 2)]))?.axes.DI?.score).toBe(80);
            const other = generate([pair(b.id, c.id, { FL: { score: 20, ...fact } })], [message(first)]);
            expect(direction(baseline([message(first), message(other, 2)]))?.axes.DI?.score).toBe(80);
            expect(direction(baseline([message(first), message(second, 2)]))?.axes.DI?.score).toBe(ended);
        },
    );

    it('旧 XML/JSON 三轴续接，双方实际出演时无需主要角色', () => {
        const old = '<affinity_panel mode="three_axes"><primary_id>a</primary_id><affinity_person><from_id>a</from_id><to_id>b</to_id><FL><score>20</score></FL></affinity_person></affinity_panel>';
        const original = baseline([message(old)]);
        const xml = '<story_text>递水。</story_text><affinity_panel mode="three_axes"><affinity_person><from_id>a</from_id><to_id>b</to_id><FL><delta>3</delta><trigger>递水</trigger><evidence>接过了</evidence></FL></affinity_person></affinity_panel>';
        expect(direction(snapshot(reconcileStoryRelationships(xml, original)))?.axes.FL?.score).toBe(23);
        expect(snapshot(reconcileStoryRelationships(xml, restrictStoryRelationshipsToCast(original, new Set(['b', 'c']))))).toBeUndefined();
        const otherPair = generate([pair(b.id, c.id, { FL: { score: 46, ...fact } })]);
        expect(direction(snapshot(reconcileStoryRelationships(otherPair, restrictStoryRelationshipsToCast(baseline(), new Set(['b', 'c'])))), b.id, c.id)?.axes.FL?.score).toBe(46);
    });

    it('重写早轮后按增量重放；删除初值不会被后轮快照复活；顺序按消息 ID', () => {
        const first = generate([pair(a.id, b.id, { FL: { score: 98, ...fact } })]);
        const next = generate([pair(a.id, b.id, { FL: { delta: 9, ...fact } })], [message(first)]);
        const rewritten = generate([pair(a.id, b.id, { FL: { score: 40, ...fact } })]);
        expect(direction(baseline([message(next, 2), message(rewritten)]))?.axes.FL?.score).toBe(49);
        expect(direction(baseline([message(next, 2)]))?.axes.FL).toBeUndefined();
        expect(direction(baseline([message(first)]))?.axes.FL?.score).toBe(98);
        expect(direction(baseline([message(first, 1, { theaterCastIds: ['b', 'c'] })]))?.axes.FL).toBeUndefined();
    });

    it('损坏、重复面板和重复方向不产生更新，正文保留', () => {
        const row = pair(a.id, b.id, { FL: { score: 100, ...fact } });
        for (const content of [proposal([row, row]), proposal([row]) + proposal([row]), '<story_text>新正文</story_text><relationship_panel>{bad']) {
            expect(snapshot(reconcileStoryRelationships(content, baseline()))).toBeUndefined();
            expect(stripStoryRelationshipPanels(content)).toContain('story_text');
        }
        expect(snapshot(generate([pair(a.id, b.id, { FL: { score: 90 } })]))).toBeUndefined();
        expect(snapshot(generate([pair(a.id, b.id, { FL: { delta: 9, ...fact } })]))).toBeUndefined();
    });

    it.each([
        ['中心式', LEGACY_CENTERED_STORY_RELATIONSHIP_PROMPT],
        ['人物对', LEGACY_PAIR_STORY_RELATIONSHIP_PROMPT],
        ['真实关系网', LEGACY_REAL_STORY_RELATIONSHIP_PROMPT],
    ])('内置与导入预设都只升级未改写的%s默认三轴正文', (_version, content) => {
        const document = BUILTIN_NIGHT_SCREENING_PRESET.document;
        const relation = { ...document.prompts.find(p => p.id === STORY_RELATIONSHIP_PROMPT_ID)!,
            name: '我的关系规则', enabled: false, content };
        const worldbook = { id: 'author-worldbook', name: '自定义世界书', role: 'system' as const, enabled: true,
            content: '角色所在的世界书规则。' };
        const others = document.prompts.filter(p => p.id !== STORY_RELATIONSHIP_PROMPT_ID);
        // Keep a deliberate order that differs from the built-in preset.
        const legacy = { ...document, prompts: [worldbook, relation, ...others] };
        const upgraded = { ...legacy, prompts: [worldbook, { ...relation, content: STORY_RELATIONSHIP_PROMPT }, ...others] };
        const custom = { ...legacy, prompts: [worldbook, { ...relation, content: content + '\n我自己改过' }, ...others] };
        for (const builtIn of [true, false]) {
            const preset = { ...BUILTIN_NIGHT_SCREENING_PRESET, builtIn };
            expect(resolveStoryPresetDocument(preset, legacy)).toEqual(upgraded);
            expect(resolveStoryPresetDocument(preset, custom)).toEqual(custom);
        }
    });
});
