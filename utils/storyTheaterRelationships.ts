import type { Message, StoryTheaterPresetDocument } from '../types';

export const STORY_RELATIONSHIP_PROMPT_ID = 'nmj-v65-affinity-control';
export const STORY_RELATIONSHIP_AXES = ['FL', 'RI', 'DI'] as const;
export const STORY_RELATIONSHIP_LABELS = { FL: '关系联结', RI: '恋爱性心动', DI: '失序扰动' };

type Axis = typeof STORY_RELATIONSHIP_AXES[number];
type Strength = 'mild' | 'moderate' | 'strong';

interface Actor {
    id: string;
    name: string;
}

interface AxisValue {
    score: number;
    /** Parser-only: delta-only input must not become an invented first FL score. */
    hasScore?: boolean;
    delta?: number;
    trigger?: string;
    evidence?: string;
    strength?: Strength;
    phase?: 'active' | 'ended';
    /** v2 replay: first assessment vs a delta from an existing score. */
    initial?: boolean;
    /** Input before clamping/DI decay; delta remains the displayed net change. */
    eventDelta?: number;
}

interface Relationship {
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    axes: Partial<Record<Axis, AxisValue>>;
    relation_note?: string;
    relation_fragments?: string[];
}

export interface StoryRelationshipPanel {
    primaryId: string;
    primaryName: string;
    state_note?: string;
    relationships: Relationship[];
    historyVersion?: 2;
    state_notes?: Record<string, { name: string; note: string }>;
    actors?: Actor[];
}

export const LEGACY_CENTERED_STORY_RELATIONSHIP_PROMPT = "主要角色由剧场设置中的角色 ID 确定，与用户执笔身份分别处理。主要角色在场时，分别记录其与其他出演角色的两个方向。\nFL 关系联结：信任、默契、熟悉、共同经历。首次记录依据双方各自的角色卡、既有关系和共同经历确定初值。后续依据陪伴、理解、合作、失信、排斥等具体相处事实缓慢变化。\nRI 恋爱性心动：由明确的恋爱性吸引触发，如恋爱性的注意、回味、渴望、亲密倾向。辨别竞争性占有与恋爱性亲密排他。时间和距离本身不扣分，有具体的心动消退、反感或排斥才更新。\nDI 失序扰动：具体事件让情绪、注意力或行动节奏偏移，如冒犯、挑衅、胜负、尴尬、惊讶或社交压力。普通好奇不计入。事件仍造成扰动时记 active，结束当轮记 ended；没有扰动事件则省略 phase 和 strength，由程序回落。\n结合双方各自的人格七维、认知和亲历事实判断吸引来源是否影响注意和具体轴：\n身体/审美（外貌、声音、气味、体态、触碰与距离）；能力/人格（才华、专注、判断力、价值观与底线）；被看见/安全（理解、记住细节、接住情绪、尊重边界与可靠）；\n互惠偏爱（被选择、主动、好感暗示与熟悉曝光）；情绪/经历（快乐、日常陪伴、共患难、遗憾与未完成）；反差/未知/社会（神秘、探索、他人认可、竞争与投射）；成长激励（想成为更好的自己、想配得上或并肩）。\n从每个方向的出发人物独立判断。人物只拥有自己能够知道的故事内事实。面板供读者回看。三轴各为 0–100，分别更新，同一事件影响多轴时逐轴写触发事件与证据。\n沿用主要角色自身的 state_note，记录其内在拉扯、选择代价或已形成的新理解。只在有新事实时更新。各方向可用 relation_note 记录当前的关系质地。";

