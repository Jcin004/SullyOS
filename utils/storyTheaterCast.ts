import type { Message, StoryCastLimits } from '../types';

export function normalizeStoryCastLimits(value?: Partial<StoryCastLimits>, poolSize = Number.MAX_SAFE_INTEGER): StoryCastLimits {
    return {
        minGroups: value?.minGroups ?? 1,
        maxGroups: value?.maxGroups ?? 4,
        minPeople: value?.minPeople ?? 1,
        maxPeople: value?.maxPeople ?? Math.max(1, poolSize),
    };
}

export function validStoryCastLimits(limits: StoryCastLimits): boolean {
    const { minGroups, maxGroups, minPeople, maxPeople } = limits;
    return [minGroups, maxGroups, minPeople, maxPeople].every(value => Number.isSafeInteger(value) && value > 0)
        && minGroups <= maxGroups && minPeople <= maxPeople;
}

function effectiveStoryCastLimits(poolSize: number, limits: StoryCastLimits): StoryCastLimits | undefined {
    if (!validStoryCastLimits(limits)) return undefined;
    const maxPeople = Math.min(poolSize, limits.maxPeople);
    // An n-person cast has at most 2^n - 1 distinct nonempty groups.
    const minPeople = Math.max(limits.minPeople, Math.ceil(Math.log2(limits.minGroups + 1)));
    if (minPeople > maxPeople) return undefined;
    return { ...limits, minPeople, maxPeople, maxGroups: Math.min(limits.maxGroups, 2 ** maxPeople - 1) };
}

const groupKey = (group: readonly string[]) => JSON.stringify([...group].sort());
export const storyCastIds = (groups: readonly (readonly string[])[]) => [...new Set(groups.flat())];
export const storyCastFromMessage = (message?: Message): string[][] | undefined => {
    const value: unknown = message?.metadata?.theaterCastGroups;
    return Array.isArray(value) && value.length && value.every(group => Array.isArray(group) && group.length && group.every(id => typeof id === 'string'))
        ? value : undefined;
};

export function canDrawStoryCast(poolSize: number, limits: StoryCastLimits): boolean {
    return !!effectiveStoryCastLimits(poolSize, limits);
}

export function drawStoryCastGroups(ids: readonly string[], limits: StoryCastLimits, recent: readonly string[][][], random = Math.random): string[][] {
    const candidates = [...new Set(ids)];
    const range = effectiveStoryCastLimits(candidates.length, limits);
    if (!range || range.minGroups > candidates.length + 1) return [];
    const people = new Map<string, number>();
    const groups = new Map<string, number>();
    recent.slice(-6).reverse().forEach((turn, index) => {
        const weight = (6 - index) / 6;
        for (const id of storyCastIds(turn)) people.set(id, (people.get(id) ?? 0) + weight);
        for (const group of turn) {
            const key = groupKey(group);
            groups.set(key, (groups.get(key) ?? 0) + weight);
        }
    });
    const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    let best: string[][] = [];
    let bestScore = -1;
    for (let sample = 0; sample < 24; sample++) {
        const size = pick(range.minPeople, range.maxPeople);
        // Suggestions are advisory. Prefer a compact sample even when the user allows many groups.
        const count = pick(range.minGroups, Math.min(range.maxGroups, 2 ** size - 1, Math.max(range.minGroups, size + 1)));
        const selected = candidates.map(id => ({ id, rank: -Math.log(1 - random()) * (1 + (people.get(id) ?? 0)) }))
            .sort((a, b) => a.rank - b.rank).slice(0, size).map(row => row.id);
        const proposed = selected.slice(0, count).map(id => [id]);
        for (const id of selected.slice(count)) proposed[pick(0, proposed.length - 1)].push(id);
        if (size > 1 && proposed.length > 1 && random() < 0.5) {
            const overlap = selected.find(id => !proposed[0].includes(id));
            if (overlap) proposed[0].push(overlap);
        }
        const used = new Set(proposed.map(groupKey));
        for (let mask = 1; proposed.length < count; mask++) {
            const group = selected.filter((_, index) => Math.floor(mask / 2 ** index) % 2 === 1);
            const key = groupKey(group);
            if (!used.has(key)) { used.add(key); proposed.push(group); }
        }
        const repetition = proposed.reduce((sum, group) => sum + (groups.get(groupKey(group)) ?? 0), 0);
        const score = random() / (1 + repetition / count);
        if (score > bestScore) { best = proposed; bestScore = score; }
    }
    return best;
}

