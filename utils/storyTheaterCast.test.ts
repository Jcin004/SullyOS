import { describe, expect, it } from 'vitest';
import { assertStoryRerollBody, buildStoryCastInstruction, canDrawStoryCast, drawStoryCastGroups, normalizeStoryCastLimits, parseOutOfStoryReply, parseStoryCastReply } from './storyTheaterCast';

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
        expect(canDrawStoryCast(2, normalizeStoryCastLimits({ minGroups: 2, minPeople: 2, maxPeople: 2 }))).toBe(true);
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
            expect(buildStoryCastInstruction(actors, range, groups)).toContain('整轮去重后共 6～7 位演员');
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
        expect(drawStoryCastGroups(['a', 'b'], range, [], seededRandom(3))).toHaveLength(3);
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

    it('先输出出演名单、完整剧情，再结算短私轴', () => {
        const instruction = buildStoryCastInstruction([{ id: 'a', name: '角色A' }], limits, [['a']], '<scene_header>');
        const cast = instruction.indexOf('先独立输出 <turn_cast>');
        const story = instruction.indexOf('然后从原预设起始文本开始完整输出剧情正文');
        const axes = instruction.indexOf('最后输出 <private_axes>');
        expect(cast).toBeGreaterThanOrEqual(0);
        expect(story).toBeGreaterThan(cast);
        expect(axes).toBeGreaterThan(story);
        expect(instruction).toContain('每个值为一段简短文字');
        expect(instruction).toContain('出演名单关闭后，正文沿用预设起始文本');
        expect(instruction).toContain('<scene_header>');
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