export const STORY_RELATIONSHIP_PROMPT = [
    '按本轮正文实际发生关系事件的双方角色 ID 记录，每对分别判断两个方向；任意两位角色都可以更新，不设主要角色中心。只同场、旁观、被提及或出现在非正篇小剧场不构成关系事件。',
    'FL 关系联结：信任、默契、熟悉、共同经历。首次记录依据双方各自的角色卡、既有关系和共同经历确定初值。后续依据陪伴、理解、合作、失信、排斥等具体相处事实缓慢变化。',
    'RI 恋爱性心动：由明确的恋爱性吸引触发，如恋爱性的注意、回味、渴望、亲密倾向。辨别竞争性占有与恋爱性亲密排他。时间和距离本身不扣分，有具体的心动消退、反感或排斥才更新。',
    'DI 失序扰动：具体事件让情绪、注意力或行动节奏偏移，如冒犯、挑衅、胜负、尴尬、惊讶或社交压力。普通好奇不计入。事件仍造成扰动时记 active，结束当轮记 ended；没有扰动事件则省略 phase 和 strength，由程序回落。',
    '结合双方各自的人格七维、认知和亲历事实判断吸引来源是否影响注意和具体轴：',
    '身体/审美（外貌、声音、气味、体态、触碰与距离）；能力/人格（才华、专注、判断力、价值观与底线）；被看见/安全（理解、记住细节、接住情绪、尊重边界与可靠）；',
    '互惠偏爱（被选择、主动、好感暗示与熟悉曝光）；情绪/经历（快乐、日常陪伴、共患难、遗憾与未完成）；反差/未知/社会（神秘、探索、他人认可、竞争与投射）；成长激励（想成为更好的自己、想配得上或并肩）。',
    '从每个方向的出发人物独立判断。人物只拥有自己能够知道的故事内事实。面板供读者回看。三轴各为 0–100，分别更新，同一事件影响多轴时逐轴写触发事件与证据。',
    '只更新有新关系事实的人物对，其他人的 FL、RI、DI 保持历史；本轮被记录的人物对中，RI/DI 继续按上述规则计算。两个方向各自给证据，不能照抄分数；缺少另一方向的事实时保留其历史。',
    '自我记录用 <self_record><character_id>角色 ID</character_id><state_note>新理解、内在拉扯或选择代价</state_note></self_record>，仅在该人物有新事实时填写。各方向可用 relation_note 记录当前的关系质地。',
].join('\n');

const panelPattern = /<relationship_panel\b[^>]*>([\s\S]*?)<\/relationship_panel\s*>/gi;

