import type { Message, StoryTheaterEntry } from '../types';
import { readStoryRelationshipHistory } from './storyRelationshipHistory';
import { appendStoryRelationshipPanel, readStoryRelationshipPayload, type StoryRelationshipDirection } from './storyTheaterRelationships';
import {
    emptyRealRelationshipGraph, legacyRealRelationshipPayload, rebuildRealRelationshipGraph, upsertRealRelationshipEvent,
    type RealRelationshipGraph, type RealRelationshipLayout, type RealRelationshipPayload,
} from './realRelationshipModel';

export const REAL_RELATIONSHIP_GRAPH_KEY = 'sully_real_relationship_graph_v1';
export const REAL_RELATIONSHIP_LAYOUT_KEY = 'sully_real_relationship_layout_v1';
export const REAL_RELATIONSHIPS_CHANGED = 'sully-real-relationships-changed';
const errors = new WeakMap<IDBTransaction, unknown>();
const notifying = new WeakSet<IDBTransaction>();
function notifyOnCommit(tx: IDBTransaction) {
    if (notifying.has(tx)) return;
    notifying.add(tx);
    tx.addEventListener('complete', () => {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REAL_RELATIONSHIPS_CHANGED));
    });
}
export const realRelationshipTransactionError = (tx: IDBTransaction) => errors.get(tx) || tx.error;
const safely = (tx: IDBTransaction, action: () => void) => {
    try { action(); } catch (error) { errors.set(tx, error); tx.abort(); }
};
const write = (tx: IDBTransaction, graph: RealRelationshipGraph) => {
    notifyOnCommit(tx);
    return tx.objectStore('assets').put({ id: REAL_RELATIONSHIP_GRAPH_KEY, data: JSON.stringify(graph) });
};
function decode(data: unknown): RealRelationshipGraph {
    const value = typeof data === 'string' ? JSON.parse(data) : data as RealRelationshipGraph;
    if (!value || value.schema !== 'sullyos.real-relationships' || value.version !== 1 || !Array.isArray(value.events)
        || !value.directions || !value.stateNotes || !Number.isSafeInteger(value.revision) || !Number.isSafeInteger(value.nextSequence)) {
        throw new Error('关系网存档格式无法识别，原数据已保留');
    }
    return value;
}
export const validateRealRelationshipGraph = (data: unknown) => decode(data);

function payloadOf(row: Message): RealRelationshipPayload | undefined {
    const payload = readStoryRelationshipPayload(row.metadata?.theaterRealRelationshipEvent);
    if (row.metadata?.theaterRealRelationshipProtocol === 1 && payload) return payload;
    return /<(?:affinity_panel|relationship_panel)\b/i.test(row.content) ? legacyRealRelationshipPayload(row) : undefined;
}
const centralReply = (row: Message) => row.role === 'assistant' && row.type === 'text' && typeof row.content === 'string' && !row.groupId
    && !row.metadata?.theaterOutOfStory && row.metadata?.source === 'story_theater'
    && typeof row.metadata.theaterId === 'string' && row.charId === `story-theater:${row.metadata.theaterId}`
    && (row.metadata.theaterRelationshipScope === undefined || row.metadata.theaterRelationshipScope === 'real');

