import type { Message } from '../types';
import {
    STORY_RELATIONSHIP_AXES, calculateStoryRelationshipAxis, replayStoryRelationshipAxis,
    parseStoryRelationshipContent, legacyStoryRelationshipSelfNotes,
    type StoryRelationshipActor, type StoryRelationshipAxis,
    type StoryRelationshipDirection, type StoryRelationshipPanel,
} from './storyTheaterRelationships';
import { storyCandidateResolver } from './storyTheaterCast';

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
    historyReconciled?: true;
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
function applyRealRelationshipEvent(graph: RealRelationshipGraph, event: RealRelationshipEvent, display?: StoryRelationshipDirection[]): void {
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
        const displayedAxes: StoryRelationshipDirection['axes'] | undefined = display ? {} : undefined;
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const value = row.axes[axis], previous = next.axes[axis], before = previous?.score;
            if (update.clearAxes?.includes(axis)) delete next.axes[axis];
            else if (value) {
                let after;
                if (update.mode === 'canonical') after = replayStoryRelationshipAxis(axis, previous, value, 2);
                else if (update.mode === 'proposal') after = calculateStoryRelationshipAxis(axis, previous, value);
                else if (value.hasScore !== false) after = { ...value };
                // Some old source panels hold only the proposed delta. Use it only against a known score.
                else if (previous && value.trigger && value.evidence) after = calculateStoryRelationshipAxis(axis, previous, value);
                if (after) {
                    next.axes[axis] = after;
                    if (displayedAxes) displayedAxes[axis] = { ...after, initial: !previous,
                        eventDelta: previous ? value.delta ?? 0 : value.score };
                }
            }
            if (before !== next.axes[axis]?.score) event.changes.push({ fromId: row.fromId, toId: row.toId, axis, before, after: next.axes[axis]?.score });
        }
        // Identification, private cognition and scores change independently.
        for (const field of ['identity', 'cognition', 'trigger', 'evidence', 'relation_note'] as const) {
            if (row[field] !== undefined) next[field] = row[field];
        }
        if (row.relation_fragments?.length) next.relation_fragments = [...row.relation_fragments];
        graph.directions[key] = next;
        if (display && displayedAxes && Object.keys(displayedAxes).length) display.push({ ...row, axes: displayedAxes });
    }
    Object.assign(graph.stateNotes, event.stateNotes);
}

/** Rebuild the small structured ledger only on replacement/deletion, never by parsing all prose. */
export function rebuildRealRelationshipGraph(graph: RealRelationshipGraph, focus?: RealRelationshipEvent, display?: StoryRelationshipDirection[]): void {
    graph.directions = {};
    graph.stateNotes = {};
    graph.events.sort(compareEvents);
    for (const event of graph.events) applyRealRelationshipEvent(graph, event, event === focus ? display : undefined);
}

const samePayload = (a: RealRelationshipEvent, b: RealRelationshipPayload) =>
    JSON.stringify([a.updates, a.stateNotes]) === JSON.stringify([b.updates, b.stateNotes]);

export function upsertRealRelationshipEvent(graph: RealRelationshipGraph, id: string, source: RealRelationshipSource, payload: RealRelationshipPayload, display?: StoryRelationshipDirection[]): boolean {
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
        if (index >= 0) { graph.events[index] = event; rebuildRealRelationshipGraph(graph, event, display); }
        else {
            const previous = graph.events[graph.events.length - 1];
            graph.events.push(event);
            if (previous && compareEvents(previous, event) > 0) rebuildRealRelationshipGraph(graph, event, display);
            else applyRealRelationshipEvent(graph, event, display);
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
            fromId: row.fromId, toId: row.toId, fromName: names.get(row.fromId)!, toName: names.get(row.toId)!,
            identity: row.identity, cognition: row.cognition, relation_note: row.relation_note,
            axes: Object.fromEntries(Object.entries(row.axes).map(([axis, value]) =>
                [axis, { score: value.score, ...(value.strength ? { strength: value.strength } : {}) }])),
        })),
    };
}

/** Cast parsing is deliberately absent here. Candidate IDs still bound all accepted directions. */
export function realRelationshipPayload(panel: StoryRelationshipPanel, actors: readonly StoryRelationshipActor[],
    baseline: StoryRelationshipPanel, report: (reason: string) => void): RealRelationshipPayload | undefined {
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    const resolve = storyCandidateResolver(actors);
    const previous = new Map(baseline.relationships.map(row => [realRelationshipKey(row.fromId, row.toId), row.axes]));
    const updates: RealRelationshipUpdate[] = [];
    const used = new Set<string>();
    for (const row of panel.relationships) {
        let fromId: string, toId: string;
        try { fromId = resolve(row.fromId); toId = resolve(row.toId); }
        catch { report('关系方向包含未知或无法唯一匹配的角色'); continue; }
        if (fromId === toId) { report('关系方向的起点和终点相同'); continue; }
        const key = realRelationshipKey(fromId, toId);
        if (used.has(key)) { report('面板重复报告了同一人物方向'); return undefined; }
        used.add(key);
        const axes = Object.fromEntries(STORY_RELATIONSHIP_AXES.flatMap(axis => {
            const value = row.axes[axis];
            if (!value) return [];
            const label = names.get(fromId) + ' → ' + names.get(toId) + ' ' + axis;
            if (!value.trigger || !value.evidence) { report(label + ' 缺少触发事件或证据'); return []; }
            const prior = previous.get(key)?.[axis];
            if (axis === 'FL' && !prior && value.hasScore === false) report(label + ' 尚未初始化，需要首次评分');
            if (prior && value.delta === undefined && axis !== 'DI') report(label + ' 缺少 delta，分数保持原值');
            return [[axis, value]];
        }));
        const privateEvidence = Boolean(row.trigger && row.evidence);
        const identity = privateEvidence ? row.identity : undefined;
        const cognition = privateEvidence ? row.cognition : undefined;
        if (!privateEvidence && (row.identity !== undefined || row.cognition !== undefined)) report('关系认同或认知缺少触发事件或证据');
        if (!Object.keys(axes).length && identity === undefined && cognition === undefined) continue;
        updates.push({ mode: 'proposal', direction: { fromId, toId, fromName: names.get(fromId)!, toName: names.get(toId)!, axes,
            identity, cognition, ...(privateEvidence ? { trigger: row.trigger, evidence: row.evidence } : {}),
            relation_note: row.relation_note, relation_fragments: row.relation_fragments } });
    }
    const notes = { ...panel.state_notes };
    if (panel.primaryId && panel.state_note) notes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
    const stateNotes = Object.fromEntries(Object.entries(notes).filter(([id]) => names.has(id)));
    if (!updates.length && panel.hadRelationshipEntries) { report('没有可写入的关系方向'); return undefined; }
    return { version: 1, updates, stateNotes };
}