export function buildStoryCastInstruction(
    actors: readonly { id: string; name: string }[], limits: StoryCastLimits, proposals: string[][], prefill?: string,
    storyOnly = false,
): string {
    const range = effectiveStoryCastLimits(new Set(actors.map(actor => actor.id)).size, limits);
    if (!range) return `当前出演范围不可用。只有用户明确发起或接续场外交流时，才按场外模式回答。\n${STORY_OUT_OF_STORY_RULE}`;
    return [
        '### 本轮回复模式（优先于预设中的输出顺序）',
        ...(storyOnly ? ['本轮使用剧情续写模式。'] : [
            STORY_REPLY_MODE_RULE,
        ]),
        '### 剧情续写',
        `候选角色（只用 ID 填写名单）：${JSON.stringify(actors.map(({ id, name }) => [id, name]))}`,
        `本轮随机建议组合（优先考虑能自然成立的组合，可从候选池重组）：${JSON.stringify(proposals)}`,
        `从候选中决定 ${range.minGroups}～${range.maxGroups} 个不同的组。整轮去重后共 ${range.minPeople}～${range.maxPeople} 位演员，每组至少一人。同一角色可跨组，每组内只填一次。用户执笔的身份不进入名单。`,
        '回复从 <turn_cast> 开始，内部为角色 ID 的 JSON 二维数组，紧接 </turn_cast>。',
        STORY_PRIVATE_AXES_RULE,
        STORY_CAST_ACTION_RULE,
        prefill ? `私轴关闭后，正文沿用预设起始文本：\n${prefill}` : '',
    ].filter(Boolean).join('\n');
}