/** Check pre-existing graphs once for omitted central events. Normal reads use the projection. */
export function readRealRelationshipGraph(tx: IDBTransaction, done: (graph: RealRelationshipGraph) => void, initialize = true): void {
    const request = tx.objectStore('assets').get(REAL_RELATIONSHIP_GRAPH_KEY);
    request.onsuccess = () => safely(tx, () => {
        const graph = request.result ? decode(request.result.data) : emptyRealRelationshipGraph();
        if (graph.historyReconciled || (!initialize && request.result)) { done(graph); return; }
        if (!initialize) return;
        const stories = tx.objectStore('story_theaters').getAll();
        stories.onsuccess = () => safely(tx, () => {
            const titles = new Map((stories.result as StoryTheaterEntry[]).map(entry => [entry.id, entry.title]));
            readStoryRelationshipHistory(tx, { id: '__real_relationship_bootstrap__', writesToCharacterMemory: true }, history => safely(tx, () => {
                const known = new Set(graph.events.map(event => event.id));
                const before = graph.events.length;
                for (const row of history.messages) {
                    const id = `story:${row.id}`;
                    if (known.has(id)) continue;
                    const payload = payloadOf(row);
                    if (!payload || (!payload.updates.length && !Object.keys(payload.stateNotes).length)) continue;
                    graph.events.push({ ...payload, id, sequence: graph.nextSequence++, source: {
                        kind: row.metadata?.theaterRealRelationshipEvent ? 'story' : 'legacy',
                        theaterId: row.metadata.theaterId, title: titles.get(row.metadata.theaterId) || '真实剧情',
                        messageId: row.id, timestamp: row.timestamp,
                    } });
                }
                if (graph.events.length !== before) {
                    rebuildRealRelationshipGraph(graph);
                    graph.revision++;
                }
                graph.historyReconciled = true;
                write(tx, graph);
                done(graph);
            }));
        });
    });
}

/** Save the event and, for generated replies, reuse its calculated values in the reader's panel. */
export function syncRealRelationshipMessage(tx: IDBTransaction, row: Message, display?: (content: string) => void, previousContent?: string): void {
    if (!centralReply(row)) { display?.(row.content); return; }
    const payload = payloadOf(row);
    // A missing/broken relation report preserves existing state, including on a rewrite.
    if (!payload) { display?.(row.content); return; }
    const owner = tx.objectStore('story_theaters').get(row.metadata.theaterId);
    owner.onsuccess = () => safely(tx, () => {
        const entry = owner.result as StoryTheaterEntry | undefined;
        if (!entry?.writesToCharacterMemory) { display?.(row.content); return; }
        readRealRelationshipGraph(tx, graph => {
            const relationships: StoryRelationshipDirection[] | undefined = display ? [] : undefined;
            const changed = upsertRealRelationshipEvent(graph, `story:${row.id}`, {
                kind: row.metadata?.theaterRealRelationshipProtocol === 1 ? 'story' : 'legacy', theaterId: entry.id,
                title: entry.title, messageId: row.id, timestamp: row.timestamp,
            }, payload, relationships);
            if (changed) write(tx, graph);
            if (display) {
                const previousPanel = !changed && !relationships?.length && previousContent
                    ? previousContent.match(/<affinity_panel\b[^>]*\bmode="three_axes"[^>]*>[\s\S]*?<\/affinity_panel\s*>/i)?.[0] : undefined;
                display(previousPanel ? row.content + '\n\n' + previousPanel
                    : appendStoryRelationshipPanel(row.content, relationships ?? [], payload.stateNotes));
            }
        }, false);
    });
}

export function removeRealRelationshipEvents(tx: IDBTransaction, ids?: readonly number[], theaterId?: string): void {
    const selected = new Set(ids);
    readRealRelationshipGraph(tx, graph => {
        const remaining = graph.events.filter(event => !(event.source.kind !== 'manual'
            && ((event.source.messageId !== undefined && selected.has(event.source.messageId)) || (theaterId && event.source.theaterId === theaterId))));
        if (remaining.length === graph.events.length) return;
        graph.events = remaining;
        rebuildRealRelationshipGraph(graph);
        graph.revision++;
        write(tx, graph);
    }, false);
}

export const realRelationshipSignature = (graph: RealRelationshipGraph) => `real-graph:${graph.revision}`;
export function checkRealRelationshipGuard(tx: IDBTransaction, entry: Pick<StoryTheaterEntry, 'id' | 'writesToCharacterMemory'>,
    signature: string, done: () => void): void {
    const owner = tx.objectStore('story_theaters').get(entry.id);
    owner.onsuccess = () => safely(tx, () => {
        if (!entry.writesToCharacterMemory || !owner.result?.writesToCharacterMemory) throw new Error('真实剧场已变更，请重新打开后重试');
        readRealRelationshipGraph(tx, graph => safely(tx, () => {
            if (realRelationshipSignature(graph) !== signature) throw new Error('同一世界的关系历史已更新，请重试以使用最新关系；本次未保存');
            done();
        }));
    });
}

