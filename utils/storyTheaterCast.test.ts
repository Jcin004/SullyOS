import { describe, expect, it } from 'vitest';
import { assertStoryRerollBody, buildStoryCastInstruction, drawStoryCastGroups, normalizeStoryCastLimits, parseOutOfStoryReply, parseStoryCastReply } from './storyTheaterCast';

const axis = '修表的零件还没找齐，明天继续找工具。';
const axes = (ids: string[]) => `<private_axes>${JSON.stringify(Object.fromEntries(ids.map(id => [id, axis])))}</private_axes>`;

function seededRandom(seed: number) {
    return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

describe('剧场选角协议', () => {
    const ids = ['a', 'b', 'c', 'd'];

    it('单独识别场外正文并拒绝空回复、混合模式和跨模式重写', () => {
        const discussion = '<out_of_story>  我们可以讨论一下设定。\n你想从哪里开始？ </out_of_story>';
        const story = '<turn_cast>[["c"]]</turn_cast>她在修表。';
        expect(parseOutOfStoryReply(discussion)).toBe('我们可以讨论一下设定。\n你想从哪里开始？');
        expect(parseOutOfStoryReply(story)).toBeUndefined();
        for (const invalid of ['<out_of_story> </out_of_story>', story + discussion, `<out_of_story>${story}</out_of_story>`, '<out_of_story>未闭合']) {
            expect(() => parseOutOfStoryReply(invalid)).toThrow('场外回复格式无效');
        }
        expect(parseStoryCastReply(story + discussion, ids)).toEqual({ groups: [['c']], axes: {}, body: '她在修表。' + discussion });
        expect(() => assertStoryRerollBody(discussion)).toThrow('本轮只需返回正文');
    });

    it('随机建议降低近期固定搭档的权重，即使两人曾在不同大小的组里互动', () => {
        const pairLimits = normalizeStoryCastLimits({ maxGroups: 1 });
        const recent = Array.from({ length: 6 }, (_, index) => [index % 2 ? ['a', 'b', 'c'] : ['d', 'b', 'a']]);
        const sample = (history: string[][][]) => Array.from({ length: 120 }, (_, i) =>
            drawStoryCastGroups(ids, pairLimits, history, seededRandom(7121 * (i + 1)))[0]);
        const unweighted = sample([]);
        const weighted = sample(recent);
        const repeatsPair = (group: string[]) => group.includes('a') && group.includes('b');
        expect(new Set(weighted.map(group => group.sort().join(''))).size).toBeGreaterThan(2);
        expect(weighted.filter(repeatsPair).length).toBeLessThan(unweighted.filter(repeatsPair).length);
    });

    it('角色的单独出场次数不影响随机交流建议', () => {
        const oneGroup = { minGroups: 1, maxGroups: 1 };
        const sample = (history: string[][][]) => Array.from({ length: 120 }, (_, index) =>
            drawStoryCastGroups(ids, oneGroup, history, seededRandom(7121 * (index + 1))));
        const paired = [[['a', 'b']], [['c', 'a'], ['a', 'd']]];
        const frequentLead = paired.map(turn => [...turn, ['a']]);
        expect(sample(frequentLead)).toEqual(sample(paired));
    });

    it('完整保留正文协议并剥离名单', () => {
        expect(parseStoryCastReply(`<turn_cast>[["c"]]</turn_cast>\n${axes(['c'])}<story_text>她在修表。</story_text>`, ids))
            .toEqual({ groups: [['c']], axes: { c: axis }, body: '<story_text>她在修表。</story_text>' });
    });

    it('最少和最多组数只控制本地建议，旧人数设置被忽略', () => {
        const pool = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        const legacyLimits = { minGroups: 5, maxGroups: 8, minPeople: 10, maxPeople: 1 };
        const range = normalizeStoryCastLimits(legacyLimits);
        expect(range).toEqual({ minGroups: 5, maxGroups: 8 });
        expect(drawStoryCastGroups(pool, range, [], () => 0)).toHaveLength(5);
        expect(drawStoryCastGroups(pool, range, [], () => 0.99)).toHaveLength(8);
        expect(drawStoryCastGroups(['a'], range, [], seededRandom(3))).toEqual([['a']]);
        expect(parseStoryCastReply('<turn_cast>[["a"]]</turn_cast>正文', pool).groups).toEqual([['a']]);
        expect(parseStoryCastReply(`<turn_cast>${JSON.stringify([pool])}</turn_cast>正文`, pool).groups).toEqual([pool]);
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
        ]) expect(parseStoryCastReply(output, ids)).toEqual({ groups, axes: { a: axis, b: axis }, body: '正文' });
        const proposals = drawStoryCastGroups(['a', 'b'], range, [], seededRandom(3));
        expect(proposals).toHaveLength(3);
        expect(proposals.filter(group => group.includes('a'))).toHaveLength(2);
        expect(parseStoryCastReply(axes(['a', 'b']) + '正文', ids, groups).groups).toEqual(groups);
        expect(parseStoryCastReply(axes(['a']) + '正文', ids, groups).axes).toEqual({ a: axis });
        expect(parseStoryCastReply(axes(['a', 'c']) + '正文', ids, groups).axes).toEqual({ a: axis });
        expect(parseStoryCastReply('<turn_cast>[["a","b"]]</turn_cast>' + axes(['a', 'b']) + '正文', ids, groups).groups).toEqual(groups);
    });

    it.each([
        { minGroups: 3, maxGroups: 2 },
        { minGroups: 0 },
        { maxGroups: 2.5 },
        { maxGroups: NaN },
        { maxGroups: Infinity },
    ])('无效组数跳过本地建议：%j', partial => {
        const range = normalizeStoryCastLimits(partial);
        expect(drawStoryCastGroups(ids, range, [])).toEqual([]);
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
        expect(parseStoryCastReply(text, ids).body).toBeTruthy();
    });

    it.each(['', '<turn_cast>不是 JSON</turn_cast>', '<turn_cast>[["外人"]]</turn_cast>', '<turn_cast>[["a"'])(
        '无有效名单时保留完整正文并独立读取候选角色私轴：%s', cast => {
            const body = '<story_text>她在修表。</story_text>';
            const text = cast + body + '<private_axes>无效</private_axes>' + axes(['a', '外人']);
            expect(parseStoryCastReply(text, ids)).toEqual({ groups: [], axes: { a: axis }, body });
        },
    );

    it('提示词给出自然交流倾向和可选组合，保留协议与预填', () => {
        const instruction = buildStoryCastInstruction([{ id: 'a', name: '角色A' }], [['a']], '<scene_header>');
        expect(instruction).toContain('候选角色（只用 ID 填写名单）：[["a","角色A"]]');
        expect(instruction).toContain('本轮随机建议组合（优先考虑能自然成立的组合）：[["a"]]');
        expect(instruction).toContain('随机建议只影响本轮对交流机会的关注。');
        expect(instruction).toContain('人物根据性格、当前事务、私轴、关系和剧情进展，自然决定是否交流、与谁交流。');
        expect(instruction).toContain('同一角色可出现在多个组。');
        expect(instruction).not.toMatch(/每组成员|每组至少|整轮去重|单人组|仅允许名单|重组|从候选中决定/);
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
        expect(parseStoryCastReply(text, ids)).toEqual({
            groups: [['a']], axes: { a: axis },
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>修好了钟。</story_text>',
        });
    });

    it('末尾私轴未写完时，只清除残缺的私轴，保留已生成的正文', () => {
        const text = '<turn_cast>[["a"]]</turn_cast><scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情。</story_text><private_axes>{"a":"明天';
        expect(parseStoryCastReply(text, ids)).toEqual({
            groups: [['a']], axes: {},
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情。</story_text>',
        });
        expect(parseStoryCastReply('<turn_cast>[["a"]]</turn_cast><private_axes>{"a":"未完', ids).body).toBe('');
    });

    it('旧三字段私轴仍可读取，并转换成一段文字', () => {
        const oldAxis = { doing: '修表', thinking: '还差一个零件', next: '找工具' };
        const text = '<turn_cast>[["a"]]</turn_cast><story_text>修表。</story_text><private_axes>' + JSON.stringify({ a: oldAxis }) + '</private_axes>';
        expect(parseStoryCastReply(text, ids).axes).toEqual({ a: '修表；还差一个零件；找工具' });
    });

    it('兼容 scene_header 中嵌套的出演名单，保留剧情时间和正文', () => {
        const text = '<scene_header><turn_cast>[["a","b"],["c"]]</turn_cast><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情正文。</story_text>';
        expect(parseStoryCastReply(text, ids)).toEqual({
            groups: [['a', 'b'], ['c']], axes: {},
            body: '<scene_header><time>2026-04-10 14:00</time></scene_header><story_text>完整剧情正文。</story_text>',
        });
    });

    it('读取 scene_header 中的旧式演员数组', () => {
        const text = '<scene_header>[["a","b"]]<time>2026-04-10</time></scene_header><story_text>正文</story_text>';
        expect(parseStoryCastReply(text, ids).groups).toEqual([['a','b']]);
    });
});
