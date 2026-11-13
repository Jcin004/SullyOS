import type { Message, StoryCastLimits } from '../types';

const bounded = (value: unknown, max: number, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(max, Math.round(value))) : fallback;

export function normalizeStoryCastLimits(value?: Partial<StoryCastLimits>): StoryCastLimits {
    const maxGroups = bounded(value?.maxGroups, 4, 4);
    const maxPeople = bounded(value?.maxPeople, 5, 5);
    return {
        minGroups: Math.min(maxGroups, bounded(value?.minGroups, 4, 1)), maxGroups,
        minPeople: Math.min(maxPeople, bounded(value?.minPeople, 5, 1)), maxPeople,
    };
}

const groupKey = (group: readonly string[]) => JSON.stringify([...group].sort());
export const storyCastIds = (groups: readonly (readonly string[])[]) => [...new Set(groups.flat())];
export const storyCastFromMessage = (message?: Message): string[][] | undefined => {
    const value: unknown = message?.metadata?.theaterCastGroups;
    return Array.isArray(value) && value.length && value.every(group => Array.isArray(group) && group.length && group.every(id => typeof id === 'string'))
        ? value : undefined;
};

export function canDrawStoryCast(poolSize: number, limits: StoryCastLimits): boolean {
    let distinct = 0;
    let combinations = 1;
    for (let size = 1; size <= Math.min(poolSize, limits.maxPeople); size++) {
        combinations *= (poolSize - size + 1) / size;
        if (size >= limits.minPeople) distinct += Math.round(combinations);
    }
    return distinct >= limits.minGroups;
}

export function drawStoryCastGroups(ids: readonly string[], limits: StoryCastLimits, recent: readonly string[][][], random = Math.random): string[][] {
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
    const upper = Math.min(ids.length, limits.maxPeople);
    const proposed: string[][] = [];
    const used = new Set<string>();
    // Draw alternatives, then downweight familiar groups as well as familiar individuals.
    for (let i = 0; i < limits.maxGroups && upper >= limits.minPeople; i++) {
        let best: { group: string[]; score: number } | undefined;
        for (let sample = 0; sample < 24; sample++) {
            const size = limits.minPeople + Math.floor(random() * (upper - limits.minPeople + 1));
            const group = ids.map(id => ({ id, rank: -Math.log(1 - random()) * (1 + (people.get(id) ?? 0)) }))
                .sort((a, b) => a.rank - b.rank).slice(0, size).map(row => row.id);
            const key = groupKey(group);
            if (used.has(key)) continue;
            const score = random() / (1 + (groups.get(key) ?? 0));
            if (!best || score > best.score) best = { group, score };
        }
        if (!best) break;
        used.add(groupKey(best.group));
        proposed.push(best.group);
    }
    return proposed;
}

export function buildStoryCastInstruction(
    actors: readonly { id: string; name: string }[], limits: StoryCastLimits, proposals: string[][], prefill?: string,
): string {
    return [
        '### 本轮选角（先于正文，优先于预设中的输出顺序）',
        `候选角色（只用 ID 填写名单）：${JSON.stringify(actors.map(({ id, name }) => [id, name]))}`,
        `本轮随机建议组合（优先考虑能自然成立的组合，可从候选池重组）：${JSON.stringify(proposals)}`,
        `先结合最新输入、场景、人物近况与各自未完的事，从候选中决定 ${limits.minGroups}～${limits.maxGroups} 组，每组 ${limits.minPeople}～${Math.min(actors.length, limits.maxPeople)} 人。组内不重复，整组不得重复；无需凑满上限。`,
        '回复必须从 <turn_cast> 开始，内部是 JSON 二维数组（每组为一组角色 ID），紧接 </turn_cast>，再按原预设写正文。不要输出代码围栏、解释或备选名单。用户执笔的身份不进入名单。',
        STORY_CAST_ACTION_RULE,
        prefill ? `名单关闭后，正文沿用预设起始文本：\n${prefill}` : '',
    ].filter(Boolean).join('\n');
}

export const STORY_CAST_ACTION_RULE = '名单里的每个人都要实际行动、与别人互动或推进私事。单人组可推进私事；多人组须实际互动。各组可在不同地点，也可在同一场景另一侧交谈。用户输入只是其中一侧；除用户执笔的身份外，正文仅允许名单中的角色实际出场。';
const castTag = /<\/?turn_cast\b/i;

export function parseStoryCastReply(text: string, candidateIds: readonly string[], limits: StoryCastLimits): { groups: string[][]; body: string } {
    const invalid = () => new Error('本轮出演名单无效，未保存角色记忆。可点击推进重试。');
    const match = /^\s*<turn_cast>([\s\S]*?)<\/turn_cast>\s*([\s\S]+)$/i.exec(text);
    if (!match || !match[2].trim() || castTag.test(match[2])) throw invalid();
    let groups: unknown;
    try { groups = JSON.parse(match[1]); } catch { throw invalid(); }
    if (!Array.isArray(groups) || groups.length < limits.minGroups || groups.length > limits.maxGroups) throw invalid();
    const allowed = new Set(candidateIds);
    const seen = new Set<string>();
    for (const group of groups) {
        if (!Array.isArray(group) || group.length < limits.minPeople || group.length > limits.maxPeople
            || !group.every(id => typeof id === 'string' && allowed.has(id)) || new Set(group).size !== group.length) throw invalid();
        const key = groupKey(group);
        if (seen.has(key)) throw invalid();
        seen.add(key);
    }
    return { groups, body: match[2].trim() };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text)) throw new Error('重写只需返回正文，原有出演名单和正文已保留。');
    return text;
}
