import type { Message, StoryCastLimits } from '../types';

export function normalizeStoryCastLimits(value?: Partial<StoryCastLimits>): StoryCastLimits {
    return {
        minGroups: value?.minGroups ?? 1,
        maxGroups: value?.maxGroups ?? 4,
    };
}

export function validStoryCastLimits({ minGroups, maxGroups }: StoryCastLimits): boolean {
    return [minGroups, maxGroups].every(value => Number.isSafeInteger(value) && value > 0)
        && minGroups <= maxGroups;
}

const groupKey = (group: readonly string[]) => JSON.stringify([...group].sort());
export const storyCastIds = (groups: readonly (readonly string[])[]) => [...new Set(groups.flat())];
export const storyCastFromMessage = (message?: Message): string[][] | undefined => {
    const value: unknown = message?.metadata?.theaterCastGroups;
    return Array.isArray(value) && value.length && value.every(group => Array.isArray(group) && group.length && group.every(id => typeof id === 'string'))
        ? value : undefined;
};

export function drawStoryCastGroups(ids: readonly string[], limits: StoryCastLimits, recent: readonly string[][][], random = Math.random): string[][] {
    const candidates = [...new Set(ids)];
    if (!candidates.length || !validStoryCastLimits(limits)) return [];
    // Keep suggestions compact and fit the number of distinct groups the pool can supply.
    const capacity = Math.min(2 ** candidates.length - 1, candidates.length + 1);
    const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    const count = pick(Math.min(limits.minGroups, capacity), Math.min(limits.maxGroups, capacity));
    const minSize = Math.ceil(Math.log2(count + 1));
    const people = new Map<string, number>();
    const groups = new Map<string, number>();
    recent.slice(-6).reverse().forEach((turn, index) => {
        const weight = (6 - index) / 6;
        for (const group of turn) {
            for (const id of new Set(group)) people.set(id, (people.get(id) ?? 0) + weight);
            const key = groupKey(group);
            groups.set(key, (groups.get(key) ?? 0) + weight);
        }
    });
    let best: string[][] = [];
    let bestScore = -1;
    for (let sample = 0; sample < 24; sample++) {
        const size = pick(minSize, candidates.length);
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
    actors: readonly { id: string; name: string }[], proposals: string[][], prefill?: string,
    storyOnly = false,
): string {
    if (!actors.length) return `当前没有候选角色。只有用户明确发起或接续场外交流时，才按场外模式回答。\n${STORY_OUT_OF_STORY_RULE}`;
    return [
        '### 本轮回复模式（优先于预设中的输出顺序）',
        ...(storyOnly ? ['本轮使用剧情续写模式。'] : [
            STORY_REPLY_MODE_RULE,
        ]),
        '### 剧情续写',
        `候选角色（只用 ID 填写名单）：${JSON.stringify(actors.map(({ id, name }) => [id, name]))}`,
        `本轮随机建议组合（优先考虑能自然成立的组合）：${JSON.stringify(proposals)}`,
        STORY_CAST_TENDENCY,
        '同一角色可出现在多个组。',
        '回复顺序：先独立输出 <turn_cast>角色 ID 的 JSON 二维数组</turn_cast>；然后从原预设起始文本开始完整输出剧情正文；全部剧情区块结束后，最后输出 <private_axes>人物私轴 JSON</private_axes>。出演名单不得嵌入 <scene_header>、<story_text> 等原预设标签。',
        STORY_PRIVATE_AXES_RULE,
        prefill ? `出演名单关闭后，正文沿用预设起始文本：\n${prefill}` : '',
    ].filter(Boolean).join('\n');
}

export const STORY_CAST_TENDENCY = '本轮关注候选人物之间的关系与交流机会。结合人物当前生活、私轴、性格、关系和剧情进展安排人物行动，让角色之间形成各自的交流与生活联系。';
export const STORY_PRIVATE_AXES_RULE = [
    '读取各角色最近的私轴，人物从自身经历、人格、关系和环境中展开本轮行动。',
    '本轮剧情全部写完后，最后输出 <private_axes>JSON</private_axes>。JSON 以本轮出演角色 ID 为键，每个值为一段简短文字。',
    '人物私轴：人物自己的生活琐事、想法思考、外界影响和选择行为。每轮剧情结束后更新，延续到下一轮。',
    '私轴记录剧情结尾仍在继续的事情或念头；直接输出标签与 JSON，不加代码围栏或说明。',
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

export type StoryPrivateAxis = string;
type StoryPrivateAxes = Record<string, StoryPrivateAxis>;

function readAxis(value: unknown): StoryPrivateAxis | undefined {
    if (typeof value === 'string') return value.trim() || undefined;
    // 已保存的旧三字段私轴仍可承接到下一轮。
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const { doing, thinking, next } = value as { doing?: unknown; thinking?: unknown; next?: unknown };
    const legacy = [doing, thinking, next]
        .filter((part): part is string => typeof part === 'string' && !!part.trim())
        .map(part => part.trim());
    return legacy.length ? legacy.join('；') : undefined;
}

export function storyPrivateAxesFromMessage(reply: Message, rowsById: ReadonlyMap<number, Message>): StoryPrivateAxes {
    if (!reply.metadata?.theaterPrivateAxes || reply.metadata.theaterOutOfStory) return {};
    const inputId = reply.metadata?.theaterInputId;
    const input = rowsById.get(inputId);
    if (inputId > 0 && (!input || input.metadata?.theaterInputRevision !== reply.metadata?.theaterPrivateAxesInputRevision)) return {};
    const axes = reply.metadata?.theaterPrivateAxes;
    const groups = storyCastFromMessage(reply);
    return Object.fromEntries((groups ? storyCastIds(groups) : Object.keys(axes)).flatMap(id => {
        const axis = readAxis(axes[id]);
        return axis ? [[id, axis]] : [];
    }));
}

export function parseOutOfStoryReply(text: string): string | undefined {
    if (!outOfStoryTag.test(text)) return undefined;
    const body = /^<out_of_story>([\s\S]*?)<\/out_of_story\s*>$/i.exec(unwrapFence(text))?.[1].trim();
    if (!body || outOfStoryTag.test(body) || castTag.test(body) || axesTag.test(body)) throw new Error('场外回复格式无效，请重试。');
    return body;
}

function sanitizeStoryCastGroups(value: unknown, allowed: ReadonlySet<string>): string[][] {
    if (!Array.isArray(value)) return [];
    const groups: string[][] = [], seen = new Set<string>();
    for (const item of value) {
        if (!Array.isArray(item)) continue;
        const group = [...new Set(item.filter((id): id is string => typeof id === 'string' && allowed.has(id)))];
        if (!group.length) continue;
        const key = groupKey(group);
        if (!seen.has(key)) { seen.add(key); groups.push(group); }
    }
    return groups;
}
function readJsonArrayAt(text: string, start: number): { value: unknown; end: number } | undefined {
    if (text[start] !== '[') return;
    let depth = 0, quoted = false, escaped = false;
    for (let i = start; i < text.length; i++) {
        const ch = text[i];
        if (quoted) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') quoted = false; continue; }
        if (ch === '"') quoted = true;
        else if (ch === '[') depth++;
        else if (ch === ']' && --depth === 0) {
            try { return { value: JSON.parse(text.slice(start, i + 1)), end: i + 1 }; } catch { return; }
        }
    }
}
function readLegacySceneHeaderGroups(text: string, allowed: ReadonlySet<string>): { groups: string[][]; fragment: string } | undefined {
    const header = /<scene_header\b[^>]*>/i.exec(text);
    if (!header) return;
    let start = header.index + header[0].length;
    while (/\s/.test(text[start] ?? '')) start++;
    const parsed = readJsonArrayAt(text, start);
    if (!parsed) return;
    const groups = sanitizeStoryCastGroups(parsed.value, allowed);
    return groups.length ? { groups, fragment: text.slice(start, parsed.end) } : undefined;
}
export function parseStoryCastReply(text: string, candidateIds: readonly string[], fixedCast?: string[][]): { groups: string[][]; axes: StoryPrivateAxes; body: string } {
    const response = unwrapProtocolBlock(unwrapFence(String(text || '').replace(/^\uFEFF/, '')));
    const allowed = new Set(candidateIds);
    const castMatches = [...response.matchAll(/<turn_cast\b[^>]*>([\s\S]*?)<\/turn_cast\s*>/gi)];
    let groups = fixedCast ? sanitizeStoryCastGroups(fixedCast, allowed) : [];
    if (!fixedCast) for (const match of castMatches) {
        try { groups = sanitizeStoryCastGroups(JSON.parse(unwrapFence(match[1])), allowed); if (groups.length) break; } catch { /* 保留正文，继续尝试其他来源。 */ }
    }
    const legacy = !groups.length && !fixedCast ? readLegacySceneHeaderGroups(response, allowed) : undefined;
    if (legacy) groups = legacy.groups;
    const axes = new Map<string, StoryPrivateAxis>();
    const axisIds = groups.length ? storyCastIds(groups) : allowed;
    const axisMatches = [...response.matchAll(/<private_axes\b[^>]*>([\s\S]*?)<\/private_axes\s*>/gi)];
    for (const match of axisMatches) {
        try {
            const raw = JSON.parse(unwrapFence(match[1])) as unknown;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            for (const id of axisIds) {
                if (axes.has(id) || !Object.prototype.hasOwnProperty.call(raw, id)) continue;
                const axis = readAxis((raw as Record<string, unknown>)[id]);
                if (axis) axes.set(id, axis);
            }
        } catch { /* 私轴为可选数据。 */ }
    }
    let body = response;
    for (const match of castMatches) body = body.replace(match[0], '');
    for (const match of axisMatches) body = body.replace(match[0], '');
    if (legacy) body = body.replace(legacy.fragment, '');
    const unclosedCast = /<turn_cast\b[^>]*>\s*/i.exec(body);
    if (unclosedCast) {
        const start = unclosedCast.index + unclosedCast[0].length;
        const end = readJsonArrayAt(body, start)?.end;
        const nextTag = body.slice(start).search(/<\/?[a-z][\w-]*\b/i);
        body = body.slice(0, unclosedCast.index) + (end !== undefined
            ? body.slice(end) : nextTag < 0 ? '' : body.slice(start + nextTag));
    }
    // 输出在末尾私轴处截断时，仍保留已经完成的剧情正文。
    body = body.replace(/<private_axes\b[^>]*>[\s\S]*$/i, '').trim();
    return { groups, axes: Object.fromEntries(axes), body };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text) || outOfStoryTag.test(text) || axesTag.test(text)) throw new Error('本轮只需返回正文。原记录已保留。');
    return text;
}
