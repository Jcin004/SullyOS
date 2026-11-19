import type { Message } from '../types';
import {
    STORY_RELATIONSHIP_AXES, calculateStoryRelationshipAxis, replayStoryRelationshipAxis,
    parseStoryRelationshipContent, serializeStoryThreeAxisPanel, stripStoryRelationshipPanels, legacyStoryRelationshipSelfNotes,
    type StoryRelationshipActor, type StoryRelationshipAxis,
    type StoryRelationshipDirection, type StoryRelationshipPanel,
} from './storyTheaterRelationships';

export interface RealRelationshipSource {
    kind: 'story' | 'legacy' | 'manual';
    theaterId?: string;
    title: string;
    messageId?: number;
    /** Manual edits occur after this global message ID, independent of device clocks. */
    afterMessageId?: number;
    timestamp: number;
}
export interface RealRelationshipDirection extends StoryRelationshipDirection {
    lastSource: RealRelationshipSource;
    lastStorySource?: RealRelationshipSource;
}
export interface RealRelationshipUpdate {
    direction: StoryRelationshipDirection;
    mode: 'proposal' | 'snapshot' | 'canonical' | 'manual';
    clearAxes?: StoryRelationshipAxis[];
}
export interface RealRelationshipPayload {
    version: 1;
    updates: RealRelationshipUpdate[];
    stateNotes: NonNullable<StoryRelationshipPanel['state_notes']>;
}
export interface RealRelationshipEvent extends RealRelationshipPayload {
    id: string;
    sequence: number;
    source: RealRelationshipSource;
    changes?: { fromId: string; toId: string; axis: StoryRelationshipAxis; before?: number; after?: number }[];
}
export interface RealRelationshipGraph {
    schema: 'sullyos.real-relationships';
    version: 1;
    revision: number;
    nextSequence: number;
    directions: Record<string, RealRelationshipDirection>;
    stateNotes: NonNullable<StoryRelationshipPanel['state_notes']>;
    events: RealRelationshipEvent[];
}
export interface RealRelationshipLayout {
    positions: Record<string, { x: number; y: number }>;
    viewport?: { x: number; y: number; zoom: number };
}

export const realRelationshipKey = (fromId: string, toId: string) => JSON.stringify([fromId, toId]);
export const emptyRealRelationshipGraph = (): RealRelationshipGraph => ({
    schema: 'sullyos.real-relationships', version: 1, revision: 0, nextSequence: 1, directions: {}, stateNotes: {}, events: [],
});
const eventOrder = (event: RealRelationshipEvent) => event.source.kind === 'manual'
    ? event.source.afterMessageId ?? 0 : event.source.messageId ?? 0;
const compareEvents = (a: RealRelationshipEvent, b: RealRelationshipEvent) => eventOrder(a) - eventOrder(b)
    || Number(a.source.kind === 'manual') - Number(b.source.kind === 'manual') || a.sequence - b.sequence;

/** The calculator is shared with fictional theater; only explicit, evidenced axes are proposed. */
export function applyRealRelationshipEvent(graph: RealRelationshipGraph, event: RealRelationshipEvent): void {
    event.changes = [];
    for (const update of event.updates) {
        const row = update.direction;
        if (!row.fromId || !row.toId || row.fromId === row.toId) continue;
        const key = realRelationshipKey(row.fromId, row.toId);
        const prior = graph.directions[key];
        const next: RealRelationshipDirection = {
            ...prior, fromId: row.fromId, toId: row.toId, fromName: row.fromName, toName: row.toName,
            axes: { ...prior?.axes }, lastSource: event.source,
            lastStorySource: event.source.kind === 'manual' ? prior?.lastStorySource : event.source,
        };
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const value = row.axes[axis], before = next.axes[axis]?.score;
            if (update.clearAxes?.includes(axis)) delete next.axes[axis];
            else if (value && (update.mode !== 'snapshot' || value.hasScore !== false)) {
                const after = update.mode === 'proposal'
                    ? calculateStoryRelationshipAxis(axis, next.axes[axis], value)
                    : update.mode === 'canonical' ? replayStoryRelationshipAxis(axis, next.axes[axis], value, 2)
                        : { ...value };
                if (after) next.axes[axis] = after;
            }
            if (before !== next.axes[axis]?.score) event.changes.push({ fromId: row.fromId, toId: row.toId, axis, before, after: next.axes[axis]?.score });
        }
        // Identification, private cognition and scores change independently.
        for (const field of ['identity', 'cognition', 'trigger', 'evidence', 'relation_note'] as const) {
            if (row[field] !== undefined) next[field] = row[field];
        }
        if (row.relation_fragments?.length) next.relation_fragments = [...row.relation_fragments];
        graph.directions[key] = next;
    }
    Object.assign(graph.stateNotes, event.stateNotes);
}