export const STORY_CAST_ACTION_RULE = '按互动联系分组。同一地点可以有多组，人物也可以跨地点互动。每组成员都要在正文实际出场，依据各自私轴和关系自然互动，例如交谈、行动、协作、打断、观察或相互影响。单人组可推进自己的事。除用户执笔的身份外，正文仅允许名单中的角色实际出场。';
export const STORY_PRIVATE_AXES_RULE = [
    '读完剧情前文、角色设定、记忆及最近的私轴，再读用户本轮的完整输入。',
    '名单之后输出 <private_axes>JSON</private_axes>，JSON 是以角色 ID 为键的对象。每位出演角色恰好一项，字段为 doing（正在做什么）、thinking（正在想什么）、next（接下来想做什么），三个值都是非空字符串。',
    '延续每个人的活动、状态与未完成事项、当前关注与惦记、计划与未定选择。按经历、人格、关系、身体状态、时间和外界变化更新。用户的输入进入正在发生的生活；人物自行决定如何回应，原有事务可以继续、被打断、改变或结束。私轴可以保持稳定。',
    '关闭私轴标签后立即按原预设输出正文。直接输出标签与 JSON，不加代码围栏或说明。',
].join('\n');
export const STORY_OUT_OF_STORY_RULE = '场外模式只输出 <out_of_story>你以 AI 本体身份回复用户的正文</out_of_story>。用普通对话回答，不扮演剧场角色、不推进剧情，不输出演员名单、场景条或其他预设区块。场外讨论是创作交流，不代表已经发生的剧情事实。';
export const STORY_REPLY_MODE_RULE = `根据最新输入选择回复模式。用户明确跳出剧情与 AI 交流、讨论故事或设定，或接续场外讨论时，使用场外模式。角色对白、剧情指令或要求继续剧情时，按原预设生成正文。每轮只用一种模式。\n${STORY_OUT_OF_STORY_RULE}`;
const castTag = /<\/?turn_cast\b/i;
const outOfStoryTag = /<\/?out_of_story\b/i;
const axesTag = /<\/?private_axes\b/i;
const unwrapFence = (text: string) => /^\s*```(?:json|xml|html|text)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(text)?.[1].trim() ?? text.trim();
const unwrapProtocolBlock = (text: string) => text.replace(
    /^```(?:xml|html|text)?[ \t]*\r?\n\s*(<(?:turn_cast|private_axes)>[\s\S]*?<\/(?:turn_cast|private_axes)\s*>)\s*\r?\n```[ \t]*(?:\r?\n|$)/i,
    '$1\n',
);

export interface StoryPrivateAxis { doing: string; thinking: string; next: string }
type StoryPrivateAxes = Record<string, StoryPrivateAxis>;

function readAxis(value: unknown): StoryPrivateAxis | undefined {
    if (!value || typeof value !== 'object') return;
    const { doing, thinking, next } = value as Partial<StoryPrivateAxis>;
    if (typeof doing === 'string' && doing.trim() && typeof thinking === 'string' && thinking.trim()
        && typeof next === 'string' && next.trim()) {
        return { doing: doing.trim(), thinking: thinking.trim(), next: next.trim() };
    }
}

export function storyPrivateAxesFromMessage(reply: Message, rowsById: ReadonlyMap<number, Message>): StoryPrivateAxes {
    if (!reply.metadata?.theaterPrivateAxes || reply.metadata.theaterOutOfStory) return {};
    const inputId = reply.metadata?.theaterInputId;
    const input = rowsById.get(inputId);
    if (inputId > 0 && (!input || input.metadata?.theaterInputRevision !== reply.metadata?.theaterPrivateAxesInputRevision)) return {};
    const axes = reply.metadata?.theaterPrivateAxes;
    return Object.fromEntries(storyCastIds(storyCastFromMessage(reply) ?? []).flatMap(id => {
        const axis = readAxis(axes?.[id]);
        return axis ? [[id, axis]] : [];
    }));
}

export function parseOutOfStoryReply(text: string): string | undefined {
    if (!outOfStoryTag.test(text)) return undefined;
    const body = /^<out_of_story>([\s\S]*?)<\/out_of_story\s*>$/i.exec(unwrapFence(text))?.[1].trim();
    if (!body || outOfStoryTag.test(body) || castTag.test(body) || axesTag.test(body)) throw new Error('场外回复格式无效，请重试。');
    return body;
}

export function parseStoryCastReply(text: string, candidateIds: readonly string[], limits: StoryCastLimits, fixedCast?: string[][]): { groups: string[][]; axes: StoryPrivateAxes; body: string } {
    const invalid = () => new Error('本轮出演名单无效，未保存角色记忆。可点击推进重试。');
    const response = unwrapProtocolBlock(unwrapFence(text));
    const match = /^<turn_cast>([\s\S]*?)<\/turn_cast\s*>\s*/i.exec(response);
    if (!match && !fixedCast) throw invalid();
    let groups: unknown = fixedCast;
    if (match) {
        try { groups = JSON.parse(unwrapFence(match[1])); } catch { throw invalid(); }
    }
    const allowed = new Set(candidateIds);
    const range = fixedCast ? undefined : effectiveStoryCastLimits(allowed.size, limits);
    if (!Array.isArray(groups) || (!fixedCast && (!range || groups.length < range.minGroups || groups.length > range.maxGroups))) throw invalid();
    const seen = new Set<string>();
    const groupKeys = new Set<string>();
    for (const group of groups) {
        if (!Array.isArray(group) || !group.length || new Set(group).size !== group.length) throw invalid();
        for (const id of group) {
            if (typeof id !== 'string' || !allowed.has(id)) throw invalid();
            seen.add(id);
        }
        const key = groupKey(group);
        if (groupKeys.has(key)) throw invalid();
        groupKeys.add(key);
    }
    if (range && (seen.size < range.minPeople || seen.size > range.maxPeople)) throw invalid();
    if (fixedCast && (groupKeys.size !== fixedCast.length || fixedCast.some(group => !groupKeys.has(groupKey(group))))) throw invalid();
    const remainder = unwrapProtocolBlock(response.slice(match?.[0].length ?? 0));
    if (!remainder || castTag.test(remainder) || outOfStoryTag.test(remainder)) throw invalid();
    const axesMatch = /^<private_axes>([\s\S]*?)<\/private_axes\s*>\s*/i.exec(remainder);
    const invalidAxes = () => new Error('本轮人物私轴无效，每位出演者都需要三项内容。原记录已保留，可重试。');
    if (!axesMatch) throw invalidAxes();
    let raw: StoryPrivateAxes;
    try { raw = JSON.parse(unwrapFence(axesMatch[1])); } catch { throw invalidAxes(); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== seen.size) throw invalidAxes();
    const axes = Object.fromEntries([...seen].map(id => {
        const axis = Object.prototype.hasOwnProperty.call(raw, id) && readAxis(raw[id]);
        if (!axis) throw invalidAxes();
        return [id, axis];
    }));
    const body = remainder.slice(axesMatch[0].length).trim();
    if (!body || axesTag.test(body)) throw invalid();
    return { groups: fixedCast ?? groups, axes, body };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text) || outOfStoryTag.test(text) || axesTag.test(text)) throw new Error('本轮只需返回正文。原记录已保留。');
    return text;
}
