import { describe, expect, it } from 'vitest';
import { assertStoryRerollBody, buildStoryTheaterPromptValues, canDrawStoryCast, canDrawStoryInteractionPlan, drawStoryCastGroups, drawStoryInteractionPlan, normalizeStoryCastLimits, parseOutOfStoryReply, parseStoryCastReply, parseStoryTheaterReply, storyActualInteractionGroupsFromMessage, storyCastIdsFromMessage, storyInteractionHistoryFromMessage, storyReportStatusFromMessage } from './storyTheaterCast';

const axis = '修表的零件还没找齐，明天继续找工具。';
const axes = (ids: string[]) => `<private_axes>${JSON.stringify(Object.fromEntries(ids.map(id => [id, axis])))}</private_axes>`;

function seededRandom(seed: number) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('姓名报告与历史兼容', () => {
    const candidates = [{ id: 'a', name: '林青' }, { id: 'b', name: '陈远' }, { id: 'c', name: '沈默' }];
    const body = '<story_text>林青向陈远道谢，沈默独自在楼上修表。</story_text>';
    const cast = '<turn_cast>["林青","陈远","沈默"]</turn_cast>';
    const parse = (reports: string, pool = candidates) => parseStoryTheaterReply(body + reports + axes(['a', 'b', 'c']), pool);

    it.each([
        ['["林青","陈远","沈默"]', '[["林青","陈远"]]'],
        ['["a","b","c"]', '[["a","b"]]'],
        ['[["a","b"],["b","c"]]', '[["a","陈远"]]'],
        ['["林青","b","沈默"]', '[["林青","b"],["b","林青"]]'],
    ])('姓名、历史 ID、二维旧名单和混合格式均保存为 ID：%s', (roster, groups) => {
        expect(parse(`<turn_cast>${roster}</turn_cast><interaction_result>${groups}</interaction_result>`)).toEqual({
            body, castIds: ['a', 'b', 'c'], castStatus: 'reported', interactions: [['a', 'b']], interactionStatus: 'reported',
            axes: { a: axis, b: axis, c: axis },
        });
    });

    it.each([
        '["林"]', '["小林"]', '["林青 "]', '["未知角色"]', '["林青","未知角色"]',
        '["林青",null]', '["林青",["陈远"]]', '{}', '[[]]',
    ])('任何成员无法精确确认时整份名单无效，不从私轴或互动推断：%s', roster => {
        expect(parse(`<turn_cast>${roster}</turn_cast><interaction_result>[["林青","陈远"]]</interaction_result>`))
            .toEqual({ body, castIds: [], castStatus: 'invalid', interactions: [], interactionStatus: 'invalid', axes: {} });
    });

    it('重名不猜测，明确 ID 可辨认；姓名与其他角色 ID 冲突也不猜测', () => {
        const sameName = [...candidates, { id: 'd', name: '林青' }];
        expect(parse('<turn_cast>["林青","陈远"]</turn_cast>', sameName)).toMatchObject({ castIds: [], castStatus: 'invalid' });
        expect(parse('<turn_cast>["a","b"]</turn_cast>', sameName)).toMatchObject({ castIds: ['a', 'b'], castStatus: 'reported' });
        expect(parse('<turn_cast>["a"]</turn_cast>', [...candidates, { id: 'other', name: 'a' }]))
            .toMatchObject({ castIds: [], castStatus: 'invalid' });
        expect(parse('<turn_cast>["a","b"]</turn_cast><interaction_result>[["林青","陈远"]]</interaction_result>', sameName))
            .toMatchObject({ castIds: ['a', 'b'], interactions: [], interactionStatus: 'invalid' });
    });

    it.each(['[["林青","外人"]]', '[["林青","林青"]]', '[["林青","a"]]', '[["林青"]]', '[[]]', '["林青","陈远"]', '{}', 'null', '不是 JSON'])
    ('互动报告不接收无效分组或未确认成员：%s', report => {
        expect(parse(cast + `<interaction_result>${report}</interaction_result>`))
            .toMatchObject({ body, castIds: ['a', 'b', 'c'], castStatus: 'reported', interactions: [], interactionStatus: 'invalid', axes: { a: axis } });
    });

    it('未报告、格式错误和明确 [] 分开，不因省略互动丢失正文或出演', () => {
        expect(parse('')).toEqual({ body, castIds: [], castStatus: 'unreported', interactions: [], interactionStatus: 'unreported', axes: {} });
        expect(parse('<turn_cast>[]</turn_cast><interaction_result>[]</interaction_result>'))
            .toEqual({ body, castIds: [], castStatus: 'empty', interactions: [], interactionStatus: 'empty', axes: {} });
        expect(parse(cast)).toMatchObject({ castStatus: 'reported', interactionStatus: 'unreported', axes: { a: axis } });
        expect(parse(cast + '<interaction_result>[]</interaction_result>')).toMatchObject({ castStatus: 'reported', interactionStatus: 'empty' });
    });

    it.each(['<turn_cast>["林青"]', '<turn_cast', '</turn_cast>', '<turn_cast>["林青"]</turn_cast><turn_cast>[]</turn_cast>',
        '<turn_cast>["林青"]</turn_cast><turn_cast', '<turn_cast>["林青"]</turn_cast></turn_cast>'])
    ('截断、重复或孤立标签均为错误：%s', report => {
        expect(parse(report)).toMatchObject({ body, castIds: [], castStatus: 'invalid', axes: {} });
    });

    it.each(['<interaction_result>', '<interaction_result', '</interaction_result>',
        '<interaction_result>[]</interaction_result><interaction_result',
        '<interaction_result>[]</interaction_result><interaction_result>[]</interaction_result>'])
    ('互动标签损坏时保留出演、正文与私轴：%s', report => {
        expect(parse(cast + report)).toMatchObject({ castIds: ['a', 'b', 'c'], castStatus: 'reported', interactionStatus: 'invalid', axes: { a: axis } });
    });

    it('围栏与旧 scene_header 名单可读；旧数据的空数组不冒充明确的无交流报告', () => {
        const fenced = '```json\n["林青","陈远"]\n```';
        expect(parse(`<turn_cast>${fenced}</turn_cast>`)).toMatchObject({ castIds: ['a', 'b'], castStatus: 'reported' });
        expect(parseStoryTheaterReply('<scene_header>[["a","unknown"]]<time>午后</time></scene_header>' + body, candidates))
            .toMatchObject({ castIds: [], castStatus: 'invalid' });
        const old = { metadata: { theaterCastIds: [], theaterInteractionGroups: [] } } as any;
        expect(storyReportStatusFromMessage(old, 'cast')).toBe('legacy');
        expect(storyReportStatusFromMessage(old, 'interaction')).toBe('legacy');
        expect(old.metadata).toEqual({ theaterCastIds: [], theaterInteractionGroups: [] });
        expect(storyReportStatusFromMessage({ metadata: { theaterCastGroups: [['a']] } } as any, 'cast')).toBe('legacy');
    });
});

