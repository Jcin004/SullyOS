import React, { useMemo, useState } from 'react';
import { ArrowLeft, DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import type { StoryTheaterPreset } from '../../../types';
import { shareOrDownloadFile } from '../../../utils/shareExport';
import { compileStoryPreset, makeStoryPresetFileName, parseStoryTheaterPreset } from '../../../utils/storyTheater';
import {
    convertSillyTavernStoryPreset, readSillyTavernStoryPreset, type SillyTavernStoryPresetInput,
} from '../../../utils/sillyTavernStoryPreset';
import { DEFAULT_STORY_PRESET_PROTOCOLS, STORY_PRESET_PROTOCOLS, type StoryPresetProtocolId } from '../../../utils/storyPresetProtocols';

interface Props {
    onBack: () => void;
    onImport: (preset: StoryTheaterPreset) => Promise<void>;
}

const findingLabels = { info: '说明', approximation: '近似转换', unsupported: '待适配', conflict: '冲突' };
const regexLabels = { native: '已有原生支持', 'needs-renderer': '需适配渲染', 'needs-runtime': '需适配运行时' };
const buttonClass = 'min-h-11 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold disabled:opacity-40';

export default function StoryPresetConverter({ onBack, onImport }: Props) {
    const [source, setSource] = useState<SillyTavernStoryPresetInput | null>(null);
    const [orderKey, setOrderKey] = useState('');
    const [protocols, setProtocols] = useState<StoryPresetProtocolId[]>(DEFAULT_STORY_PRESET_PROTOCOLS);
    const [disabledSourceIds, setDisabledSourceIds] = useState<string[]>([]);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const conversion = useMemo(() => source ? convertSillyTavernStoryPreset(source, { orderKey, protocols, disabledSourceIds }) : null,
        [source, orderKey, protocols, disabledSourceIds]);
    const report = conversion?.report;
    const targets = useMemo(() => new Map(conversion?.document.prompts.map(prompt => [prompt.id, prompt])), [conversion]);
    const request = useMemo(() => {
        if (!conversion) return [];
        const preset: StoryTheaterPreset = {
            id: 'preview', name: conversion.document.name, format: 'sullyos-story-preset',
            createdAt: 0, updatedAt: 0, document: conversion.document,
        };
        return compileStoryPreset({
            preset, userName: '示例用户', characterNames: ['示例角色'],
            slots: {
                actors: '［角色资料及记忆］',
                persona: '［用户身份及记忆］', scenario: '［剧情前提与事件盒］',
                worldBefore: '［角色设定前世界书］', worldAfter: '［角色设定后世界书］',
            },
            historyMessages: [{ role: 'user', content: '［历史输入］' }, { role: 'assistant', content: '［历史回复］' }],
            pendingTurn: { role: 'user', content: '［本轮输入］' },
            storyTheaterMode: 'story',
            storyTheaterValues: {
                theater_candidate_data: '［候选角色］', theater_interaction_tendencies: '［本轮交流倾向］',
                theater_previous_axes: '［最近私轴］', theater_mode_state: '示例剧情回合',
                theater_prefill: conversion.document.assistantPrefill ?? '',
            },
        }).messages;
    }, [conversion]);

    const run = async (action: () => Promise<void>) => {
        setError('');
        setBusy(true);
        try { await action(); }
        catch (failure) { setError(failure instanceof Error ? failure.message : '操作失败，请重试'); }
        finally { setBusy(false); }
    };
    const open = (file: File) => run(async () => {
        setSource(null);
        if (file.size > 5 * 1024 * 1024) throw new Error('预设文件超过 5 MB');
        const parsed = readSillyTavernStoryPreset(await file.text(), file.name);
        setOrderKey((parsed.profiles.find(profile => profile.label === '100001') ?? parsed.profiles[0])?.key ?? '');
        setProtocols(DEFAULT_STORY_PRESET_PROTOCOLS);
        setDisabledSourceIds([]);
        setSource(parsed);
    });
    const toggleProtocol = (id: StoryPresetProtocolId, enabled: boolean) => setProtocols(current => {
        if (!enabled) return current.filter(item => item !== id && (id !== 'cast' || item !== 'private-axes'));
        return id === 'private-axes' && !current.includes('cast') ? [...current, 'cast', id] : [...current, id];
    });
    const nativeJson = conversion ? JSON.stringify(conversion.document, null, 2) : '';
    const outputFileName = conversion ? makeStoryPresetFileName(conversion.document.name) : '';

    return <div className='flex h-full w-full flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header flex shrink-0 items-center gap-3 border-b border-slate-200 px-4 py-3'>
            <button type='button' onClick={onBack} disabled={busy} aria-label='返回剧情预设库' className='grid h-10 w-10 place-items-center rounded-full'><ArrowLeft size={20} /></button>
            <h1 className='text-base font-semibold'>转换酒馆预设</h1>
        </header>
        <main className='story-page-scroll flex-1 overflow-y-auto px-5 py-5 pb-24'>
            <div className='mx-auto max-w-2xl space-y-5'>
                <label className={'inline-flex cursor-pointer items-center gap-2 ' + buttonClass}>
                    <UploadSimple size={17} />{source ? '更换酒馆 JSON' : '选择酒馆 JSON'}
                    <input type='file' accept='.json,application/json' className='sr-only' disabled={busy}
                        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void open(file); }} />
                </label>
                {error && <p role='alert' className='rounded-xl bg-rose-50 p-3 text-xs text-rose-800'>{error}</p>}
                {conversion && report && source && <>
                    <section>
                        <h2 className='break-words text-lg font-semibold'>{conversion.document.name}</h2>
                        <p className='mt-1 text-xs text-slate-600'>{report.entries.length} 条源提示词 · {report.entries.filter(entry => entry.enabled).length} 条启用 · {report.regex.length} 条正则</p>
                        {source.profiles.length > 1 && <label className='mt-3 block text-xs font-semibold'>酒馆顺序表
                            <select className='ml-2 rounded-lg border border-slate-200 bg-white p-2' value={orderKey}
                                onChange={event => { setOrderKey(event.target.value); setDisabledSourceIds([]); }}>
                                {source.profiles.map(profile => <option key={profile.key} value={profile.key}>{profile.label}（{profile.entries.length} 条）</option>)}
                            </select>
                        </label>}
                    </section>
                    <fieldset className='rounded-xl border border-slate-200 bg-white p-3'>
                        <legend className='px-1 text-xs font-semibold'>SullyOS 功能协议</legend>
                        <div className='grid gap-x-3 gap-y-1 sm:grid-cols-2'>
                            {STORY_PRESET_PROTOCOLS.map(protocol => <label key={protocol.id} className='flex min-h-10 items-start gap-2 py-2 text-xs'>
                                <input type='checkbox' className='mt-0.5' checked={protocols.includes(protocol.id)} disabled={busy}
                                    onChange={event => toggleProtocol(protocol.id, event.target.checked)} />
                                <span><strong className='block'>{protocol.name}</strong><span className='mt-1 block text-slate-600'>{protocol.description}</span></span>
                            </label>)}
                        </div>
                    </fieldset>

                    <details open className='rounded-xl border border-slate-200 bg-white p-3'>
                        <summary className='cursor-pointer text-sm font-semibold'>兼容报告（{report.findings.length} 项）</summary>
                        <ul className='mt-2 max-h-64 space-y-2 overflow-auto text-xs leading-5'>
                            {report.findings.map((item, index) => <li key={index} className={item.level === 'conflict' ? 'text-rose-700' : 'text-slate-700'}>
                                <strong>{findingLabels[item.level]} · {item.area} · {item.subject}</strong> {item.detail}
                            </li>)}
                        </ul>
                    </details>
                    <details className='rounded-xl border border-slate-200 bg-white p-3'>
                        <summary className='cursor-pointer text-sm font-semibold'>正则及渲染（{report.regex.length} 条）</summary>
                        <ul className='mt-2 max-h-72 space-y-2 overflow-auto text-xs leading-5'>
                            {report.regex.map((item, index) => <li key={index}><strong>{item.name} · {item.enabled ? '源启用' : '源关闭'}</strong>
                                <div>{regexLabels[item.status]} · {item.detail}</div></li>)}
                        </ul>
                    </details>
                    <details className='rounded-xl border border-slate-200 bg-white p-3'>
                        <summary className='cursor-pointer text-sm font-semibold'>源提示词及开关</summary>
                        <div className='mt-2 max-h-96 divide-y divide-slate-200 overflow-auto'>
                            {report.entries.map(entry => <div key={entry.identifier} className='flex items-start gap-2 py-2'>
                                <details className='min-w-0 flex-1 text-xs'>
                                    <summary className='cursor-pointer break-words'>{entry.order ?? '库存'} · {entry.name} · {entry.enabled ? '启用' : '关闭'}</summary>
                                    <div className='mt-2 text-slate-600'>{entry.role}{entry.group ? ' · ' + entry.group : ''}{entry.marker ? ' · ' + entry.marker : ''}{entry.inChat ? ' · 深度 ' + entry.inChat.depth + ' · 优先级 ' + entry.inChat.order : ''}</div>
                                    <pre className='mt-2 whitespace-pre-wrap break-all text-xs'>{targets.get(entry.targetId)?.content}</pre>
                                </details>
                                {entry.sourceEnabled && entry.order !== null && !entry.marker && (entry.enabled || disabledSourceIds.includes(entry.identifier))
                                    && <input type='checkbox' checked={entry.enabled} disabled={busy} aria-label={'启用 ' + entry.name}
                                        onChange={event => {
                                            const checked = event.target.checked;
                                            setDisabledSourceIds(current => checked ? current.filter(id => id !== entry.identifier) : [...current, entry.identifier]);
                                        }} />}
                            </div>)}
                        </div>
                    </details>
                    <details className='rounded-xl border border-slate-200 bg-white p-3'>
                        <summary className='cursor-pointer text-sm font-semibold'>示例消息顺序与采样参数</summary>
                        <p className='my-2 text-xs text-slate-600'>用占位内容演示预设编排。实际请求由当前剧场填入资料和运行时规则。</p>
                        <pre className='whitespace-pre-wrap text-xs'>{JSON.stringify(report.generation, null, 2)}</pre>
                        <ol className='mt-2 max-h-72 list-inside list-decimal space-y-2 overflow-auto text-xs'>
                            {request.map((message, index) => <li key={index}><details className='inline'>
                                <summary className='inline cursor-pointer break-words'>{message.role} · {message.content.trim().slice(0, 64)}</summary>
                                <pre className='mt-2 whitespace-pre-wrap break-all'>{message.content}</pre>
                            </details></li>)}
                        </ol>
                    </details>
                    <div className='flex flex-wrap gap-2'>
                        <button type='button' disabled={busy} className={buttonClass} onClick={() => void run(async () => {
                            await shareOrDownloadFile({ content: nativeJson, fileName: outputFileName });
                        })}><DownloadSimple size={14} className='mr-1 inline' />导出剧情预设 JSON</button>
                        <button type='button' disabled={busy} className={buttonClass} onClick={() => void run(async () => {
                            await shareOrDownloadFile({ content: JSON.stringify(report, null, 2), fileName: outputFileName.replace(/\.json$/i, '.compatibility.json') });
                        })}><DownloadSimple size={14} className='mr-1 inline' />导出兼容报告</button>
                        <button type='button' disabled={busy} className='min-h-11 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white disabled:opacity-40'
                            onClick={() => void run(() => onImport(parseStoryTheaterPreset(nativeJson, outputFileName)))}>存入剧情预设库</button>
                    </div>
                </>}
            </div>
        </main>
    </div>;
}
