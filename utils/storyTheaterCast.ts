import type { Message, StoryCastLimits } from '../types';

export function normalizeStoryCastLimits(value?: Partial<StoryCastLimits>, poolSize = Number.MAX_SAFE_INTEGER): StoryCastLimits {
    return {
        minGroups: value?.minGroups ?? 1,
        maxGroups: value?.maxGroups ?? Math.max(1, Math.min(12, maximumTendencyGroups(poolSize))),
        minPeople: value?.minPeople ?? (poolSize > 1 ? 2 : 1),
        maxPeople: value?.maxPeople ?? Math.max(1, poolSize),
    };
}

export function validStoryCastLimits(limits: StoryCastLimits): boolean {
    const { minGroups, maxGroups, minPeople, maxPeople } = limits;
    return [minGroups, maxGroups, minPeople, maxPeople].every(value => Number.isSafeInteger(value) && value > 0)
        && minGroups <= maxGroups && minPeople <= maxPeople;
}

function maximumInteractionGroups(size: number): number {
    if (size < 1) return 0;
    return size > 52 ? Number.MAX_SAFE_INTEGER : 2 ** size - 1;
}

function effectiveStoryCastLimits(poolSize: number, limits: StoryCastLimits): StoryCastLimits | undefined {
    if (!validStoryCastLimits(limits) || poolSize < 1) return undefined;
    const maxPeople = Math.min(poolSize, limits.maxPeople);
    let minPeople = Math.max(limits.minPeople, 1);
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

export interface StoryInteractionHistoryEntry {
    castIds: string[];
    tendencies: string[][];
    actual: string[][];
    /** 旧版只有预选分组，作为较弱的模型搭档惯性信号，不计作已发生互动。 */
    legacyTendencies?: string[][];
}

export interface StoryInteractionPlan {
    castIds: string[];
    tendencies: string[][];
}

const uniqueIds = (value: unknown): string[] => Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
    : [];

const cleanInteractionGroups = (value: unknown, allowed: ReadonlySet<string>, minimumSize = 1): string[][] => {
    if (!Array.isArray(value)) return [];
    const groups: string[][] = [];
    const seen = new Set<string>();
    for (const item of value) {
        if (!Array.isArray(item)) continue;
        const group = [...new Set(item.filter((id): id is string => typeof id === 'string' && allowed.has(id)))];
        if (group.length < minimumSize) continue;
        const key = groupKey(group);
        if (!seen.has(key)) { seen.add(key); groups.push(group); }
    }
    return groups;
};

/** 新版直接保存出演名单；旧消息从旧分组或记忆镜像中恢复。 */
export const storyCastIdsFromMessage = (message?: Message): string[] => {
    const stored = uniqueIds(message?.metadata?.theaterCastIds);
    if (stored.length) return stored;
    const legacy = storyCastFromMessage(message);
    if (legacy?.length) return storyCastIds(legacy);
    return uniqueIds(Object.keys((message?.metadata?.theaterMirrorIds || {}) as Record<string, unknown>));
};

export const storyInteractionTendenciesFromMessage = (message?: Message): string[][] => {
    const castIds = storyCastIdsFromMessage(message);
    const allowed = new Set(castIds);
    const stored = message?.metadata?.theaterInteractionTendencies;
    if (Array.isArray(stored)) return cleanInteractionGroups(stored, allowed);
    // 旧消息中的分组用于重写时还原原计划，不计作已发生的实际互动。
    return cleanInteractionGroups(storyCastFromMessage(message), allowed);
};

export const storyActualInteractionGroupsFromMessage = (message?: Message): string[][] => {
    const castIds = storyCastIdsFromMessage(message);
    const candidateIds = uniqueIds(message?.metadata?.theaterCandidateIds);
    return cleanInteractionGroups(message?.metadata?.theaterInteractionGroups, new Set(candidateIds.length ? candidateIds : castIds), 2);
};

export const storyInteractionHistoryFromMessage = (message?: Message): StoryInteractionHistoryEntry | undefined => {
    if (!message || message.role !== 'assistant') return undefined;
    const castIds = storyCastIdsFromMessage(message);
    if (!castIds.length) return undefined;
    const allowed = new Set(castIds);
    const hasActualInteractionField = Array.isArray(message.metadata?.theaterInteractionGroups);
    return {
        castIds,
        tendencies: cleanInteractionGroups(message.metadata?.theaterInteractionTendencies, allowed),
        actual: storyActualInteractionGroupsFromMessage(message),
        legacyTendencies: hasActualInteractionField ? [] : cleanInteractionGroups(storyCastFromMessage(message), allowed, 2),
    };
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

        const options: string[][] = [];
        const optionKeys = new Set<string>();
        const addOption = (members: string[]) => {
            if (!members.length) return;
            const key = groupKey(members);
            if (optionKeys.has(key)) return;
            optionKeys.add(key);
            options.push(members);
        };
        if (size <= 8) {
            for (let mask = 1; mask < (1 << size); mask++) {
                addOption(selected.filter((_id, index) => (mask & (1 << index)) !== 0));
            }
        } else {
            for (const id of selected) addOption([id]);
            for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) addOption([selected[i], selected[j]]);
            addOption(selected);
            const targetCount = Math.min(range.maxGroups, maximumInteractionGroups(size));
            let attempts = 0;
            while (options.length < targetCount && attempts < targetCount * 30) {
                attempts++;
                const groupSize = pick(1, size);
                const sampled = selected.map(id => ({ id, rank: random() }))
                    .sort((a, b) => a.rank - b.rank).slice(0, groupSize).map(item => item.id);
                addOption(sampled);
            }
        }
        const used = new Set<string>(), uncovered = new Set(selected), proposed: string[][] = [];
        const hub = selected[pick(0, size - 1)];
        const hubBonus = random() < 0.6 ? 2.2 : 0.2;
        // A larger group is a valid single discussion, not an accidental overflow of pairs.
        const preferredSize = count === 1 ? size : size > 2 && random() < 0.35
            ? pick(3, size)
            : random() < 0.2 ? 1 : 2;
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
        // Ensure every selected actor appears in at least one group.
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

type StoryPair = readonly [string, string];
const pairKey = (a: string, b: string) => JSON.stringify(a < b ? [a, b] : [b, a]);
const groupPairs = (group: readonly string[]): StoryPair[] => {
    const pairs: StoryPair[] = [];
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
        if (group[i] !== group[j]) pairs.push([group[i], group[j]]);
    }
    return pairs;
};

