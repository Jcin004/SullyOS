import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactFlow, Background, Controls, BaseEdge, getBezierPath, Handle, MarkerType, Position, useNodesState, type Node, type NodeProps, type Edge, type EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, ArrowRight, Graph, SpinnerGap, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import { useLocalBackHandler } from '../../../hooks/useLocalBackHandler';
import TokenImg from '../../os/TokenImg';
import { DB } from '../../../utils/db';
import { REAL_RELATIONSHIPS_CHANGED } from '../../../utils/realRelationshipStore';
import { realRelationshipKey, type RealRelationshipGraph, type RealRelationshipLayout, type RealRelationshipDirection } from '../../../utils/realRelationshipModel';
import { STORY_RELATIONSHIP_AXES, STORY_RELATIONSHIP_LABELS } from '../../../utils/storyTheaterRelationships';

type PersonNode = Node<{ name: string; avatar?: string }, 'person'>;
const PersonCard = React.memo(({ data }: NodeProps<PersonNode>) => <div className='w-40 rounded-2xl border border-stone-300 bg-white p-3 shadow-md'>
    {[Position.Left, Position.Right, Position.Top, Position.Bottom].flatMap(side => ['in', 'out'].map(kind => {
        const offset = (side === Position.Left || side === Position.Top) === (kind === 'in') ? '35%' : '65%';
        return <Handle key={kind + side} id={kind + '-' + side} type={kind === 'in' ? 'target' : 'source'} position={side}
            style={side === Position.Left || side === Position.Right ? { top: offset, opacity: 0 } : { left: offset, opacity: 0 }} />;
    }))}
    {data.avatar ? <TokenImg value={data.avatar} alt='' className='mx-auto h-16 w-16 rounded-xl bg-violet-50 object-cover' />
        : <div className='mx-auto grid h-16 w-16 place-items-center rounded-xl bg-violet-50 text-2xl text-violet-700'>{data.name.slice(0, 1)}</div>}
    <strong className='mt-2 block truncate text-center text-xs text-slate-800'>{data.name}</strong>
</div>);
const nodeTypes = { person: PersonCard };
type RelationEdge = Edge<{ labelOffset: number }, 'relation'>;
const RelationshipEdge = (props: EdgeProps<RelationEdge>) => {
    const [path, labelX, labelY] = getBezierPath(props);
    return <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} interactionWidth={28}
        label={props.label} labelX={labelX} labelY={labelY + (props.data?.labelOffset ?? 0)} labelStyle={props.labelStyle}
        labelBgStyle={props.labelBgStyle} labelBgPadding={props.labelBgPadding} />;
};
const edgeTypes = { relation: RelationshipEdge };
type Draft = { identity: string; cognition: string; FL: string; RI: string; DI: string; reason: string };
const emptyDraft: Draft = { identity: '', cognition: '', FL: '', RI: '', DI: '', reason: '' };
const draftOf = (row?: RealRelationshipDirection): Draft => ({ identity: row?.identity || '', cognition: row?.cognition || '',
    FL: row?.axes.FL?.score?.toString() ?? '', RI: row?.axes.RI?.score?.toString() ?? '', DI: row?.axes.DI?.score?.toString() ?? '', reason: '' });
const axisNumber = (value: string) => value.trim() === '' ? null : Number(value);

