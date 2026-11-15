import { describe, expect, it } from 'vitest';
import { assertStoryRerollBody, buildStoryTheaterPromptValues, canDrawStoryCast, canDrawStoryInteractionPlan, collectUnrealizedStoryTendencies, drawStoryCastGroups, drawStoryInteractionPlan, normalizeStoryCastLimits, parseOutOfStoryReply, parseStoryCastReply, parseStoryTheaterReply, storyActualInteractionGroupsFromMessage, storyCastIdsFromMessage, storyInteractionHistoryFromMessage } from './storyTheaterCast';

const axis = '修表的零件还没找齐，明天继续找工具。';
const axes = (ids: string[]) => `<private_axes>${JSON.stringify(Object.fromEntries(ids.map(id => [id, axis])))}</private_axes>`;

function seededRandom(seed: number) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('剧场选角协议', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const limits = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 2, minPeople: 1, maxPeople: 2 });

    it('单独识别场外正文并拒绝空回复、混合模式和跨模式重写', () => {
        const discussion = '<out_of_story>  我们可以讨论一下设定。\n你想从哪里开始？ </out_of_story>';
        const story = '<turn_cast>[["c"]]</turn_cast>她在修表。';
        expect(parseOutOfStoryReply(discussion)).toBe('我们可以讨论一下设定。\n你想从哪里开始？');
        expect(parseOutOfStoryReply(story)).toBeUndefined();
        for (const invalid of ['<out_of_story> </out_of_story>', story + discussion, `<out_of_story>${story}</out_of_story>`, '<out_of_story>未闭合']) {
            expect(() => parseOutOfStoryReply(invalid)).toThrow('场外回复格式无效');
        }
        expect(parseStoryCastReply(story + discussion, ids, limits)).toEqual({ groups: [['c']], axes: {}, body: '她在修表。' + discussion });
        expect(() => assertStoryRerollBody(discussion)).toThrow('本轮只需返回正文');
    });

    it('随机建议可变化，降低近期熟面孔和固定搭档的权重', () => {
        const pairLimits = normalizeStoryCastLimits({ maxGroups: 1, minPeople: 2, maxPeople: 2 });
        const recent = Array.from({ length: 6 }, () => [['a', 'b']]);
        const sample = (history: string[][][]) => Array.from({ length: 120 }, (_, i) =>
            drawStoryCastGroups(ids, pairLimits, history, seededRandom(7121 * (i + 1)))[0].sort().join(''));
        const unweighted = sample([]);
        const weighted = sample(recent);
        expect(new Set(weighted).size).toBeGreaterThan(2);
        expect(weighted.filter(group => group === 'ab').length).toBeLessThan(unweighted.filter(group => group === 'ab').length);
        expect(weighted.filter(group => group.includes('a')).length).toBeLessThan(unweighted.filter(group => group.includes('a')).length);
    });

    it('完整保留正文协议并剥离名单，人数和组数允许不取上限', () => {
        expect(parseStoryCastReply(`<turn_cast>[["c"]]</turn_cast>\n${axes(['c'])}<story_text>她在修表。</story_text>`, ids, limits))
            .toEqual({ groups: [['c']], axes: { c: axis }, body: '<story_text>她在修表。</story_text>' });
        expect(canDrawStoryCast(2, normalizeStoryCastLimits({ minGroups: 2, minPeople: 2, maxPeople: 2 }))).toBe(true); // 两名单人思考组也可以独立成立
    });

    it('允许超过五位演员和四个分组，整轮上限以候选池为准', () => {
        const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const range = normalizeStoryCastLimits({ minGroups: 5, maxGroups: 8, minPeople: 6, maxPeople: 12 });
        const actors = pool.map(id => ({ id, name: id }));
        for (let seed = 1; seed <= 12; seed++) {
            const groups = drawStoryCastGroups(pool, range, [], seededRandom(seed));
            expect(groups.length).toBeGreaterThanOrEqual(5);
            const cast = [...new Set(groups.flat())];
            expect(cast.length).toBeGreaterThanOrEqual(6);
            expect(cast.length).toBeLessThanOrEqual(7);
            expect(parseStoryCastReply(`<turn_cast>${JSON.stringify(groups)}</turn_cast>${axes(cast)}正文`, pool, range).groups).toEqual(groups);
            const promptValues = buildStoryTheaterPromptValues({ actors, candidateActors: actors, limits: range, proposals: groups, modeState: '剧情续写' });
            expect(promptValues.theater_cast_data).toContain('"id":"a"');
            expect(promptValues.theater_candidate_data).toContain('"id":"a"');
            expect(promptValues.theater_interaction_tendencies).toContain('"id":"a"');
        }
        const singleGroup = [pool];
        expect(parseStoryCastReply(`<turn_cast>${JSON.stringify(singleGroup)}</turn_cast>${axes(pool)}正文`, pool, normalizeStoryCastLimits(undefined, pool.length)).groups).toEqual(singleGroup);
    });

    it('接受跨组重复、可恢复的代码围栏和重写名单', () => {
        const groups = [['a', 'b'], ['b'], ['a']];
        const range = normalizeStoryCastLimits({ minGroups: 3, maxGroups: 3, minPeople: 2, maxPeople: 2 });
        const fence = '```';
        const protocol = `<turn_cast>\n${fence}json\n${JSON.stringify(groups)}\n${fence}\n</turn_cast>\n${axes(['a', 'b'])}`;
        for (const output of [
            `\uFEFF${protocol}正文`,
            `\uFEFF${fence}xml\n${protocol}\n正文\n${fence}`,
            `${fence}xml\n${protocol}\n${fence}\n正文`,
        ]) expect(parseStoryCastReply(output, ids, range)).toEqual({ groups, axes: { a: axis, b: axis }, body: '正文' });
        const soloAndPair = drawStoryCastGroups(['a', 'b'], range, [], seededRandom(3));
        expect(soloAndPair).toHaveLength(3);
        expect(soloAndPair.filter(group => group.length === 1)).toHaveLength(2);
        expect(parseStoryCastReply(axes(['a', 'b']) + '正文', ids, range, groups).groups).toEqual(groups);
        expect(parseStoryCastReply(axes(['a']) + '正文', ids, range, groups).axes).toEqual({ a: axis });
        expect(parseStoryCastReply(axes(['a', 'c']) + '正文', ids, range, groups).axes).toEqual({ a: axis });
        expect(parseStoryCastReply('<turn_cast>[["a","b"]]</turn_cast>' + axes(['a', 'b']) + '正文', ids, range, groups).groups).toEqual(groups);
    });

    it.each([
        { minPeople: 5, maxPeople: 8 },
        { minGroups: 4, maxPeople: 2 },
        { minGroups: 3, maxGroups: 2 },
        { minPeople: 3, maxPeople: 2 },
        { minPeople: 0 },
        { maxGroups: 2.5 },
        { maxPeople: NaN },
        { maxPeople: Infinity },
    ])('无法用当前候选满足范围时拒绝生成或校验：%j', partial => {
        const range = normalizeStoryCastLimits(partial);
        expect(canDrawStoryCast(ids.length, range)).toBe(false);
        expect(drawStoryCastGroups(ids, range, [])).toEqual([]);
        expect(parseStoryCastReply('<turn_cast>[["a"]]</turn_cast>正文', ids, range).groups).toEqual([['a']]);
    });

    it.each([
        '<story_text>缺少名单</story_text>',
        '<turn_cast>[["外人"]]</turn_cast>正文',
        '<turn_cast>[["a","a"]]</turn_cast>正文',
        '<turn_cast>[["a","b"],["b","a"]]</turn_cast>正文',
        '<turn_cast>[["a"],["b","c"]]</turn_cast>正文',
        '<turn_cast>[["a"],[]]</turn_cast>正文',
        '<turn_cast>[["a"],["b"],["c"]]</turn_cast>正文',
        '<turn_cast>[["a","b","c"]]</turn_cast>正文',
        '<turn_cast>[["a"]]</turn_cast>正文<turn_cast>[["b"]]</turn_cast>',
    ])('格式异常时仍保留正文：%s', text => {
        expect(parseStoryCastReply(text, ids, limits).body).toBeTruthy();
    });

    it('动态数据只提供候选、建议、范围和历史私轴，不再在代码中生成提示词', () => {
        const links = [['a', 'b'], ['a', 'c'], ['a', 'd']];
        const actors = ids.map(id => ({ id, name: id.toUpperCase() }));
        const range = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 9, minPeople: 1, maxPeople: 4 }, 4);
        const values = buildStoryTheaterPromptValues({
            actors, limits: range, proposals: links, modeState: '剧情续写',
            previousAxes: { a: '仍在找丢失的铅笔盒。' }, prefill: '<scene_header>',
        });
        expect(parseStoryCastReply(`<turn_cast>${JSON.stringify(links)}</turn_cast><story_text>正文</story_text>`, ids, range).groups).toEqual(links);
        expect(values.theater_mode_state).toBe('剧情续写');
        expect(values.theater_cast_data).toContain('"id":"a"');
        expect(values.theater_candidate_data).toContain('"id":"a"');
        expect(values.theater_interaction_tendencies).toContain('"id":"a"');
        expect(values.theater_previous_axes).toContain('仍在找丢失的铅笔盒');
        expect(values.theater_prefill).toContain('<scene_header>');
        expect(normalizeStoryCastLimits(undefined, 8).maxGroups).toBeGreaterThan(4);
    });

    it('随机建议包含同场多人共同讨论，也支持分组衔接与并行交谈', () => {
        const people = ['a', 'b', 'c', 'd'];
        const oneGroup = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 1, minPeople: 4, maxPeople: 4 }, 4);
        expect(drawStoryCastGroups(people, oneGroup, [], seededRandom(23)).map(group => [...group].sort())).toEqual([people]);
        const flexible = normalizeStoryCastLimits({ minGroups: 2, maxGroups: 3, minPeople: 4, maxPeople: 4 }, 4);
        const samples = Array.from({ length: 30 }, (_, i) => drawStoryCastGroups(people, flexible, [], seededRandom(i * 821 + 71)));
        expect(samples.some(groups => groups.some(group => group.length >= 3))).toBe(true);
        expect(samples.some(groups => groups.some(group => group.length === 2))).toBe(true);
        expect(samples.some(groups => groups.length === 2 && groups[0].some(id => groups[1].includes(id)))).toBe(true);
        expect(samples.some(groups => groups.some(group => group.length === 1))).toBe(true);
        const values = buildStoryTheaterPromptValues({ actors: people.map(id => ({ id, name: id })), limits: flexible, proposals: [['a', 'b'], ['b', 'c']], modeState: '按最新输入判断' });
        expect(values.theater_interaction_tendencies).toContain('"id":"a"');
    });

    it('随机建议只生成有交流对象的关系，组数不固定，关系可重叠', () => {
        const pool = ['a', 'b', 'c', 'd', 'e'];
        const range = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 10, minPeople: 2, maxPeople: 5 }, pool.length);
        const samples = Array.from({ length: 80 }, (_, i) => drawStoryCastGroups(pool, range, [], seededRandom(1009 + i * 71)));
        expect(new Set(samples.map(groups => groups.length)).size).toBeGreaterThanOrEqual(4);
        expect(samples.some(groups => groups.length >= 5)).toBe(true);
        expect(samples.some(groups => groups.flat().length > new Set(groups.flat()).size)).toBe(true);
        for (const groups of samples) {
            expect(groups.length).toBeGreaterThanOrEqual(1);
            expect(groups.length).toBeLessThanOrEqual(10);
            expect(new Set(groups.map(group => JSON.stringify([...group].sort()))).size).toBe(groups.length);
            expect(groups.every(group => group.length >= 1)).toBe(true);
            expect(new Set(groups.flat()).size).toBeGreaterThanOrEqual(2);
        }
        expect(canDrawStoryCast(1, normalizeStoryCastLimits(undefined, 1))).toBe(true);
        expect(drawStoryCastGroups(['a'], normalizeStoryCastLimits(undefined, 1), [])).toEqual([['a']]);
    });

    it('剧情末尾的私轴被提取，正文和时间原样保留', () => {
        const text = '<turn_cast>[["a"]]</turn_cast><scene_header><time>2026-04-10 14:00</time></scene_header><story_text>修好了钟。</story_text>' + axes(['a']);
        expect(parseStoryCastReply(text, ids, limits)).toEqual({
            groups: [['a']], axes: { a: axis },
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>修好了钟。</story_text>',
        });
    });

    it('末尾私轴未写完时，只清除残缺的私轴，保留已生成的正文', () => {
        const text = '<turn_cast>[["a"]]</turn_cast><scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情。</story_text><private_axes>{"a":"明天';
        expect(parseStoryCastReply(text, ids, limits)).toEqual({
            groups: [['a']], axes: {},
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情。</story_text>',
        });
        expect(parseStoryCastReply('<turn_cast>[["a"]]</turn_cast><private_axes>{"a":"未完', ids, limits).body).toBe('');
    });

    it('旧三字段私轴仍可读取，并转换成一段文字', () => {
        const oldAxis = { doing: '修表', thinking: '还差一个零件', next: '找工具' };
        const text = '<turn_cast>[["a"]]</turn_cast><story_text>修表。</story_text><private_axes>' + JSON.stringify({ a: oldAxis }) + '</private_axes>';
        expect(parseStoryCastReply(text, ids, limits).axes).toEqual({ a: '修表；还差一个零件；找工具' });
    });

    it('兼容 scene_header 中嵌套的出演名单，保留剧情时间和正文', () => {
        const text = '<scene_header><turn_cast>[["a","b"],["c"]]</turn_cast><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情正文。</story_text>';
        expect(parseStoryCastReply(text, ids, limits)).toEqual({
            groups: [['a', 'b'], ['c']], axes: {},
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情正文。</story_text>',
        });
    });

    it('读取 scene_header 中的旧式演员数组', () => {
        const text = '<scene_header>[["a","b"]]<time>2026-04-10</time></scene_header><story_text>正文</story_text>';
        expect(parseStoryCastReply(text, ids, limits).groups).toEqual([['a','b']]);
    });
});