/** Rebuild the small structured ledger only on replacement/deletion, never by parsing all prose. */
export function rebuildRealRelationshipGraph(graph: RealRelationshipGraph): void {
    graph.directions = {};
    graph.stateNotes = {};
    graph.events.sort(compareEvents);
    for (const event of graph.events) applyRealRelationshipEvent(graph, event);
}

const samePayload = (a: RealRelationshipEvent, b: RealRelationshipPayload) =>
    JSON.stringify([a.updates, a.stateNotes]) === JSON.stringify([b.updates, b.stateNotes]);

export function upsertRealRelationshipEvent(graph: RealRelationshipGraph, id: string, source: RealRelationshipSource, payload?: RealRelationshipPayload): boolean {
    const index = graph.events.findIndex(event => event.id === id);
    const meaningful = payload && (payload.updates.length || Object.keys(payload.stateNotes).length);
    if (index < 0 && !meaningful) return false;
    if (index >= 0 && meaningful && samePayload(graph.events[index], payload)) return false;
    if (!meaningful) {
        graph.events.splice(index, 1);
        rebuildRealRelationshipGraph(graph);
    } else {
        const event: RealRelationshipEvent = { ...payload, id, source,
            sequence: index >= 0 ? graph.events[index].sequence : graph.nextSequence++ };
        if (index >= 0) { graph.events[index] = event; rebuildRealRelationshipGraph(graph); }
        else {
            const previous = graph.events[graph.events.length - 1];
            graph.events.push(event);
            if (previous && compareEvents(previous, event) > 0) rebuildRealRelationshipGraph(graph);
            else applyRealRelationshipEvent(graph, event);
        }
    }
    graph.revision++;
    return true;
}

export function realRelationshipGraphBefore(graph: RealRelationshipGraph, messageId?: number): RealRelationshipGraph {
    if (messageId === undefined) return graph;
    const before = { ...graph, directions: {}, stateNotes: {}, events: graph.events.filter(event =>
        event.source.kind === 'manual' ? (event.source.afterMessageId ?? 0) < messageId : (event.source.messageId ?? 0) < messageId,
    ).map(event => ({ ...event })) };
    rebuildRealRelationshipGraph(before);
    return before;
}

/** A first-time migration keeps legacy absolute scores and v2 deltas distinct. */
export function legacyRealRelationshipPayload(message: Message): RealRelationshipPayload | undefined {
    const panel = parseStoryRelationshipContent(message.content);
    if (!panel) {
        const stateNotes = legacyStoryRelationshipSelfNotes(message.content);
        return Object.keys(stateNotes).length ? { version: 1, stateNotes, updates: [] } : undefined;
    }
    const stateNotes = { ...panel.state_notes };
    if (panel.primaryId && panel.state_note) stateNotes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
    return { version: 1, stateNotes, updates: panel.relationships.map(direction => ({
        direction, mode: panel.historyVersion === 2 ? 'canonical' : 'snapshot',
    })) };
}

export function realRelationshipBaseline(graph: RealRelationshipGraph, actors: readonly StoryRelationshipActor[]): StoryRelationshipPanel {
    const ids = new Set(actors.map(actor => actor.id));
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    return { primaryId: '', primaryName: '', actors: actors.map(({ id, name }) => ({ id, name })),
        state_notes: Object.fromEntries(Object.entries(graph.stateNotes).filter(([id]) => ids.has(id))),
        relationships: Object.values(graph.directions).filter(row => ids.has(row.fromId) && ids.has(row.toId)).map(row => ({
            ...row, fromName: names.get(row.fromId)!, toName: names.get(row.toId)!,
        })),
    };
}

/** Cast parsing is deliberately absent here. Candidate IDs still bound all accepted directions. */
export function parseRealRelationshipTurn(content: string, actors: readonly StoryRelationshipActor[]): RealRelationshipPayload | undefined {
    const panel = parseStoryRelationshipContent(content);
    if (!panel) return undefined;
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    const resolve = (id: string) => names.has(id) ? id : actors.filter(actor => actor.name === id).length === 1
        ? actors.find(actor => actor.name === id)!.id : undefined;
    const updates: RealRelationshipUpdate[] = [];
    const used = new Set<string>();
    for (const row of panel.relationships) {
        const fromId = resolve(row.fromId), toId = resolve(row.toId);
        if (!fromId || !toId || fromId === toId) continue;
        const key = realRelationshipKey(fromId, toId);
        if (used.has(key)) return undefined;
        used.add(key);
        const axes = Object.fromEntries(STORY_RELATIONSHIP_AXES.flatMap(axis => {
            const value = row.axes[axis];
            return value?.trigger && value?.evidence ? [[axis, value]] : [];
        }));
        const privateEvidence = Boolean(row.trigger && row.evidence);
        const identity = privateEvidence ? row.identity : undefined;
        const cognition = privateEvidence ? row.cognition : undefined;
        if (!Object.keys(axes).length && identity === undefined && cognition === undefined) continue;
        updates.push({ mode: 'proposal', direction: { fromId, toId, fromName: names.get(fromId)!, toName: names.get(toId)!, axes,
            identity, cognition, ...(privateEvidence ? { trigger: row.trigger, evidence: row.evidence } : {}),
            relation_note: row.relation_note, relation_fragments: row.relation_fragments } });
    }
    const notes = { ...panel.state_notes };
    if (panel.primaryId && panel.state_note) notes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
    const stateNotes = Object.fromEntries(Object.entries(notes).filter(([id]) => names.has(id)));
    if (!updates.length && panel.hadRelationshipEntries) return undefined;
    return { version: 1, updates, stateNotes };
}