function maximumTendencyGroups(size: number): number {
    if (size < 1) return 0;
    if (size === 1) return 1;
    if (size <= 10) return 2 ** size - size - 1;
    const choose2 = size * (size - 1) / 2;
    const choose3 = size * (size - 1) * (size - 2) / 6;
    const choose4 = size * (size - 1) * (size - 2) * (size - 3) / 24;
    return choose2 + choose3 + choose4;
}

function effectiveInteractionLimits(poolSize: number, limits: StoryCastLimits): StoryCastLimits | undefined {
    if (!validStoryCastLimits(limits) || poolSize < 1) return undefined;
    const maxPeople = Math.min(poolSize, limits.maxPeople);
    let minPeople = Math.max(1, limits.minPeople);
    while (minPeople <= maxPeople && maximumTendencyGroups(minPeople) < limits.minGroups) minPeople++;
    if (minPeople > maxPeople) return undefined;
    const maxGroups = Math.min(limits.maxGroups, maximumTendencyGroups(maxPeople));
    if (limits.minGroups > maxGroups) return undefined;
    return { ...limits, minPeople, maxPeople, maxGroups };
}

export function canDrawStoryInteractionPlan(poolSize: number, limits: StoryCastLimits): boolean {
    return !!effectiveInteractionLimits(poolSize, limits);
}