function transactionResult<T>(tx: IDBTransaction, value: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve(value());
        tx.onabort = () => reject(realRelationshipTransactionError(tx) || new Error('关系更改未保存，原记录已保留'));
        tx.onerror = () => reject(realRelationshipTransactionError(tx));
    });
}

export function loadRealRelationshipGraph(db: IDBDatabase): Promise<RealRelationshipGraph> {
    const tx = db.transaction(['assets', 'messages', 'story_theaters'], 'readwrite');
    let value: RealRelationshipGraph;
    const result = transactionResult(tx, () => value);
    readRealRelationshipGraph(tx, graph => { value = graph; });
    return result;
}

export interface ManualRealRelationshipEdit {
    fromId: string;
    toId: string;
    identity?: string;
    cognition?: string;
    axes: Partial<Record<'FL' | 'RI' | 'DI', number | null>>;
    reason: string;
}
export function editRealRelationship(db: IDBDatabase, edit: ManualRealRelationshipEdit, revision: number): Promise<RealRelationshipGraph> {
    if (!edit.fromId || !edit.toId || edit.fromId === edit.toId) return Promise.reject(new Error('请选择两位不同人物'));
    for (const value of Object.values(edit.axes)) if (value !== null && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100)) {
        return Promise.reject(new Error('关系数值须为 0–100 的整数，留空表示未初始化'));
    }
    const tx = db.transaction(['assets', 'messages', 'story_theaters', 'characters'], 'readwrite');
    let updated: RealRelationshipGraph;
    const result = transactionResult(tx, () => updated);
    const first = tx.objectStore('characters').get(edit.fromId), second = tx.objectStore('characters').get(edit.toId);
    const latest = tx.objectStore('messages').openCursor(null, 'prev');
    let pending = 3;
    const finish = () => {
        if (--pending) return;
        safely(tx, () => {
            if (!first.result || !second.result) throw new Error('人物已删除，请重新选择');
            readRealRelationshipGraph(tx, graph => safely(tx, () => {
                if (graph.revision !== revision) throw new Error('关系已在别处更新，请刷新后再编辑');
                if (!Object.keys(edit.axes).length && edit.identity === undefined && edit.cognition === undefined && !edit.reason.trim()) {
                    updated = graph;
                    return;
                }
                const axes = Object.fromEntries(Object.entries(edit.axes).filter(([, value]) => value !== null).map(([axis, score]) => [axis, { score }]));
                const clearAxes = (Object.keys(edit.axes) as ('FL' | 'RI' | 'DI')[]).filter(axis => edit.axes[axis] === null);
                const timestamp = Date.now();
                const id = `manual:${timestamp}:${Math.random().toString(36).slice(2)}`;
                upsertRealRelationshipEvent(graph, id, { kind: 'manual', title: '手动编辑', timestamp,
                    afterMessageId: Number(latest.result?.primaryKey ?? 0) }, {
                    version: 1, stateNotes: {}, updates: [{ mode: 'manual', clearAxes, direction: {
                        fromId: edit.fromId, toId: edit.toId, fromName: first.result.name, toName: second.result.name,
                        axes, identity: edit.identity?.trim().slice(0, 200), cognition: edit.cognition?.trim().slice(0, 2000),
                        trigger: edit.reason.trim().slice(0, 400) || '用户手动修正', evidence: '用户在关系网中保存',
                    } }],
                });
                write(tx, graph);
                updated = graph;
            }));
        });
    };
    first.onsuccess = finish; second.onsuccess = finish; latest.onsuccess = finish;
    return result;
}