export function prepareRealRelationshipReply(content: string, graph: RealRelationshipGraph, actors: readonly StoryRelationshipActor[]) {
    const payload = parseRealRelationshipTurn(content, actors);
    const prose = stripStoryRelationshipPanels(content);
    if (!payload) return { content: prose, payload: undefined };
    const preview = { ...graph, directions: { ...graph.directions }, stateNotes: { ...graph.stateNotes } };
    const event: RealRelationshipEvent = { ...payload, id: 'preview', sequence: graph.nextSequence,
        source: { kind: 'story', title: '', timestamp: 0 } };
    applyRealRelationshipEvent(preview, event);
    // Private relationship recognition stays in central metadata/the graph, never text mirrors.
    const relationships = payload.updates.flatMap(update => {
        const row = preview.directions[realRelationshipKey(update.direction.fromId, update.direction.toId)];
        const axes: StoryRelationshipDirection['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            if (!update.direction.axes[axis] || !row?.axes[axis]) continue;
            const prior = graph.directions[realRelationshipKey(row.fromId, row.toId)]?.axes[axis];
            const value = row.axes[axis]!;
            axes[axis] = { ...value, delta: value.score - (prior?.score ?? 0), initial: !prior,
                eventDelta: update.direction.axes[axis]!.delta ?? update.direction.axes[axis]!.score };
        }
        return row && Object.keys(axes).length ? [{ fromId: row.fromId, toId: row.toId, fromName: row.fromName, toName: row.toName, axes,
            relation_note: update.direction.relation_note, relation_fragments: update.direction.relation_fragments }] : [];
    });
    const panel = relationships.length || Object.keys(payload.stateNotes).length ? '\n\n' + serializeStoryThreeAxisPanel({
        primaryId: '', primaryName: '', historyVersion: 2, relationships, state_notes: payload.stateNotes,
    }) : '';
    return { content: prose + panel, payload };
}

export function buildRealRelationshipGuide(graph: RealRelationshipGraph, actors: readonly StoryRelationshipActor[]): string {
    const baseline = realRelationshipBaseline(graph, actors);
    return [
        '### 真实世界人物关系网：本次请求在剧情、出演信息和私轴之外，直接输出关系变化，不另开生成请求。',
        '每个方向只代表起点人物自己的认识。“关系认同”指我认为对方是我的什么人；“关系认知”用第一人称，依据我亲历或明确获知的事实。',
        '这些认知是人物私有资料。其他人物不能知道对方未表达的内心，也不能把此面板当作已经说出口的事实；叙述和行动须遵守各自知识边界。',
        '关系更新与 <turn_cast> 分别记录。即使出演名单遗漏或格式错误，仍完整输出已成立的关系事件；只使用下方候选 ID，不按交流倾向或仅仅同场凑关系。',
        '关系认同、第一视角认知、FL/RI/DI 分别判断，没变化就省略对应字段，未发生关系事件的方向全部省略。已有数值 0 是已初始化；缺少轴才是未初始化。',
        '首次 FL 用角色卡、既有关系和共同经历填写 score；后续仅给 delta。每轴需要自己的 trigger、evidence，继续遵循 FL/RI/DI 规则；DI 使用 phase 和 strength。',
        '关系认同或认知发生变化时，另给 relation_trigger、relation_evidence；不能为关系称谓强行加减三轴。两个方向独立，不复制对方数值或认知。',
        '<affinity_panel mode="three_axes"><affinity_person><from_id>起点ID</from_id><to_id>终点ID</to_id>',
        '<relation_identity>我认为对方是我的什么人（有变化才填）</relation_identity><relation_cognition>我的当前认识（有变化才填）</relation_cognition>',
        '<relation_trigger>我亲历的关系事件</relation_trigger><relation_evidence>我实际知道的表现或话语</relation_evidence>',
        '<FL><delta>5</delta><trigger>本轴事件</trigger><evidence>本轴证据</evidence></FL></affinity_person></affinity_panel>',
        '自我记录可沿用 <self_record>；场外不更新关系。关系解析失败时保留原有状态。',
        '方向基线：' + JSON.stringify(baseline).replace(/</g, '\\u003c').replace(/>/g, '\\u003e'),
    ].join('\n');
}
