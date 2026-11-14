import type { Message, StoryCastLimits } from '../types';

export function normalizeStoryCastLimits(value?: Partial<StoryCastLimits>, poolSize = Number.MAX_SAFE_INTEGER): StoryCastLimits {
    return {
        minGroups: value?.minGroups ?? 1,
        maxGroups: value?.maxGroups ?? Math.max(4, Math.min(12, poolSize * 2)),
        minPeople: value?.minPeople ?? 1,
        maxPeople: value?.maxPeople ?? Math.max(1, poolSize),
    };
}

export function validStoryCastLimits(limits: StoryCastLimits): boolean {
    const { minGroups, maxGroups, minPeople, maxPeople } = limits;
    return [minGroups, maxGroups, minPeople, maxPeople].every(value => Number.isSafeInteger(value) && value > 0)
        && minGroups <= maxGroups && minPeople <= maxPeople;
}

// Groups represent actual interpersonal exchanges. A solo cast is kept only for one-person scenes.
function maximumInteractionGroups(size: number): number {
    if (size < 2) return size;
    return size > 52 ? Number.MAX_SAFE_INTEGER : 2 ** size - size - 1;
}

function effectiveStoryCastLimits(poolSize: number, limits: StoryCastLimits): StoryCastLimits | undefined {
    if (!validStoryCastLimits(limits) || poolSize < 1) return undefined;
    const maxPeople = Math.min(poolSize, limits.maxPeople);
    let minPeople = Math.max(limits.minPeople, poolSize > 1 ? 2 : 1);
    while (minPeople <= maxPeople && maximumInteractionGroups(minPeople) < limits.minGroups) minPeople++;
    if (minPeople > maxPeople) return undefined;
    return { ...limits, minPeople, maxPeople, maxGroups: Math.min(limits.maxGroups, maximumInteractionGroups(maxPeople)) };
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
    const recentGroups = new Map<string, number>();
    recent.slice(-6).reverse().forEach((turn, index) => {
        const weight = (6 - index) / 6;
        for (const id of storyCastIds(turn)) people.set(id, (people.get(id) ?? 0) + weight);
        for (const group of turn) {
            const key = groupKey(group);
            recentGroups.set(key, (recentGroups.get(key) ?? 0) + weight);
        }
    });
    const pick = (min: number, max: number) => min + Math.floor(random() * (max - min + 1));
    let best: string[][] = [];
    let bestScore = -1;

    for (let sample = 0; sample < 24; sample++) {
        const size = pick(range.minPeople, range.maxPeople);
        if (maximumInteractionGroups(size) < range.minGroups) continue;
        const count = pick(range.minGroups, Math.min(range.maxGroups, maximumInteractionGroups(size)));
        const selected = candidates.map(id => ({ id, rank: -Math.log(Math.max(1e-12, 1 - random())) * (1 + (people.get(id) ?? 0)) }))
            .sort((a, b) => a.rank - b.rank).slice(0, size).map(row => row.id);

        // A group may be one shared multi-person conversation, a direct pair,
        // or an overlapping exchange after attention moves to a different speaker.
        // Offer all these structures; the story model decides which really occurs.
        const options: string[][] = [];
        const optionKeys = new Set<string>();
        const addOption = (members: string[]) => {
            if (members.length < 2 && size > 1) return;
            const key = groupKey(members);
            if (optionKeys.has(key)) return;
            optionKeys.add(key);
            options.push(members);
        };
        if (size === 1) addOption(selected);
        else {
            // Pairs: A-B and C-D in parallel, or A-B followed by B-C.
            for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
                addOption([selected[i], selected[j]]);
            }
            // Multi-person shared discussion: A,B,C,D in the SAME interaction.
            addOption(selected);
            for (let n = 3; n <= Math.min(size, 6); n++) {
                for (let start = 0; start < size; start++) {
                    const rotated = [...selected.slice(start), ...selected.slice(0, start)];
                    addOption(rotated.slice(0, n));
                }
            }
            // Varied membership, without enumerating the entire exponential powerset.
            for (let sampleOption = 0; sampleOption < Math.min(size * 5, 50); sampleOption++) {
                const sampled = selected.map(id => ({ id, rank: random() }))
                    .sort((a, b) => a.rank - b.rank).slice(0, pick(3, size)).map(item => item.id);
                addOption(sampled);
            }
        }
        const used = new Set<string>(), uncovered = new Set(selected), proposed: string[][] = [];
        const hub = selected[pick(0, size - 1)];
        const hubBonus = random() < 0.6 ? 2.2 : 0.2;
        // A larger group is a valid single discussion, not an accidental overflow of pairs.
        const preferredSize = count === 1 ? size : random() < 0.45
            ? pick(Math.min(3, size), size)
            : 2;
        for (let index = 0; index < count; index++) {
            let chosen: string[] | undefined;
            let chosenScore = -Infinity;
            for (const option of options) {
                const key = groupKey(option);
                if (used.has(key)) continue;
                const newlyCovered = option.filter(id => uncovered.has(id)).length;
                const score = newlyCovered * 2.4 + (option.includes(hub) ? hubBonus : 0)
                    - Math.abs(option.length - preferredSize) * 1.4
                    - (recentGroups.get(key) ?? 0) * 2.5 + random() * 2.6;
                if (score > chosenScore) { chosen = option; chosenScore = score; }
            }
            if (!chosen) break;
            proposed.push([...chosen]);
            used.add(groupKey(chosen));
            for (const id of chosen) uncovered.delete(id);
        }
        // Everybody selected for this sample needs to participate in at least one exchange.
        // When there are too few links for separate pairs, extend existing groups.
        for (const id of uncovered) {
            const shortest = proposed.reduce((bestIndex, group, index) =>
                group.length < proposed[bestIndex].length ? index : bestIndex, 0);
            proposed[shortest].push(id);
        }
        if (proposed.length !== count || new Set(proposed.map(groupKey)).size !== count) continue;
        const repetition = proposed.reduce((sum, group) => sum + (recentGroups.get(groupKey(group)) ?? 0), 0);
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
        `可参考的互动关系（仅是变化建议；请根据当前剧情重新决定，绝不照搬或为了凑数硬写）：${JSON.stringify(proposals)}`,
        `根据本轮实际要发生的直接交流，决定 ${range.minGroups}～${range.maxGroups} 条不同的互动关系（是允许范围，不是预定数量）。整轮去重后共 ${range.minPeople}～${range.maxPeople} 位演员。${actors.length === 1 ? '候选仅一人，可记单人独立出场。' : '每条互动关系至少两人；不把单人独处算作互动分组。'}同一角色可跨任意多组，例如 [A,B] [A,C] [A,D] 代表 A 分别与 B、C、D 交流，不是三支小队。用户执笔的身份不进入名单。`,
        '以直接参与的交流单元判定分组：A、B 对话，C 同场旁听，记 [A,B]；A、B 交流后 B 转向 C 交流，记 [A,B] [B,C]；A、B 和 C、D 分别交流，记 [A,B] [C,D]；A、B、C、D 围绕同一件事共同讨论、每个人都直接接话或回应，记一个 [A,B,C,D]。共同在场、氛围一致、话题相同，都不自动构成一个组；多人组也无需拆成每一对组合。',
        '回复顺序：先独立输出 <turn_cast>角色 ID 的 JSON 二维数组</turn_cast>；然后从原预设起始文本开始完整输出剧情正文；全部剧情区块结束后，最后输出 <private_axes>人物私轴 JSON</private_axes>。出演名单不得嵌入 <scene_header>、<story_text> 等原预设标签。',
        STORY_PRIVATE_AXES_RULE,
        STORY_CAST_ACTION_RULE,
        prefill ? `出演名单关闭后，正文沿用预设起始文本：\n${prefill}` : '',
    ].filter(Boolean).join('\n');
}