export async function loadRealRelationshipLayout(db: IDBDatabase): Promise<RealRelationshipLayout> {
    const tx = db.transaction('assets', 'readonly');
    const request = tx.objectStore('assets').get(REAL_RELATIONSHIP_LAYOUT_KEY);
    return new Promise((resolve, reject) => {
        request.onsuccess = () => {
            try {
                const data = typeof request.result?.data === 'string' ? JSON.parse(request.result.data) : request.result?.data;
                resolve(data && typeof data.positions === 'object' ? data : { positions: {} });
            } catch (error) { reject(error); }
        };
        request.onerror = () => reject(request.error);
    });
}

export function patchRealRelationshipLayout(db: IDBDatabase, patch: Partial<RealRelationshipLayout>): Promise<void> {
    for (const position of Object.values(patch.positions ?? {})) if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return Promise.reject(new Error('无效的画布位置'));
    if (patch.viewport && (!Number.isFinite(patch.viewport.x) || !Number.isFinite(patch.viewport.y) || !Number.isFinite(patch.viewport.zoom)
        || patch.viewport.zoom < 0.1 || patch.viewport.zoom > 3)) return Promise.reject(new Error('无效的画布缩放'));
    const tx = db.transaction('assets', 'readwrite');
    const request = tx.objectStore('assets').get(REAL_RELATIONSHIP_LAYOUT_KEY);
    const result = transactionResult(tx, () => undefined);
    request.onsuccess = () => safely(tx, () => {
        const raw = request.result?.data;
        const current: RealRelationshipLayout = (typeof raw === 'string' ? JSON.parse(raw) : raw) || { positions: {} };
        tx.objectStore('assets').put({ id: REAL_RELATIONSHIP_LAYOUT_KEY, data: JSON.stringify({
            ...current, ...patch, positions: { ...current.positions, ...patch.positions },
        }) });
    });
    return result;
}

/** Match the existing full-vs-message-patch importer without losing unrelated manual edits. */
export function finishRealRelationshipRestore(db: IDBDatabase, options: {
    partial: boolean; previous?: RealRelationshipGraph; incoming?: RealRelationshipGraph;
    previousLayout?: unknown; incomingLayout?: unknown;
}): Promise<void> {
    const tx = db.transaction(['assets', 'messages', 'story_theaters'], 'readwrite');
    const result = transactionResult(tx, () => undefined);
    const assets = tx.objectStore('assets');
    assets.delete(REAL_RELATIONSHIP_GRAPH_KEY);
    assets.delete(REAL_RELATIONSHIP_LAYOUT_KEY);
    const finish = (graph: RealRelationshipGraph) => safely(tx, () => {
        if (options.partial) {
            const manual = [...options.previous?.events ?? [], ...options.incoming?.events ?? []].filter(event => event.source.kind === 'manual');
            graph.events = [...new Map([...graph.events, ...manual].map(event => [event.id, event])).values()];
            for (const event of graph.events) graph.nextSequence = Math.max(graph.nextSequence, event.sequence + 1);
            rebuildRealRelationshipGraph(graph);
        }
        graph.revision = Math.max(graph.revision, options.previous?.revision ?? 0, options.incoming?.revision ?? 0) + 1;
        write(tx, graph);
        const parsedLayout = (value: unknown) => typeof value === 'string' ? JSON.parse(value) : value as RealRelationshipLayout | undefined;
        const oldLayout = options.partial ? parsedLayout(options.previousLayout) : undefined;
        const nextLayout = parsedLayout(options.incomingLayout);
        if (oldLayout || nextLayout) assets.put({ id: REAL_RELATIONSHIP_LAYOUT_KEY, data: JSON.stringify({
            ...oldLayout, ...nextLayout, positions: { ...oldLayout?.positions, ...nextLayout?.positions },
        }) });
    });
    if (!options.partial && options.incoming) finish(options.incoming);
    else readRealRelationshipGraph(tx, finish);
    return result;
}
