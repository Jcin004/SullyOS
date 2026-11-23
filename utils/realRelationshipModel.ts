import type { Message } from '../types';
import {
    STORY_RELATIONSHIP_AXES, applyStoryRelationshipUpdate,
    parseStoryRelationshipContent, legacyStoryRelationshipSelfNotes, storyRelationshipHistoryMode,
    type StoryRelationshipActor, type StoryRelationshipAxis,
    type StoryRelationshipDirection, type StoryRelationshipPanel, type StoryRelationshipPayload,
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
export type RealRelationshipPayload = StoryRelationshipPayload;
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

function applyRealRelationshipEvent(graph: RealRelationshipGraph, event: RealRelationshipEvent, display?: StoryRelationshipDirection[]): void {
    event.changes = [];
    for (const update of event.updates) {
        const { fromId, toId } = update.direction;
        if (!fromId || !toId || fromId === toId) continue;
        const key = realRelationshipKey(fromId, toId);
        const prior = graph.directions[key];
        const applied = applyStoryRelationshipUpdate(update, prior, Boolean(display));
        graph.directions[key] = {
            ...applied.next, lastSource: event.source,
            lastStorySource: event.source.kind === 'manual' ? prior?.lastStorySource : event.source,
        };
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const before = prior?.axes[axis]?.score, after = applied.next.axes[axis]?.score;
            if (before !== after) event.changes.push({ fromId, toId, axis, before, after });
        }
        if (applied.display) display?.push(applied.display);
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
    if (index >= 0 && meaningful && samePayload(graph.events[index], payload)) {
        // Earlier edits can change the reader's delta without changing this event.
        if (display && source.messageId !== undefined && payload.updates.some(update => update.mode === 'state')) {
            const before = realRelationshipGraphBefore(graph, source.messageId);
            applyRealRelationshipEvent(before, { ...graph.events[index] }, display);
        }
        return false;
    }
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
        direction, mode: storyRelationshipHistoryMode(panel),
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
            relation_fragments: row.relation_fragments,
            axes: row.axes,
        })),
    };
}