function combinations<T>(items: readonly T[], size: number): T[][] {
    const result: T[][] = [];
    const visit = (start: number, picked: T[]) => {
        if (picked.length === size) { result.push([...picked]); return; }
        for (let i = start; i <= items.length - (size - picked.length); i++) {
            picked.push(items[i]); visit(i + 1, picked); picked.pop();
        }
    };
    visit(0, []);
    return result;
}

function weightedChoice<T>(items: readonly T[], weightOf: (item: T) => number, random: () => number): T | undefined {
    if (!items.length) return undefined;
    const weights = items.map(item => Math.max(0.0001, weightOf(item)));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let target = Math.min(0.999999999, Math.max(0, random())) * total;
    for (let i = 0; i < items.length; i++) {
        target -= weights[i];
        if (target < 0) return items[i];
    }
    return items[items.length - 1];
}

export function collectUnrealizedStoryTendencies(history: readonly StoryInteractionHistoryEntry[], limit = 8): string[][] {
    const recent = history.slice(-8);
    const latestActual = new Map<string, number>();
    const missedEvents = new Map<string, { pair: string[]; index: number; score: number }[]>();
    recent.forEach((turn, index) => {
        const decay = (index + 1) / Math.max(1, recent.length);
        const actual = new Set(turn.actual.flatMap(groupPairs).map(([a, b]) => pairKey(a, b)));
        for (const key of actual) latestActual.set(key, index);
        for (const [a, b] of turn.tendencies.flatMap(groupPairs)) {
            const key = pairKey(a, b);
            if (actual.has(key)) continue;
            const events = missedEvents.get(key) ?? [];
            events.push({ pair: [a, b], index, score: decay });
            missedEvents.set(key, events);
        }
    });
    return [...missedEvents.entries()]
        .map(([key, events]) => ({
            pair: events[events.length - 1].pair,
            score: events.filter(event => event.index > (latestActual.get(key) ?? -1)).reduce((sum, event) => sum + event.score, 0),
        }))
        .filter(item => item.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(0, limit))
        .map(item => item.pair);
}

/**
 * Select the cast and then schedule attention tendencies. Actual exchanges lower a pair's
 * future weight; tendencies that were not realized receive a temporary exploration boost.
 */