const legacyPanelPattern = /<affinity_panel\b[^>]*>([\s\S]*?)<\/affinity_panel\s*>/gi;
const legacyPersonPattern = /<affinity_person\b[^>]*>([\s\S]*?)<\/affinity_person\s*>/gi;
const axesPanelPattern = /<affinity_panel\b[^>]*\bmode\s*=\s*["']three_axes["'][^>]*>([\s\S]*?)<\/affinity_panel\s*>/gi;
export const isStoryThreeAxisPanel = (opening: string) => /\bmode\s*=\s*["']three_axes["']/i.test(opening);

const shortText = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 400) : '';
const integer = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
const clamp = (score: number) => Math.max(0, Math.min(100, score));
const pairKey = (fromId: string, toId: string) => JSON.stringify([fromId, toId]);

const encodePanel = (value: unknown) => JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unxml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rawFields = (source: string, tag: string) =>
    [...source.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'))]
        .map(match => match[1].trim());
const fields = (source: string, tag: string) => rawFields(source, tag).map(unxml);
const field = (source: string, tag: string) => fields(source, tag)[0] || '';
const fieldInt = (source: string, tag: string) => {
    const value = field(source, tag);
    return /^[+-]?\d+$/.test(value) ? integer(Number(value)) : undefined;
};
const tag = (key: string, value: string | number | undefined) =>
    value === undefined || value === '' ? '' : '<' + key + '>' + xml(String(value)) + '</' + key + '>';
const strengthOf = (value: unknown): Strength | undefined =>
    value === 'mild' || value === 'moderate' || value === 'strong' ? value : undefined;

function readThreeAxisPanel(body: string): StoryRelationshipPanel | undefined {
    const primaryId = field(body, 'primary_id');
    const state_notes: NonNullable<StoryRelationshipPanel['state_notes']> = {};
    for (const record of rawFields(body, 'self_record')) {
        const id = field(record, 'character_id'), note = shortText(field(record, 'state_note'));
        if (id && note) state_notes[id] = { name: field(record, 'character_name') || id, note };
    }
    const relationships = [...body.matchAll(legacyPersonPattern)].flatMap(([, person]): Relationship[] => {
        const fromId = field(person, 'from_id');
        const toId = field(person, 'to_id');
        if (!fromId || !toId || fromId === toId) return [];
        const axes: Relationship['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const source = rawFields(person, axis)[0] || '';
            const score = fieldInt(source, 'score');
            const delta = fieldInt(source, 'delta');
            if (score === undefined && delta === undefined) continue;
            const phase = field(source, 'phase');
            axes[axis] = {
                score: clamp(score ?? 0), delta,
                hasScore: score !== undefined,
                trigger: shortText(field(source, 'trigger')), evidence: shortText(field(source, 'evidence')),
                strength: strengthOf(field(source, 'strength')), phase: phase === 'active' || phase === 'ended' ? phase : undefined,
                initial: field(source, 'initial') === 'true' ? true : field(source, 'initial') === 'false' ? false : undefined,
                eventDelta: fieldInt(source, 'event_delta'),
            };
        }
        return [{
            fromId, toId, fromName: field(person, 'from_name') || fromId, toName: field(person, 'to_name') || toId,
            axes, relation_note: shortText(field(person, 'relation_note')),
            relation_fragments: fields(person, 'relation_fragment').map(shortText).filter(Boolean).slice(0, 3),
        }];
    });
    const primaryNote = body.replace(legacyPersonPattern, '').replace(/<self_record\b[^>]*>[\s\S]*?<\/self_record\s*>/gi, '');
    return { primaryId, primaryName: field(body, 'primary_name') || primaryId, state_note: shortText(field(primaryNote, 'state_note')),
        state_notes, historyVersion: field(body, 'history_version') === '2' ? 2 : undefined, relationships };
}

export function serializeStoryThreeAxisPanel(panel: StoryRelationshipPanel): string {
    return [
        '<affinity_panel mode="three_axes">', tag('primary_id', panel.primaryId), tag('primary_name', panel.primaryName),
        tag('history_version', panel.historyVersion),
        tag('state_note', panel.state_note),
        ...Object.entries(panel.state_notes ?? {}).map(([id, value]) => '<self_record>' + tag('character_id', id)
            + tag('character_name', value.name) + tag('state_note', value.note) + '</self_record>'),
        ...panel.relationships.flatMap(row => [
            '<affinity_person>', tag('from_id', row.fromId), tag('to_id', row.toId), tag('from_name', row.fromName), tag('to_name', row.toName),
            ...STORY_RELATIONSHIP_AXES.flatMap(axis => {
                const value = row.axes[axis];
                if (!value) return [];
                return ['<' + axis + '>' + tag('score', value.score) + tag('delta', value.delta)
                    + tag('trigger', value.trigger) + tag('evidence', value.evidence)
                    + tag('strength', value.strength) + tag('phase', value.phase)
                    + tag('initial', value.initial === undefined ? undefined : String(value.initial))
                    + tag('event_delta', value.eventDelta) + '</' + axis + '>'];
            }),
            tag('relation_note', row.relation_note), ...(row.relation_fragments ?? []).map(value => tag('relation_fragment', value)),
            '</affinity_person>',
        ]),
        '</affinity_panel>',
    ].filter(Boolean).join('\n');
}

function readPanel(body: string): StoryRelationshipPanel | undefined {
    let value;
    try {
        value = JSON.parse(body.trim().replace(/^(?:~~~|\x60{3})(?:json)?\s*|\s*(?:~~~|\x60{3})$/gi, ''));
    } catch {
        return undefined;
    }
    if (!value || !Array.isArray(value.relationships)) return undefined;
    value.primaryId = typeof value.primaryId === 'string' ? value.primaryId : '';
    return value;
}

export function parseStoryRelationshipPanel(body: string, format: 'xml' | 'json' = 'json'): StoryRelationshipPanel | undefined {
    if (format === 'xml') return readThreeAxisPanel(body);
    const value = readPanel(body);
    if (!value) return undefined;
    return {
        primaryId: value.primaryId,
        primaryName: shortText(value.primaryName),
        state_note: shortText(value.state_note),
        historyVersion: value.historyVersion === 2 ? 2 : undefined,
        state_notes: value.state_notes && typeof value.state_notes === 'object' ? Object.fromEntries(
            Object.entries(value.state_notes).flatMap(([id, item]) => typeof (item as any)?.note === 'string'
                ? [[id, { name: shortText((item as any).name) || id, note: shortText((item as any).note) }]] : []),
        ) : {},
        relationships: value.relationships.flatMap(row => {
            if (typeof row?.fromId !== 'string' || typeof row?.toId !== 'string'
                || !row.fromId || !row.toId || row.fromId === row.toId) return [];
            const axes: Relationship['axes'] = {};
            for (const axis of STORY_RELATIONSHIP_AXES) {
                const item = row.axes?.[axis];
                const score = integer(item?.score);
                const delta = integer(item?.delta);
                if (!item || (score === undefined && delta === undefined)) continue;
                const strength = item.strength;
                axes[axis] = {
                    score: clamp(score ?? 0),
                    hasScore: score !== undefined,
                    delta,
                    trigger: shortText(item.trigger),
                    evidence: shortText(item.evidence),
                    ...(strength === 'mild' || strength === 'moderate' || strength === 'strong' ? { strength } : {}),
                    phase: item.phase === 'active' || item.phase === 'ended' ? item.phase : undefined,
                    initial: typeof item.initial === 'boolean' ? item.initial : undefined,
                    eventDelta: integer(item.eventDelta),
                };
            }
            return [{
                fromId: row.fromId, toId: row.toId,
                fromName: shortText(row.fromName) || row.fromId,
                toName: shortText(row.toName) || row.toId,
                axes, relation_note: shortText(row.relation_note),
                relation_fragments: Array.isArray(row.relation_fragments) ? row.relation_fragments.map(shortText).filter(Boolean).slice(0, 3) : undefined,
            }];
        }),
    };
}

function readLegacyStateNote(content: string, primary: Actor): string {
    for (const [, panel] of content.matchAll(legacyPanelPattern)) {
        for (const [, person] of panel.matchAll(legacyPersonPattern)) {
            const id = /<character_id>([^<]+)<\/character_id>/i.exec(person)?.[1]?.trim();
            if (id === primary.id) return shortText(field(person, 'state_note'));
        }
    }
    return '';
}

export function stripStoryRelationshipPanels(content: string): string {
    return content
        .replace(/<(relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(?:relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?(?=<(?:scene_header|story_text|backstage|worldline|shot_debts|mini_theater|reply_choices)\b|$)/gi, '')
        .trim();
}

const decayDI = (score: number, strength?: Strength) => {
    if (strength === 'strong') return Math.floor(score * 0.8);
    if (strength === 'moderate') return Math.floor(score * 0.7);
    return clamp(score - 5);
};

function readContentPanel(content: string): StoryRelationshipPanel | undefined {
    const panels = [...content.matchAll(axesPanelPattern)], old = [...content.matchAll(panelPattern)];
    const parsed = panels.length === 1 && old.length === 0 ? parseStoryRelationshipPanel(panels[0][1], 'xml')
        : panels.length === 0 && old.length === 1 ? parseStoryRelationshipPanel(old[0][1]) : undefined;
    if (!parsed) return;
    const counts = new Map<string, number>();
    for (const row of parsed.relationships) {
        const key = pairKey(row.fromId, row.toId);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { ...parsed, relationships: parsed.relationships.filter(row => counts.get(pairKey(row.fromId, row.toId)) === 1) };
}

/** Replay central originals in commit order. Callers select the world and reroll boundary first. */
export function getStoryRelationshipBaseline(messages: readonly Message[], actors: readonly Actor[]): StoryRelationshipPanel {
    const relationships = actors.flatMap(from => actors.filter(to => to.id !== from.id).map(to => ({
        fromId: from.id, toId: to.id, fromName: from.name, toName: to.name, axes: {},
    } as Relationship)));
    const byPair = new Map(relationships.map(row => [pairKey(row.fromId, row.toId), row]));
    const state_notes: NonNullable<StoryRelationshipPanel['state_notes']> = {};
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
        if (message.role !== 'assistant' || message.metadata?.theaterOutOfStory) continue;
        const panel = readContentPanel(message.content);
        const cast = Array.isArray(message.metadata?.theaterCastIds) ? new Set<string>(message.metadata.theaterCastIds) : undefined;
        const allowed = (id: string) => actors.some(actor => actor.id === id) && (!cast || cast.has(id));
        if (panel) {
            const notes = { ...panel.state_notes };
            if (panel.primaryId && panel.state_note) notes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
            for (const [id, value] of Object.entries(notes)) if (allowed(id)) {
                state_notes[id] = { name: actors.find(actor => actor.id === id)!.name, note: value.note };
            }
            for (const previous of panel.relationships) {
                const row = byPair.get(pairKey(previous.fromId, previous.toId));
                if (!row || !allowed(row.fromId) || !allowed(row.toId)) continue;
                if (previous.relation_note) row.relation_note = previous.relation_note;
                for (const axis of STORY_RELATIONSHIP_AXES) {
                    const item = previous.axes[axis];
                    if (!item) continue;
                    const prior = row.axes[axis];
                    // Legacy panels are snapshots, never guessed deltas or five-axis conversions.
                    if (panel.historyVersion !== 2 || item.initial === true) row.axes[axis] = { score: item.score, strength: item.strength };
                    else if (prior) {
                        const next = axis === 'DI' ? reconcileAxis(axis, prior, { ...item, delta: item.eventDelta })
                            : { score: clamp(prior.score + (item.trigger && item.evidence ? item.eventDelta ?? item.delta ?? 0 : 0)), strength: item.strength };
                        if (next) row.axes[axis] = { score: next.score, strength: next.strength };
                    }
                    // If its initial assessment was deleted, a later delta cannot invent a new baseline.
                }
            }
        } else {
            for (const actor of actors) {
                const note = readLegacyStateNote(message.content, actor);
                if (note && allowed(actor.id)) state_notes[actor.id] = { name: actor.name, note };
            }
        }
    }
    return { primaryId: '', primaryName: '', actors: actors.map(({ id, name }) => ({ id, name })), state_notes, relationships };
}

export function restrictStoryRelationshipsToCast(baseline: StoryRelationshipPanel | undefined, actors: ReadonlySet<string>): StoryRelationshipPanel | undefined {
    if (!baseline) return undefined;
    return { ...baseline, state_notes: Object.fromEntries(Object.entries(baseline.state_notes ?? {}).filter(([id]) => actors.has(id))),
        actors: baseline.actors?.filter(actor => actors.has(actor.id)),
        relationships: baseline.relationships.filter(row => actors.has(row.fromId) && actors.has(row.toId)) };
}

export function buildStoryRelationshipGuide(baseline?: StoryRelationshipPanel, useActualCast = false): string {
    if (!baseline) return '';
    const example = baseline.relationships[0];
    return [
        '剧情收尾使用一份三轴关系面板；场外省略。',
        useActualCast ? '人物对的双方均须列入 <turn_cast>。' : '人物对的双方均须实际出现在本轮正文中。',
        '按正文实际发生关系事件的人物对输出两个方向，不限任一中心人物；同场、旁观、被提及、交流倾向和非正篇小剧场均不算依据。不要为了面板安排事件，没有新事实的人物对省略并保留历史。',
        '沿用下方各方向基线：已有轴填 delta；首次填 score。FL 初值依据角色卡、既有关系和共同经历评估。trigger 写本次评分依据的关系事实或事件，evidence 写人物的具体表现；缺少依据填 0。DI 有扰动时写 phase（active / ended）和 strength（mild / moderate / strong）。',
        '格式：<affinity_panel mode="three_axes">',
        '<self_record><character_id>实际有新理解的人物 ID</character_id><state_note>新理解或选择代价（可选）</state_note></self_record>',
        ...(example ? ['<affinity_person><from_id>' + xml(example.fromId) + '</from_id><to_id>' + xml(example.toId) + '</to_id><FL><score>0</score><trigger>关系事实</trigger><evidence>人物具体表现</evidence></FL><RI><delta>0</delta></RI><DI><delta>0</delta></DI><relation_note>关系天气</relation_note><relation_fragment>本轮事实碎片（可选）</relation_fragment></affinity_person>'] : []),
        '</affinity_panel>',
        '方向基线：' + encodePanel(baseline),
    ].join('\n');
}

function reconcileAxis(axis: Axis, previous: AxisValue | undefined, proposed?: AxisValue): AxisValue | undefined {
    const score = integer(proposed?.score);
    if (!previous && score === undefined) return undefined;
    const prior = previous?.score ?? 0;
    const trigger = shortText(proposed?.trigger);
    const evidence = shortText(proposed?.evidence);
    const strength = proposed?.strength;
    const supported = Boolean(trigger && evidence);
    if (axis === 'FL' && !previous && (!supported || proposed?.hasScore === false)) return undefined;
    const change = previous ? integer(proposed?.delta) ?? 0 : score ?? 0;
    if (axis === 'DI') {
        const phase = proposed?.phase;
        if (supported && (phase === 'active' || phase === 'ended')
            && (strength === 'mild' || strength === 'moderate' || strength === 'strong')) {
            const peak = clamp(prior + change);
            const next = phase === 'active' ? peak : decayDI(peak, strength);
            return { score: next, delta: next - prior, trigger, evidence, strength, phase };
        }
        const next = decayDI(prior, previous?.strength);
        return {
            score: next, delta: next - prior, strength: previous?.strength,
            ...(next !== prior ? { trigger: '无持续扰动', evidence: '扰动回落' } : {}),
        };
    }
    const next = clamp(prior + (supported ? change : 0));
    return { score: next, delta: next - prior, ...(supported ? { trigger, evidence } : {}) };
}

/** Store a canonical panel with the reply, so reroll and archive use the same immutable turn boundary. */
export function reconcileStoryRelationships(content: string, baseline?: StoryRelationshipPanel): string {
    const parsed = readContentPanel(content);
    const prose = stripStoryRelationshipPanels(content);
    if (!baseline) return prose;
    const proposal = parsed;
    if (!proposal) return prose;
    const changes = new Map(proposal.relationships
        .filter(row => typeof row?.fromId === 'string' && typeof row.toId === 'string')
        .map(row => [pairKey(row.fromId, row.toId), row]));
    const relationships = baseline.relationships.flatMap(row => {
        const proposed = changes.get(pairKey(row.fromId, row.toId));
        if (!proposed || !STORY_RELATIONSHIP_AXES.some(axis => proposed.axes[axis]?.trigger && proposed.axes[axis]?.evidence)) return [];
        const axes: Relationship['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const value = reconcileAxis(axis, row.axes[axis], proposed?.axes?.[axis]);
            if (value) {
                const item = proposed.axes[axis];
                const supported = Boolean(item?.trigger && item?.evidence);
                axes[axis] = { ...value, initial: !row.axes[axis],
                    eventDelta: supported && (axis !== 'DI' || value.phase)
                        ? (row.axes[axis] ? item?.delta ?? 0 : item?.score ?? 0) : 0 };
            }
        }
        const relation_fragments = Array.isArray(proposed.relation_fragments)
            ? proposed.relation_fragments.map(shortText).filter(Boolean).slice(0, 3) : undefined;
        return [{ ...row, axes, relation_note: shortText(proposed.relation_note), relation_fragments }];
    }).filter(row => Object.keys(row.axes).length || row.relation_note || row.relation_fragments?.length);
    const allowed = new Map<string, string>();
    for (const actor of baseline.actors ?? []) allowed.set(actor.id, actor.name);
    for (const row of baseline.relationships) { allowed.set(row.fromId, row.fromName); allowed.set(row.toId, row.toName); }
    for (const [id, note] of Object.entries(baseline.state_notes ?? {})) allowed.set(id, note.name);
    const proposedNotes = { ...proposal.state_notes };
    if (proposal.primaryId && proposal.state_note) proposedNotes[proposal.primaryId] = { name: proposal.primaryName, note: proposal.state_note };
    const state_notes = Object.fromEntries(Object.entries(proposedNotes).filter(([id, value]) => allowed.has(id) && value.note)
        .map(([id, value]) => [id, { name: allowed.get(id)!, note: value.note }]));
    if (!Object.keys(state_notes).length && relationships.length === 0) return prose;
    return prose + '\n\n' + serializeStoryThreeAxisPanel({ primaryId: '', primaryName: '', historyVersion: 2, state_notes, relationships });
}

export function formatStoryRelationshipPanel(panel: StoryRelationshipPanel): string {
    return [
        panel.state_note ? panel.primaryName + ' · 自我记录：' + panel.state_note : '',
        ...Object.values(panel.state_notes ?? {}).map(value => value.name + ' · 自我记录：' + value.note),
        ...panel.relationships.map(row => [
            row.fromName + ' → ' + row.toName,
            ...STORY_RELATIONSHIP_AXES.flatMap(axis => {
                const value = row.axes[axis];
                if (!value) return [];
                const delta = value.delta ? ' (' + (value.delta > 0 ? '+' : '') + value.delta + ')' : '';
                const evidence = [value.trigger, value.evidence].filter(Boolean).join(' · ');
                return [axis + ' ' + STORY_RELATIONSHIP_LABELS[axis] + '：' + value.score + delta + (evidence ? ' · ' + evidence : '')];
            }),
            row.relation_note || '',
            ...(row.relation_fragments ?? []),
        ].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n\n');
}

export function getPreviousStoryRelationshipDocument(document: StoryTheaterPresetDocument): StoryTheaterPresetDocument {
    if (!document.prompts.some(prompt => prompt.id === STORY_RELATIONSHIP_PROMPT_ID)) return document;
    return {
        ...document,
        prompts: document.prompts
            .filter(prompt => !['nmj-v65-affinity-opaque', 'nmj-v65-affinity-transparent'].includes(prompt.id))
            .map(prompt => {
                if (prompt.id === STORY_RELATIONSHIP_PROMPT_ID) {
                    return { ...prompt, name: '💗双向关系｜FL · RI · DI', content: STORY_RELATIONSHIP_PROMPT };
                }
                let { name, content } = prompt;
                if (prompt.id === 'nmj-v65-section-affinity-start') name = '🧩↓双向关系｜FL · RI · DI';
                if (prompt.id === 'nmj-v65-section-affinity-end') name = '🧩↑双向关系｜结束';
                if (prompt.id === 'nmj-v616-silent-preflight') {
                    content = content
                        .replace(/；<u_affinity> 属于执笔灯号；/, '；')
                        .replace(/，最新 U→C 与 reason 又反馈了怎样的阅读体验；/, '；')
                        .replace(/^6\. 关系侧表：.*(?:五根推子|五维).*$/gm, '6. 关系侧表：启用双向关系时，以出演角色 ID 确认双方，分别依据各自亲历事件更新 FL、RI、DI。')
                        .replace(/^.*(?:理解|读取)执笔灯号.*$/gm, '').trimEnd();
                }
                if (prompt.id === 'nmj-v3-exit-check') {
                    content = content.replace(/每位角色按 character_id[^\n]+/g, '启用双向关系时，检查两个方向各自的证据和三轴变化。');
                }
                if (prompt.id === 'nmj-v619-possession-humanity') {
                    content = content.replace('而关系温度与占有拉力同时处在高位', '而真心与占有冲动同时强烈');
                }
                if (prompt.id === 'nmj-v6-gemini-format-lock') {
                    content = content.replace(/启用(?:多角色双向关系温度|双向好感)时，<affinity_panel> 必须完整且只出现一次；/g,
                        '本轮要求输出关系面板时，<relationship_panel> 必须完整且只出现一次；');
                }
                if (['nmj-v3-scene-header', 'nmj-v3-exit-check'].includes(prompt.id)) {
                    content = content.replace(/多角色双向关系温度|双向好感|双向温度/g, '双向关系三轴');
                }
                return { ...prompt, name, content };
            }),
    };
}
