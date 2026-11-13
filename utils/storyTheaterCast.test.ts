import { describe, expect, it } from 'vitest';
import { assertStoryRerollBody, buildStoryCastInstruction, canDrawStoryCast, drawStoryCastGroups, normalizeStoryCastLimits, parseOutOfStoryReply, parseStoryCastReply } from './storyTheaterCast';

const axis = { doing: '修表', thinking: '还差一个零件', next: '找工具' };
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
        expect(() => parseStoryCastReply(story + discussion, ids, limits)).toThrow('出演名单无效');
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

    it('接受跨组重复、可恢复的代码围栏，重写仍须遵守原名单和完整私轴', () => {
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
        expect(() => parseStoryCastReply(axes(['a']) + '正文', ids, range, groups)).toThrow('人物私轴无效');
        expect(() => parseStoryCastReply(axes(['a', 'c']) + '正文', ids, range, groups)).toThrow('人物私轴无效');
        expect(() => parseStoryCastReply('<turn_cast>[["a","b"]]</turn_cast>' + axes(['a', 'b']) + '正文', ids, range, groups)).toThrow('出演名单无效');
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
        expect(() => parseStoryCastReply('<turn_cast>[["a"]]</turn_cast>正文', ids, range)).toThrow('出演名单无效');
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
        '<turn_cast>[["a"]]</turn_cast>',
        '<turn_cast>[["a"]]</turn_cast>正文<turn_cast>[["b"]]</turn_cast>',
    ])('拒绝无效输出：%s', text => {
        expect(() => parseStoryCastReply(text, ids, limits)).toThrow('出演名单无效');
    });
});