const RealRelationshipNetwork: React.FC<{ onBack: () => void }> = ({ onBack }) => {
    const { characters, addToast } = useOS();
    const [graph, setGraph] = useState<RealRelationshipGraph | null>(null);
    const [layout, setLayout] = useState<RealRelationshipLayout | null>(null);
    const [nodes, setNodes, onNodesChange] = useNodesState<PersonNode>([]);
    const [error, setError] = useState('');
    const [pair, setPair] = useState<[string, string] | null>(null);
    const [fromId, setFromId] = useState('');
    const [toId, setToId] = useState('');
    const [draft, setDraft] = useState<Draft>(emptyDraft);
    const initialDraft = useRef<Draft>(emptyDraft);
    const [editRevision, setEditRevision] = useState(0);
    const [saving, setSaving] = useState(false);
    const [historyLimit, setHistoryLimit] = useState(20);
    const dialog = useRef<HTMLDialogElement>(null);
    const active = useRef(true);
    const refresh = useCallback(async () => {
        try {
            const next = await DB.getRealRelationshipGraph();
            if (active.current) { setGraph(current => !current || current.revision <= next.revision ? next : current); setError(''); }
        } catch (cause) { if (active.current) setError(String((cause as Error).message)); }
    }, []);
    useEffect(() => {
        active.current = true;
        void refresh();
        void DB.getRealRelationshipLayout().then(next => { if (active.current) setLayout(next); }).catch(cause => setError(String(cause.message)));
        const changed = () => { void refresh(); };
        window.addEventListener(REAL_RELATIONSHIPS_CHANGED, changed);
        return () => { active.current = false; window.removeEventListener(REAL_RELATIONSHIPS_CHANGED, changed); };
    }, [refresh]);

    const people = useMemo(() => {
        const list = characters.map(actor => ({ id: actor.id, name: actor.name, avatar: actor.avatar }));
        const known = new Set(list.map(actor => actor.id));
        for (const row of Object.values(graph?.directions ?? {})) for (const [id, name] of [[row.fromId, row.fromName], [row.toId, row.toName]]) {
            if (!known.has(id)) { list.push({ id, name: name + '（已移除）', avatar: '' }); known.add(id); }
        }
        return list;
    }, [characters, graph]);
    const name = (id: string) => people.find(actor => actor.id === id)?.name || id;
    useEffect(() => {
        if (!layout) return;
        setNodes(previous => people.map((person, index) => ({ id: person.id, type: 'person', data: { name: person.name, avatar: person.avatar },
            position: previous.find(node => node.id === person.id)?.position ?? layout.positions[person.id]
                ?? { x: (index % 3) * 250, y: Math.floor(index / 3) * 210 },
        })));
    }, [layout, people, setNodes]);
    const edges: RelationEdge[] = useMemo(() => Object.values(graph?.directions ?? {}).map(row => {
        const from = nodes.find(node => node.id === row.fromId)?.position ?? { x: 0, y: 0 };
        const to = nodes.find(node => node.id === row.toId)?.position ?? { x: 0, y: 0 };
        const vertical = Math.abs(to.y - from.y) > Math.abs(to.x - from.x);
        const forward = vertical ? to.y >= from.y : to.x >= from.x;
        const sourceSide = vertical ? (forward ? 'bottom' : 'top') : (forward ? 'right' : 'left');
        const targetSide = vertical ? (forward ? 'top' : 'bottom') : (forward ? 'left' : 'right');
        const label = row.identity || '关系待认定';
        return {
        id: realRelationshipKey(row.fromId, row.toId), source: row.fromId, target: row.toId, sourceHandle: 'out-' + sourceSide, targetHandle: 'in-' + targetSide,
        type: 'relation', data: { labelOffset: vertical && graph?.directions[realRelationshipKey(row.toId, row.fromId)] ? (forward ? -18 : 18) : 0 },
        label: Array.from(label).length > 5 ? Array.from(label).slice(0, 5).join('') + '…' : label,
        ariaLabel: row.fromName + ' → ' + row.toName + '：' + label,
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7c3aed' },
        style: { stroke: '#7c3aed', strokeWidth: 2 }, labelStyle: { fill: '#5b21b6', fontSize: 10 },
        labelBgStyle: { fill: '#fafaf9', fillOpacity: 0.96 }, labelBgPadding: [7, 5] as [number, number], interactionWidth: 28,
    }; }), [graph, nodes]);
    const selectDirection = (from: string, to: string) => {
        if (!graph || !from || !to || from === to) return;
        const row = graph.directions[realRelationshipKey(from, to)];
        setFromId(from); setToId(to); setEditRevision(graph.revision);
        initialDraft.current = draftOf(row);
        setDraft(initialDraft.current);
        setPair([from, to]); setHistoryLimit(20); setError('');
    };
    const closePair = () => { if (!saving) { setPair(null); setError(''); } };
    useLocalBackHandler(() => { if (saving) return true; if (pair) closePair(); else onBack(); return true; }, 40);
    useEffect(() => {
        if (pair && dialog.current && !dialog.current.open) dialog.current.showModal();
        if (!pair && dialog.current?.open) dialog.current.close();
    }, [pair]);
    const saveLayout = (patch: Partial<RealRelationshipLayout>) => {
        void DB.patchRealRelationshipLayout(patch).catch(cause => { if (active.current) addToast('画布位置未保存：' + cause.message, 'error'); });
    };
    const save = async () => {
        if (!graph || saving) return;
        setSaving(true); setError('');
        try {
            const next = await DB.editRealRelationship({ fromId, toId,
                identity: draft.identity.trim() !== initialDraft.current.identity.trim() ? draft.identity : undefined,
                cognition: draft.cognition.trim() !== initialDraft.current.cognition.trim() ? draft.cognition : undefined,
                reason: draft.reason, axes: Object.fromEntries(STORY_RELATIONSHIP_AXES.filter(axis => axisNumber(draft[axis]) !== axisNumber(initialDraft.current[axis]))
                    .map(axis => [axis, axisNumber(draft[axis])])) }, editRevision);
            if (active.current) {
                setGraph(next); setEditRevision(next.revision); initialDraft.current = draftOf(next.directions[realRelationshipKey(fromId, toId)]);
                setDraft(initialDraft.current); addToast('这个方向的关系已保存', 'success');
            }
        } catch (cause) { if (active.current) setError(String((cause as Error).message)); }
        finally { if (active.current) setSaving(false); }
    };
    const history = graph?.events.filter(event => pair && event.updates.some(update =>
        pair.includes(update.direction.fromId) && pair.includes(update.direction.toId))).slice().reverse() ?? [];
    const current = graph?.directions[realRelationshipKey(fromId, toId)];

    return <div className='flex h-full min-h-0 flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-stone-200 bg-stone-50 px-4'>
            <div className='flex h-16 items-center gap-3'><button onClick={onBack} aria-label='返回剧情' className='grid h-11 w-11 place-items-center'><ArrowLeft size={21} /></button>
                <div className='min-w-0 flex-1'><h1 className='font-semibold'>真实世界人物关系网</h1><p className='text-[10px] text-slate-500'>所有真实陪伴剧场共享 · 虚构剧场独立</p></div><Graph size={23} className='text-violet-600' /></div>
            <p className='pb-3 text-[10px] leading-5 text-slate-500'>拖动人物卡片，双指缩放；点箭头查看双方认同、第一视角认知与三轴。认知只属于其本人。</p>
        </header>
        {!graph || !layout ? <div className='grid flex-1 place-items-center'><span className='text-xs text-slate-500'>{error || <SpinnerGap className='animate-spin' size={24} />}</span></div>
            : <div className='relative min-h-0 flex-1' data-testid='real-relationship-canvas'>
                <ReactFlow<PersonNode, RelationEdge> nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
                    nodesConnectable={false} elementsSelectable minZoom={0.1} maxZoom={3} zoomOnPinch panOnDrag
                    defaultViewport={layout.viewport} fitView={!layout.viewport} fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
                    onNodeDragStop={(_, node) => saveLayout({ positions: { [node.id]: node.position } })}
                    onMoveEnd={(_, viewport) => saveLayout({ viewport })}
                    onEdgeClick={(_, edge) => selectDirection(edge.source, edge.target)}>
                    <Background color='#d6d3d1' gap={24} /><Controls showInteractive={false} />
                </ReactFlow>
                {people.length === 0 && <div className='pointer-events-none absolute inset-0 grid place-items-center p-8 text-center text-sm text-slate-500'>先在神经链接创建人物，再通过真实剧情或手动编辑建立关系。</div>}
            </div>}
        <footer className='story-safe-sheet shrink-0 border-t border-stone-200 bg-stone-50 px-4 pt-3'>
            <div className='flex gap-2 pb-3'>
                <select aria-label='关系起点' value={fromId} onChange={event => setFromId(event.target.value)} className='min-w-0 flex-1 rounded-xl border border-stone-200 bg-white p-3 text-xs'>
                    <option value=''>起点人物</option>{characters.map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                </select>
                <select aria-label='关系终点' value={toId} onChange={event => setToId(event.target.value)} className='min-w-0 flex-1 rounded-xl border border-stone-200 bg-white p-3 text-xs'>
                    <option value=''>终点人物</option>{characters.filter(actor => actor.id !== fromId).map(actor => <option key={actor.id} value={actor.id}>{actor.name}</option>)}
                </select>
                <button disabled={!graph || !fromId || !toId || fromId === toId} onClick={() => selectDirection(fromId, toId)} className='rounded-xl bg-violet-700 px-4 text-xs font-semibold text-white disabled:opacity-30'>查看 / 编辑</button>
            </div>
        </footer>
        <dialog ref={dialog} onCancel={event => { event.preventDefault(); closePair(); }} aria-label='两人关系详情'
            className='fixed inset-x-0 bottom-0 top-auto m-0 max-h-[88svh] w-full max-w-none rounded-t-3xl border-0 bg-stone-50 p-0 text-slate-800 backdrop:bg-slate-900/35'>
            {pair && <div className='story-safe-sheet mx-auto max-w-2xl px-5 pt-4'>
                <div className='mb-4 flex items-center gap-2'><h2 className='min-w-0 flex-1 text-base font-semibold'>两人的关系 · 两个独立方向</h2><button disabled={saving} onClick={closePair} aria-label='关闭关系详情' className='grid h-11 w-11 place-items-center'><X size={20} /></button></div>
                <div className='mb-5 grid grid-cols-2 gap-2'>{[pair, [pair[1], pair[0]]].map(([from, to]) => {
                    const row = graph?.directions[realRelationshipKey(from, to)];
                    return <button key={from} disabled={saving} onClick={() => selectDirection(from, to)} className={`rounded-2xl border p-3 text-left ${fromId === from ? 'border-violet-400 bg-violet-50' : 'border-stone-200 bg-white'}`}>
                        <span className='block text-xs font-semibold'>{name(from)} → {name(to)}</span><span className='mt-1 block text-[10px] text-slate-500'>{row?.identity || '尚未认定'}</span>
                        <span className='mt-2 block text-[9px] text-violet-700'>{STORY_RELATIONSHIP_AXES.map(axis => `${axis} ${row?.axes[axis]?.score ?? '未初始化'}`).join(' · ')}</span>
                    </button>;
                })}</div>
                <p className='mb-4 flex items-center gap-2 text-xs font-bold text-violet-700'>{name(fromId)}<ArrowRight size={14} />{name(toId)}</p>
                <label className='block text-xs font-semibold'>我认为对方是我的什么人<input aria-label='关系认同' value={draft.identity} maxLength={200} onChange={event => setDraft({ ...draft, identity: event.target.value })} className='mb-4 mt-2 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm font-normal' placeholder='朋友、恋人、搭档、宿敌……' /></label>
                <label className='block text-xs font-semibold'>我的第一视角关系认知<textarea aria-label='第一视角关系认知' value={draft.cognition} maxLength={2000} onChange={event => setDraft({ ...draft, cognition: event.target.value })} className='mb-4 mt-2 min-h-24 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm font-normal' placeholder='我对对方及我们关系的当前认识……' /></label>
                <div className='grid grid-cols-3 gap-3'>{STORY_RELATIONSHIP_AXES.map(axis => <label key={axis} className='text-[10px] font-semibold'>{axis} · {STORY_RELATIONSHIP_LABELS[axis]}
                    <input aria-label={axis + ' 当前数值'} type='number' min={0} max={100} step={1} value={draft[axis]} placeholder='未初始化' onChange={event => setDraft({ ...draft, [axis]: event.target.value })} className='mt-2 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm' />
                </label>)}</div>
                <p className='my-2 text-[10px] leading-5 text-slate-500'>留空表示未初始化；0 是已经确认的数值。关系称谓与三轴可以分别修改。</p>
                {current?.lastSource && <p className='mb-3 text-[10px] leading-5 text-slate-500'>最近更新：{current.lastSource.title}{current.lastSource.messageId ? ` · 楼层 ${current.lastSource.messageId}` : ''}{current.trigger ? ` · ${current.trigger}` : ''}{current.evidence ? ` · ${current.evidence}` : ''}</p>}
                {current?.lastSource.kind === 'manual' && current.lastStorySource && <p className='mb-3 text-[10px] leading-5 text-slate-500'>最近剧情来源：{current.lastStorySource.title} · 楼层 {current.lastStorySource.messageId}</p>}
                <label className='block text-xs'>修正依据<input aria-label='手动修正依据' value={draft.reason} onChange={event => setDraft({ ...draft, reason: event.target.value })} placeholder='填写本次手动修正的原因' className='mb-3 mt-2 w-full rounded-xl border border-stone-200 bg-white p-3 text-sm' /></label>
                {error && <div role='alert' className='mb-3 text-xs text-rose-700'>{error}<button onClick={() => selectDirection(fromId, toId)} className='ml-2 underline'>读取最新关系</button></div>}
                <button disabled={saving} onClick={() => void save()} className='mb-5 h-12 w-full rounded-xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-40'>{saving ? '正在保存…' : '保存这个方向'}</button>
                <details className='border-t border-stone-200 py-4'><summary className='cursor-pointer text-xs font-semibold'>变更依据与剧情来源 · {history.length} 条</summary>
                    <ol className='mt-3 space-y-3'>{history.slice(0, historyLimit).map(event => <li key={event.id} className='rounded-xl border border-stone-200 bg-white p-3 text-[10px] leading-5'>
                        <strong>{event.source.title}{event.source.messageId !== undefined ? ` · 楼层 ${event.source.messageId}` : ''}</strong>
                        {event.updates.filter(update => pair.includes(update.direction.fromId) && pair.includes(update.direction.toId)).map(update => <div key={realRelationshipKey(update.direction.fromId, update.direction.toId)}>
                            <p className='font-semibold text-violet-700'>{name(update.direction.fromId)} → {name(update.direction.toId)}</p>
                            {update.direction.identity !== undefined && <p>关系认同：{update.direction.identity || '已清空'}</p>}
                            {update.direction.cognition !== undefined && <p>第一视角：{update.direction.cognition || '已清空'}</p>}
                            <p>{[update.direction.trigger, update.direction.evidence].filter(Boolean).join(' · ')}</p>
                            {STORY_RELATIONSHIP_AXES.map(axis => {
                                const value = update.direction.axes[axis], change = event.changes?.find(item => item.fromId === update.direction.fromId && item.toId === update.direction.toId && item.axis === axis);
                                return value || change ? <p key={axis}>{axis}{change ? ` ${change.before ?? '未初始化'} → ${change.after ?? '未初始化'}` : ' 保持'}{value?.trigger ? ` · ${value.trigger}` : ''}{value?.evidence ? ` · ${value.evidence}` : ''}</p> : null;
                            })}
                        </div>)}
                    </li>)}</ol>
                    {history.length > historyLimit && <button onClick={() => setHistoryLimit(value => value + 20)} className='mt-3 min-h-11 text-xs text-violet-700'>查看更多记录</button>}
                </details>
            </div>}
        </dialog>
    </div>;
};
export default RealRelationshipNetwork;
