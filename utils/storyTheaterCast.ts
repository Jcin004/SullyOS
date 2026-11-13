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
    const minPeople = Math.max(limits.minGroups, limits.minPeople);
    if (minPeople > maxPeople) return undefined;
    return { ...limits, minPeople, maxPeople, maxGroups: Math.min(limits.maxGroups, maxPeople) };
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
    if (!range) return [];
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
    // Sample complete casts so each proposed group draws from the same pool without replacement.
    for (let sample = 0; sample < 24; sample++) {
        const size = pick(range.minPeople, range.maxPeople);
        const count = pick(range.minGroups, Math.min(range.maxGroups, size));
        const selected = candidates.map(id => ({ id, rank: -Math.log(1 - random()) * (1 + (people.get(id) ?? 0)) }))
            .sort((a, b) => a.rank - b.rank).slice(0, size).map(row => row.id);
        const proposed = selected.slice(0, count).map(id => [id]);
        for (const id of selected.slice(count)) proposed[pick(0, count - 1)].push(id);
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
            '根据最新输入选择模式。用户明确跳出剧情与 AI 交流、讨论故事或设定，或在场外历史后接续该讨论时，使用场外模式。角色对白、剧情指令和明确要求继续剧情时，使用下方的剧情续写模式。每轮只用一种模式。',
            STORY_OUT_OF_STORY_RULE,
        ]),
        '### 剧情续写',
        `候选角色（只用 ID 填写名单）：${JSON.stringify(actors.map(({ id, name }) => [id, name]))}`,
        `本轮随机建议组合（优先考虑能自然成立的组合，可从候选池重组）：${JSON.stringify(proposals)}`,
        `先结合最新输入、场景、人物近况与各自未完的事，从候选中决定 ${range.minGroups}～${range.maxGroups} 组。所有组加起来共 ${range.minPeople}～${range.maxPeople} 位不同演员，每组至少一人，每位演员只能归入一组；无需凑满上限。`,
        '回复必须从 <turn_cast> 开始，内部是 JSON 二维数组（每组为一组角色 ID），紧接 </turn_cast>，再按原预设写正文。不要输出代码围栏、解释或备选名单。用户执笔的身份不进入名单。',
        STORY_CAST_ACTION_RULE,
        prefill ? `名单关闭后，正文沿用预设起始文本：\n${prefill}` : '',
    ].filter(Boolean).join('\n');
}

export const STORY_CAST_ACTION_RULE = '名单里的每个人都要实际行动、与别人互动或推进私事。单人组可推进私事；多人组须实际互动。各组可在不同地点，也可在同一场景另一侧交谈。用户输入只是其中一侧；除用户执笔的身份外，正文仅允许名单中的角色实际出场。';
export const STORY_OUT_OF_STORY_RULE = '场外模式只输出 <out_of_story>你以 AI 本体身份回复用户的正文</out_of_story>。用普通对话回答，不扮演剧场角色、不推进剧情，不输出演员名单、场景条或其他预设区块。场外讨论是创作交流，不代表已经发生的剧情事实。';
const castTag = /<\/?turn_cast\b/i;
const outOfStoryTag = /<\/?out_of_story\b/i;

export function parseOutOfStoryReply(text: string): string | undefined {
    if (!outOfStoryTag.test(text)) return undefined;
    const body = /^\s*<out_of_story>([\s\S]*?)<\/out_of_story>\s*$/i.exec(text)?.[1].trim();
    if (!body || outOfStoryTag.test(body) || castTag.test(body)) throw new Error('场外回复格式无效，请重试。');
    return body;
}

export function parseStoryCastReply(text: string, candidateIds: readonly string[], limits: StoryCastLimits): { groups: string[][]; body: string } {
    const invalid = () => new Error('本轮出演名单无效，未保存角色记忆。可点击推进重试。');
    const match = /^\s*<turn_cast>([\s\S]*?)<\/turn_cast>\s*([\s\S]+)$/i.exec(text);
    if (!match || !match[2].trim() || castTag.test(match[2]) || outOfStoryTag.test(match[2])) throw invalid();
    let groups: unknown;
    try { groups = JSON.parse(match[1]); } catch { throw invalid(); }
    const allowed = new Set(candidateIds);
    const range = effectiveStoryCastLimits(allowed.size, limits);
    if (!range || !Array.isArray(groups) || groups.length < range.minGroups || groups.length > range.maxGroups) throw invalid();
    const seen = new Set<string>();
    for (const group of groups) {
        if (!Array.isArray(group) || group.length === 0) throw invalid();
        for (const id of group) {
            if (typeof id !== 'string' || !allowed.has(id) || seen.has(id)) throw invalid();
            seen.add(id);
        }
    }
    if (seen.size < range.minPeople || seen.size > range.maxPeople) throw invalid();
    return { groups, body: match[2].trim() };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text) || outOfStoryTag.test(text)) throw new Error('重写只需返回正文，原有出演名单和正文已保留。');
    return text;
}