describe('剧场选角协议', () => {
    const ids = ['a', 'b', 'c', 'd'];
    const limits = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 2 });

    it('旧人数字段不参与范围、校验或随机结果，归一化只返回组数', () => {
        const obsolete = { minGroups: 1, maxGroups: 3, minPeople: 99, maxPeople: 0 };
        const current = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 3 }, 4);
        expect(normalizeStoryCastLimits(obsolete, 4)).toEqual(current);
        expect(canDrawStoryInteractionPlan(4, normalizeStoryCastLimits(obsolete, 4))).toBe(true);
        expect(drawStoryInteractionPlan(ids, normalizeStoryCastLimits(obsolete, 4), [], seededRandom(7)))
            .toEqual(drawStoryInteractionPlan(ids, current, [], seededRandom(7)));
    });

    it.each(['', '<interaction_result>[]</interaction_result>', '<interaction_result>无效</interaction_result>'])(
        '省略、为空或损坏的事后记录仍保留独处正文、出演和私轴：%s', record => {
            const body = '<story_text>她独自坐在窗边修表。</story_text>';
            expect(parseStoryTheaterReply(body + '<turn_cast>["a"]</turn_cast>' + record + axes(['a']), ids))
                .toEqual({ body, castIds: ['a'], castStatus: 'reported', interactions: [],
                    interactionStatus: !record ? 'unreported' : record.includes('[]') ? 'empty' : 'invalid', axes: { a: axis } });
        },
    );

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
        const pairLimits = normalizeStoryCastLimits({ maxGroups: 1 });
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
        expect(canDrawStoryCast(2, normalizeStoryCastLimits({ minGroups: 2}))).toBe(true); // 两名单人思考组也可以独立成立
    });

    it('允许超过五位演员和四个分组，整轮上限以候选池为准', () => {
        const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const range = normalizeStoryCastLimits({ minGroups: 5, maxGroups: 8 });
        const actors = pool.map(id => ({ id, name: id }));
        for (let seed = 1; seed <= 12; seed++) {
            const groups = drawStoryCastGroups(pool, range, [], seededRandom(seed));
            expect(groups.length).toBeGreaterThanOrEqual(5);
            const cast = [...new Set(groups.flat())];
            expect(cast.length).toBeGreaterThanOrEqual(3);
            expect(cast.length).toBeLessThanOrEqual(7);
            expect(parseStoryCastReply(`<turn_cast>${JSON.stringify(groups)}</turn_cast>${axes(cast)}正文`, pool, range).groups).toEqual(groups);
            const promptValues = buildStoryTheaterPromptValues({ actors, candidateActors: actors, limits: range, proposals: groups, modeState: '剧情续写' });
            expect(promptValues.theater_cast_data).toContain('"id":"a"');
            expect(promptValues.theater_candidate_data).toContain('"id":"a"');
            for (const id of cast) expect(promptValues.theater_interaction_tendencies).toContain(`"id":"${id}"`);
        }
        const singleGroup = [pool];
        expect(parseStoryCastReply(`<turn_cast>${JSON.stringify(singleGroup)}</turn_cast>${axes(pool)}正文`, pool, normalizeStoryCastLimits(undefined, pool.length)).groups).toEqual(singleGroup);
    });

    it('接受跨组重复、可恢复的代码围栏和重写名单', () => {
        const groups = [['a', 'b'], ['b'], ['a']];
        const range = normalizeStoryCastLimits({ minGroups: 3, maxGroups: 3 });
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
        { minGroups: 16, maxGroups: 20 },
        { minGroups: 3, maxGroups: 2 },
        { minGroups: 0 },
        { maxGroups: 2.5 },
        { maxGroups: NaN },
        { maxGroups: Infinity },
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
        const range = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 9 }, 4);
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
        const oneGroup = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 1 }, 4);
        const singleGroups = Array.from({ length: 30 }, (_, i) => drawStoryCastGroups(people, oneGroup, [], seededRandom(i * 821 + 71)));
        expect(singleGroups.every(groups => groups.length === 1)).toBe(true);
        expect(singleGroups.some(groups => groups[0].length > 2)).toBe(true);
        const flexible = normalizeStoryCastLimits({ minGroups: 2, maxGroups: 3 }, 4);
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
        const range = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 10 }, pool.length);
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
    const fixedRoster = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 1 }, 4);
    const seed = (index: number) => seededRandom(9127 + index * 193);

    it('在剧情生成前抽取交流关注角色，允许重叠与多人交流倾向', () => {
        const plans = Array.from({ length: 24 }, (_, index) => drawStoryInteractionPlan(
            people, normalizeStoryCastLimits({ minGroups: 3, maxGroups: 3 }, 4), [], seededRandom(7 + index * 31),
        ));
        expect(plans.every(plan => plan.castIds.length >= 2 && plan.castIds.length <= 4 && plan.tendencies.length === 3)).toBe(true);
        expect(plans.every(plan => plan.tendencies.every(group => group.length >= 1))).toBe(true);
        expect(plans.some(plan => plan.tendencies.some(group => group.length === 1))).toBe(true);
        expect(plans.some(plan => plan.tendencies.some(group => group.length > 2))).toBe(true);
        expect(plans.some(plan => plan.tendencies.some((group, index) =>
            plan.tendencies.slice(index + 1).some(other => group.some(id => other.includes(id))),
        ))).toBe(true);
        const variablePlans = Array.from({ length: 32 }, (_, index) => drawStoryInteractionPlan(
            people, normalizeStoryCastLimits({ minGroups: 1, maxGroups: 6 }, 4), [], seededRandom(300 + index * 19),
        ));
        expect(new Set(variablePlans.map(plan => plan.tendencies.length)).size).toBeGreaterThan(1);
        expect(canDrawStoryInteractionPlan(1, normalizeStoryCastLimits(undefined, 1))).toBe(true);
        expect(canDrawStoryInteractionPlan(2, normalizeStoryCastLimits({ minGroups: 2, maxGroups: 4 }, 2))).toBe(true);
        expect(drawStoryInteractionPlan(['solo'], normalizeStoryCastLimits(undefined, 1), [], seededRandom(1)))
            .toEqual({ castIds: ['solo'], tendencies: [['solo']] });
        const twoPersonPlan = drawStoryInteractionPlan(
            ['a', 'b'], normalizeStoryCastLimits({ minGroups: 2, maxGroups: 3 }, 2), [], seededRandom(17),
        );
        expect(twoPersonPlan.castIds).toHaveLength(2);
        expect(twoPersonPlan.tendencies).toHaveLength(2);
        expect(twoPersonPlan.tendencies.every(group => group.length >= 1 && group.length <= 2)).toBe(true);
    });

    it('主要角色频繁出演时不被人物出场权重压低，重复搭档仍按实际交流降权', () => {
        const history = Array.from({ length: 8 }, () => ({ castIds: ['a', 'b'], tendencies: [['a', 'b']], actual: [['a', 'b']] }));
        const limits = normalizeStoryCastLimits({ minGroups: 1, maxGroups: 1 }, 4);
        const samples = (primary?: string) => Array.from({ length: 160 }, (_, index) =>
            drawStoryInteractionPlan(people, limits, history, seed(index), primary));
        const ordinary = samples();
        const anchored = samples('a');
        expect(anchored.filter(plan => plan.castIds.includes('a')).length)
            .toBeGreaterThan(ordinary.filter(plan => plan.castIds.includes('a')).length);
        expect(anchored.some(plan => !plan.castIds.includes('a'))).toBe(true);
    });

    it('近期真实互动降低旧搭档权重，未实现的倾向不改变抽取', () => {
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
        expect(missed).toEqual(baseline);
    });

    it('从剧情结果中提取实际互动；有无效成员或单人组时标记整份报告错误', () => {
        const roster = ['a', 'b', 'c'];
        const generated = '<story_text>正文。</story_text>' + '<turn_cast>' + JSON.stringify(roster) + '</turn_cast>'
            + '<interaction_result>[["a","b"],["b","c"]]</interaction_result>'
            + axes(roster);
        expect(parseStoryTheaterReply(generated, roster)).toEqual({
            castIds: roster, castStatus: 'reported', interactions: [['a', 'b'], ['b', 'c']], interactionStatus: 'reported',
            axes: { a: axis, b: axis, c: axis }, body: '<story_text>正文。</story_text>',
        });
        expect(parseStoryTheaterReply('<story_text>没有交流。</story_text>', roster).interactions).toEqual([]);
        expect(parseStoryTheaterReply('<story_text>正文。</story_text><interaction_result>[["a","b"]]', roster).body).toBe('<story_text>正文。</story_text>');
        const background = parseStoryTheaterReply(
            '她独自修表。<turn_cast>["a"]</turn_cast><interaction_result>[["a","d"]]</interaction_result>' + axes(['a', 'b']),
            ['a', 'b', 'c', 'd'],
        );
        const watching = '<story_text>甲向乙点头；丙路过，丁只被提及。</story_text><turn_cast>["a","b","c"]</turn_cast>';
        const valid = '<interaction_result>[["a","b"],["a","b","d"],["c"],["b","a"]]</interaction_result>';
        expect(parseStoryTheaterReply(watching + valid, ['a', 'b', 'c', 'd'])).toMatchObject({ interactions: [], interactionStatus: 'invalid' });
        expect(parseStoryTheaterReply(watching + valid + '<interaction_result>[]</interaction_result>', ['a', 'b', 'c', 'd']).interactions).toEqual([]);
        expect(background).toEqual({ castIds: ['a'], castStatus: 'reported', interactions: [], interactionStatus: 'invalid', axes: { a: axis }, body: '她独自修表。' });
        expect(() => assertStoryRerollBody('<interaction_result>[]</interaction_result>正文')).toThrow('本轮只需返回正文');
    });

    it('保留旧名单协议，并在名单缺失、无效或截断时保留正文', () => {
        const body = '<story_text>她一言未发。</story_text>';
        for (const cast of ['', '<turn_cast>[]</turn_cast>', '<turn_cast>["a","unknown"]</turn_cast>',
            '<turn_cast>写错了</turn_cast>', '<turn_cast>["a"]']) {
            expect(parseStoryTheaterReply(body + cast + axes(['a']), ['a']))
                .toEqual({ castIds: [], castStatus: !cast ? 'unreported' : cast.includes('[]') ? 'empty' : 'invalid',
                    interactions: [], interactionStatus: 'unreported', axes: {}, body });
        }
        expect(parseStoryTheaterReply('<turn_cast>[["a"]]</turn_cast>' + body + axes(['a']), ['a']))
            .toEqual({ castIds: ['a'], castStatus: 'reported', interactions: [], interactionStatus: 'unreported', axes: { a: axis }, body });
        expect(parseStoryTheaterReply('<turn_cast>[' + body + axes(['a']), ['a']))
            .toEqual({ castIds: [], castStatus: 'invalid', interactions: [], interactionStatus: 'unreported', axes: {}, body });
        expect(parseStoryTheaterReply('<scene_header>[["a"]]<time>午后</time></scene_header>' + body, ['a']))
            .toEqual({ castIds: ['a'], castStatus: 'reported', interactions: [], interactionStatus: 'unreported', axes: {}, body: '<scene_header><time>午后</time></scene_header>' + body });
    });

    it('历史数据分别读取出演名单、交流倾向和真实互动', () => {
        const message = {
            role: 'assistant',
            metadata: {
                theaterCastIds: ['a', 'b', 'c'],
                theaterCandidateIds: ['a', 'b', 'c', 'd'],
                theaterInteractionTendencies: [['a', 'b'], ['a', 'c'], ['c', 'd']],
                theaterInteractionGroups: [['a', 'd']],
            },
        } as any;
        expect(storyCastIdsFromMessage(message)).toEqual(['a', 'b', 'c']);
        expect(storyActualInteractionGroupsFromMessage(message)).toEqual([]);
        expect(message.metadata.theaterInteractionGroups).toEqual([['a', 'd']]);
        expect(storyInteractionHistoryFromMessage(message)).toEqual({
            castIds: ['a', 'b', 'c'],
            tendencies: [['a', 'b'], ['a', 'c'], ['c', 'd']],
            actual: [],
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