export function drawStoryInteractionPlan(
    ids: readonly string[],
    limits: StoryCastLimits,
    history: readonly StoryInteractionHistoryEntry[],
    random = Math.random,
): StoryInteractionPlan {
    const candidates = [...new Set(ids)];
    const range = effectiveInteractionLimits(candidates.length, limits);
    if (!range) return { castIds: [], tendencies: [] };
    const appearances = new Map<string, number>();
    const actualPairs = new Map<string, number>();
    const legacyPairs = new Map<string, number>();
    const missedPairs = new Map<string, number>();
    const latestActual = new Map<string, number>();
    const latestMissed = new Map<string, number>();
    history.slice(-8).forEach((turn, index, recent) => {
        const decay = (index + 1) / Math.max(1, recent.length);
        for (const id of turn.castIds) appearances.set(id, (appearances.get(id) ?? 0) + decay);
        const actual = new Set(turn.actual.flatMap(groupPairs).map(([a, b]) => pairKey(a, b)));
        for (const key of actual) {
            actualPairs.set(key, (actualPairs.get(key) ?? 0) + decay);
            latestActual.set(key, index);
        }
        for (const [a, b] of (turn.legacyTendencies ?? []).flatMap(groupPairs)) {
            const key = pairKey(a, b);
            legacyPairs.set(key, (legacyPairs.get(key) ?? 0) + decay);
        }
        for (const [a, b] of turn.tendencies.flatMap(groupPairs)) {
            const key = pairKey(a, b);
            if (!actual.has(key)) {
                missedPairs.set(key, (missedPairs.get(key) ?? 0) + decay);
                latestMissed.set(key, index);
            }
        }
    });

    const pickInt = (min: number, max: number) => min + Math.floor(Math.min(0.999999999, Math.max(0, random())) * (max - min + 1));
    const size = pickInt(range.minPeople, range.maxPeople);
    const castIds = candidates.map(id => {
        const weight = 1 / (1 + (appearances.get(id) ?? 0) * 0.75);
        const rank = -Math.log(Math.max(1e-12, random())) / weight;
        return { id, rank };
    }).sort((a, b) => a.rank - b.rank).slice(0, size).map(item => item.id);

    if (castIds.length === 1) return { castIds, tendencies: [[castIds[0]]] };
    const options: string[][] = [];
    const maxGroupSize = castIds.length <= 10 ? castIds.length : 4;
    for (let groupSize = 2; groupSize <= maxGroupSize; groupSize++) {
        options.push(...combinations(castIds, groupSize));
    }
    const maxGroups = Math.min(range.maxGroups, options.length);
    const groupCount = pickInt(range.minGroups, Math.min(maxGroups, options.length));
    const pairWeight = (a: string, b: string) => {
        const key = pairKey(a, b);
        const actual = actualPairs.get(key) ?? 0;
        const legacy = legacyPairs.get(key) ?? 0;
        const lastMissed = latestMissed.get(key) ?? -1;
        const lastActual = latestActual.get(key) ?? -1;
        const missed = lastMissed > lastActual ? missedPairs.get(key) ?? 0 : 0;
        return Math.max(0.12, (1 + Math.min(3, missed) * 0.9) / (1 + actual * 0.9 + legacy * 0.3));
    };
    const selected: string[][] = [];
    const remaining = [...options];
    for (let index = 0; index < groupCount; index++) {
        const next = weightedChoice(remaining, group => {
            const pairs = groupPairs(group);
            const average = pairs.reduce((sum, [a, b]) => sum + pairWeight(a, b), 0) / Math.max(1, pairs.length);
            const sizeBias = group.length === 2 ? 1 : 0.38 ** (group.length - 2);
            return average * sizeBias;
        }, random);
        if (!next) break;
        selected.push(next);
        const key = groupKey(next);
        const at = remaining.findIndex(group => groupKey(group) === key);
        if (at >= 0) remaining.splice(at, 1);
    }
    return { castIds, tendencies: selected };
}

export function buildStoryTheaterPromptValues(input: {
    actors: readonly { id: string; name: string }[];
    candidateActors?: readonly { id: string; name: string }[];
    limits: StoryCastLimits;
    proposals: string[][];
    fixedCast?: string[][];
    previousAxes?: Readonly<Record<string, string>>;
    previousInteractions?: readonly StoryInteractionHistoryEntry[];
    unrealizedTendencies?: string[][];
    prefill?: string;
    modeState: string;
}): Record<string, string> {
    const nameById = new Map<string, string>([...(input.candidateActors ?? []), ...input.actors].map(actor => [actor.id, actor.name] as const));
    const namedGroups = (groups: readonly string[][]) => groups.map(group => group.map(id => ({ id, name: nameById.get(id) ?? id })));
    const castData = JSON.stringify(input.actors.map(({ id, name }) => ({ id, name })));
    const candidateData = JSON.stringify((input.candidateActors ?? input.actors).map(({ id, name }) => ({ id, name })));
    const previous = (input.previousInteractions ?? []).slice(-6).map(turn => ({
        cast: turn.castIds.map(id => ({ id, name: nameById.get(id) ?? id })),
        actual: namedGroups(turn.actual),
    }));
    return {
        theater_mode_state: input.modeState,
        theater_cast_data: castData,
        theater_candidate_data: candidateData,
        theater_interaction_tendencies: JSON.stringify(namedGroups(input.proposals)),
        theater_previous_interactions: JSON.stringify(previous),
        theater_unrealized_tendencies: JSON.stringify(namedGroups(input.unrealizedTendencies ?? [])),
        theater_previous_axes: input.previousAxes && Object.keys(input.previousAxes).length ? JSON.stringify(input.previousAxes) : '',
        theater_prefill: input.prefill?.trim() || '',
    };
}