describe('交流倾向随机调度', () => {
    const people = ['a', 'b', 'c', 'd'];
    const fixedRoster = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 1, minPeople: 4, maxPeople: 4 }, 4);
    const seed = (index: number) => seededRandom(9127 + index * 193);

    it('在剧情生成前确定出演名单，并允许重叠与多人交流倾向', () => {
        const plans = Array.from({ length: 24 }, (_, index) => drawStoryInteractionPlan(
            people, normalizeStoryCastLimits({ minGroups: 3, maxGroups: 3, minPeople: 4, maxPeople: 4 }, 4), [], seededRandom(7 + index * 31),
        ));
        expect(plans.every(plan => plan.castIds.length === 4 && plan.tendencies.length === 3)).toBe(true);
        expect(plans.every(plan => plan.tendencies.every(group => group.length >= 2))).toBe(true);
        expect(plans.some(plan => plan.tendencies.some(group => group.length > 2))).toBe(true);
        expect(canDrawStoryInteractionPlan(1, normalizeStoryCastLimits(undefined, 1))).toBe(true);
        expect(canDrawStoryInteractionPlan(2, normalizeStoryCastLimits({ minGroups: 2, maxGroups: 4, minPeople: 1, maxPeople: 2 }, 2))).toBe(false);
        expect(drawStoryInteractionPlan(['solo'], normalizeStoryCastLimits(undefined, 1), [], seededRandom(1)))
            .toEqual({ castIds: ['solo'], tendencies: [['solo']] });
    });

    it('近期真实互动降低旧搭档权重，未实现倾向会暂时获得探索加成', () => {
        const actualHistory = Array.from({ length: 8 }, () => ({
            castIds: people, tendencies: [['a', 'b']], actual: [['a', 'b']],
        }));
        const missedHistory = Array.from({ length: 4 }, () => ({
            castIds: people, tendencies: [['a', 'b']], actual: [],
        }));
        const sample = (history: typeof actualHistory) => Array.from({ length: 180 }, (_, index) =>
            drawStoryInteractionPlan(people, fixedRoster, history, seed(index)).tendencies[0].join(''));
        const baseline = sample([]);
        const actual = sample(actualHistory);
        const missed = sample(missedHistory);
        expect(actual.filter(group => group === 'ab').length).toBeLessThan(baseline.filter(group => group === 'ab').length);
        expect(missed.filter(group => group === 'ab').length).toBeGreaterThan(baseline.filter(group => group === 'ab').length);
        expect(collectUnrealizedStoryTendencies(missedHistory)).toEqual([['a', 'b']]);
        expect(collectUnrealizedStoryTendencies([...missedHistory, { castIds: people, tendencies: [['a', 'b']], actual: [['a', 'b']] }])).toEqual([]);
    });

    it('从剧情结果中提取实际互动，过滤旁观者、无效角色和单人组', () => {
        const roster = ['a', 'b', 'c'];
        const generated = '<turn_cast>' + JSON.stringify(roster) + '</turn_cast>'
            + '<story_text>正文。</story_text>'
            + '<interaction_result>[["a","b"],["b","c"],["c"],["a","outside"]]</interaction_result>'
            + axes(roster);
        expect(parseStoryTheaterReply(generated, roster)).toEqual({
            interactions: [['a', 'b'], ['b', 'c']], axes: { a: axis, b: axis, c: axis }, body: '<story_text>正文。</story_text>',
        });
        expect(parseStoryTheaterReply('<story_text>没有交流。</story_text>', roster).interactions).toEqual([]);
        const background = parseStoryTheaterReply(
            '<interaction_result>[["a","d"]]</interaction_result>' + axes(['a', 'b']),
            ['a', 'b', 'c', 'd'], ['a', 'b'],
        );
        expect(background.interactions).toEqual([['a', 'd']]);
        expect(Object.keys(background.axes)).toEqual(['a', 'b']);
        expect(() => assertStoryRerollBody('<interaction_result>[]</interaction_result>正文')).toThrow('本轮只需返回正文');
    });

    it('历史数据分别读取出演名单、交流倾向和真实互动', () => {
        const message = {
            role: 'assistant',
            metadata: {
                theaterCastIds: ['a', 'b', 'c'],
                theaterCandidateIds: ['a', 'b', 'c', 'd'],
                theaterInteractionTendencies: [['a', 'b'], ['a', 'c']],
                theaterInteractionGroups: [['a', 'd']],
            },
        } as any;
        expect(storyCastIdsFromMessage(message)).toEqual(['a', 'b', 'c']);
        expect(storyActualInteractionGroupsFromMessage(message)).toEqual([['a', 'd']]);
        expect(storyInteractionHistoryFromMessage(message)).toEqual({
            castIds: ['a', 'b', 'c'],
            tendencies: [['a', 'b'], ['a', 'c']],
            actual: [['a', 'd']],
            legacyTendencies: [],
        });
        const legacy = {
            role: 'assistant',
            metadata: { theaterCastGroups: [['a', 'b'], ['b', 'c']] },
        } as any;
        expect(storyInteractionHistoryFromMessage(legacy)).toEqual({
            castIds: ['a', 'b', 'c'],
            tendencies: [],
            actual: [],
            legacyTendencies: [['a', 'b'], ['b', 'c']],
        });
    });
});