export const STORY_CAST_ACTION_RULE = '分组记录本轮实际的直接交流结构，不按地点、场景、气氛或话题划分。两人对话是一个组；交流对象转移后可以形成重叠的另一个组；几人围绕同一件事展开同一段共同讨论，直接接话、回应或对彼此行动作出有针对性的反应，就是一个多人组。多人组每个人都必须实际参与这段共同交流，但无需与每位组员逐一单独对话。只有在同一个地方、听见同一话题、远远观察或各做各事，不算组内互动；未参与交流的旁观者无需因在场而被塞进组。演员可跨多组，顺序交流或同时交流都可以；分组数量依本轮真实互动变化，避免固定搭档、固定三组和凑数。候选只有一位演员时，允许单人组记录独立出场。未列入名单的背景人物可以自然出现和参与剧情，且不需要生成私轴或角色记忆镜像；但背景人物不能代替名单角色之间已预选的直接交流。';
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
export function parseStoryCastReply(text: string, candidateIds: readonly string[], limits: StoryCastLimits, fixedCast?: string[][]): { groups: string[][]; axes: StoryPrivateAxes; body: string } {
    void limits;
    const response = unwrapProtocolBlock(unwrapFence(String(text || '').replace(/^\uFEFF/, '')));
    const allowed = new Set(candidateIds);
    const castMatches = [...response.matchAll(/<turn_cast\b[^>]*>([\s\S]*?)<\/turn_cast\s*>/gi)];
    let groups = fixedCast ? sanitizeStoryCastGroups(fixedCast, allowed) : [];
    if (!fixedCast) for (const match of castMatches) {
        try { groups = sanitizeStoryCastGroups(JSON.parse(unwrapFence(match[1])), allowed); if (groups.length) break; } catch { /* 保留正文，继续尝试其他来源。 */ }
    }
    const legacy = !groups.length && !fixedCast ? readLegacySceneHeaderGroups(response, allowed) : undefined;
    if (legacy) groups = legacy.groups;
    const axes: StoryPrivateAxes = {};
    if (groups.length) for (const match of response.matchAll(/<private_axes\b[^>]*>([\s\S]*?)<\/private_axes\s*>/gi)) {
        try {
            const raw = JSON.parse(unwrapFence(match[1])) as unknown;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            for (const id of storyCastIds(groups)) { const axis = readAxis((raw as Record<string, unknown>)[id]); if (axis && !axes[id]) axes[id] = axis; }
        } catch { /* 私轴为可选数据。 */ }
    }
    let body = response;
    for (const match of castMatches) body = body.replace(match[0], '');
    for (const match of response.matchAll(/<private_axes\b[^>]*>[\s\S]*?<\/private_axes\s*>/gi)) body = body.replace(match[0], '');
    if (legacy) body = body.replace(legacy.fragment, '');
    // 输出在末尾私轴处截断时，仍保留已经完成的剧情正文。
    body = body.replace(/<private_axes\b[^>]*>[\s\S]*$/i, '').trim();
    return { groups, axes, body };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text) || outOfStoryTag.test(text) || axesTag.test(text)) throw new Error('本轮只需返回正文。原记录已保留。');
    return text;
}