const castTag = /<\/?turn_cast\b/i;
const outOfStoryTag = /<\/?out_of_story\b/i;
const axesTag = /<\/?private_axes\b/i;
const interactionResultTag = /<\/?interaction_result\b/i;
const unwrapFence = (text: string) => /^\s*```(?:json|xml|html|text)?[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(text)?.[1].trim() ?? text.trim();
const unwrapProtocolBlock = (text: string) => text.replace(
    /^```(?:xml|html|text)?[ \t]*\r?\n\s*(<(?:turn_cast|interaction_result|private_axes)>[\s\S]*?<\/(?:turn_cast|interaction_result|private_axes)\s*>)\s*\r?\n```[ \t]*(?:\r?\n|$)/i,
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
    return Object.fromEntries(storyCastIdsFromMessage(reply).flatMap(id => {
        const axis = readAxis(axes?.[id]);
        return axis ? [[id, axis]] : [];
    }));
}

export function parseOutOfStoryReply(text: string): string | undefined {
    if (!outOfStoryTag.test(text)) return undefined;
    const body = /^<out_of_story>([\s\S]*?)<\/out_of_story\s*>$/i.exec(unwrapFence(text))?.[1].trim();
    if (!body || outOfStoryTag.test(body) || castTag.test(body) || axesTag.test(body) || interactionResultTag.test(body)) throw new Error('场外回复格式无效，请重试。');
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

export function parseStoryTheaterReply(text: string, candidateIds: readonly string[], axisIds: readonly string[] = candidateIds): {
    interactions: string[][];
    axes: StoryPrivateAxes;
    body: string;
} {
    const response = unwrapProtocolBlock(unwrapFence(String(text || '').replace(/^\uFEFF/, '')));
    const allowed = new Set(candidateIds);
    const interactions: string[][] = [];
    const seen = new Set<string>();
    for (const match of response.matchAll(/<interaction_result\b[^>]*>([\s\S]*?)<\/interaction_result\s*>/gi)) {
        try {
            const groups = cleanInteractionGroups(JSON.parse(unwrapFence(match[1])), allowed, 2);
            for (const group of groups) {
                const key = groupKey(group);
                if (!seen.has(key)) { seen.add(key); interactions.push(group); }
            }
        } catch { /* 互动记录无效时不影响正文与私轴。 */ }
    }
    const axes: StoryPrivateAxes = {};
    for (const match of response.matchAll(/<private_axes\b[^>]*>([\s\S]*?)<\/private_axes\s*>/gi)) {
        try {
            const raw = JSON.parse(unwrapFence(match[1])) as unknown;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
            for (const id of axisIds) {
                const axis = readAxis((raw as Record<string, unknown>)[id]);
                if (axis && !axes[id]) axes[id] = axis;
            }
        } catch { /* 私轴为可选数据。 */ }
    }
    let body = response
        .replace(/<turn_cast\b[^>]*>[\s\S]*?<\/turn_cast\s*>/gi, '')
        .replace(/<interaction_result\b[^>]*>[\s\S]*?<\/interaction_result\s*>/gi, '')
        .replace(/<private_axes\b[^>]*>[\s\S]*?<\/private_axes\s*>/gi, '')
        .replace(/<private_axes\b[^>]*>[\s\S]*$/i, '')
        .trim();
    return { interactions, axes, body };
}

export function assertStoryRerollBody(text: string): string {
    if (castTag.test(text) || outOfStoryTag.test(text) || axesTag.test(text) || interactionResultTag.test(text)) throw new Error('本轮只需返回正文。原记录已保留。');
    return text;
}
