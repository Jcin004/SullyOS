import React, { useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, DownloadSimple, FloppyDisk, LockSimple, Plus, Trash } from '@phosphor-icons/react';
import type { StoryTheaterPreset, StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../../../types';
import {
    applyStoryPresetChoice,
    addStoryPresetGroup,
    renameStoryPresetGroup,
    ungroupStoryPresetGroup,
    moveStoryPresetPromptToGroup,
    downloadStoryPreset,
    duplicateStoryPreset,
    getStoryPresetPromptGroups,
    isProtectedStoryPrompt,
    isStoryPresetSectionMarker,
    makeStoryTheaterId,
    ensureStoryTheaterPromptSection,
    storyPresetGroupInsertIndex,
} from '../../../utils/storyTheater';
import {
    canCopyStoryPresetPrompt, canPasteIntoStoryPresetGroup, copyStoryPresetSelection,
    pasteStoryPresetClipboard, storyPresetClipboardPromptCount, undoStoryPresetPaste, type StoryPresetClipboard,
} from '../../../utils/storyPresetClipboard';

interface Props {
    preset: StoryTheaterPreset;
    clipboard: StoryPresetClipboard | null;
    onCopy: (clipboard: StoryPresetClipboard) => void;
    onBack: () => void;
    onSave: (preset: StoryTheaterPreset) => Promise<void> | void;
    onOpenCopy: (preset: StoryTheaterPreset) => Promise<void> | void;
    onDelete?: (preset: StoryTheaterPreset) => Promise<void> | void;
}

export interface StoryPresetSimpleChoice {
    label: string;
    hint: string;
    ids: readonly string[];
    options: Array<{ id?: string; label: string }>;
}

export const STORY_PRESET_SIMPLE_CHOICES: StoryPresetSimpleChoice[] = [
    {
        label: '文风', hint: '决定这场故事读起来是什么质感',
        ids: ['nmj-v3-style-custom', 'nmj-v3-style-soda', 'nmj-v3-style-corridor', 'nmj-v3-style-comedy', 'nmj-v3-style-darkcomedy', 'nmj-v3-style-syrup', 'nmj-v3-style-dullknife', 'nmj-v3-style-drama'],
        options: [{ label: '默认质感' }, { id: 'nmj-v3-style-soda', label: '汽水日常' }, { id: 'nmj-v3-style-corridor', label: '潮雨走廊' }, { id: 'nmj-v3-style-comedy', label: '荒诞喜剧' }, { id: 'nmj-v3-style-darkcomedy', label: '黑喜剧' }, { id: 'nmj-v3-style-syrup', label: '直球甜宠' }, { id: 'nmj-v3-style-dullknife', label: '钝刀虐心' }, { id: 'nmj-v3-style-drama', label: '冷峻正剧' }],
    },
    {
        label: '人称', hint: '决定镜头如何称呼你当前执笔的身份',
        ids: ['nmj-v3-pov-second', 'nmj-v3-pov-third'],
        options: [{ id: 'nmj-v3-pov-second', label: '第二人称' }, { id: 'nmj-v3-pov-third', label: '第三人称' }],
    },
    {
        label: '输入转述', hint: '你给出的构想要先拍出来，还是视作已经发生',
        ids: ['nmj-v62-retelling-replay', 'nmj-v62-retelling-direct'],
        options: [{ id: 'nmj-v62-retelling-replay', label: '回放扩写' }, { id: 'nmj-v62-retelling-direct', label: '直接接戏' }],
    },
    {
        label: '你的执笔权', hint: '故事可以替你当前执笔的身份写到什么程度',
        ids: ['nmj-v63-user-agency-locked', 'nmj-v63-user-agency-assist', 'nmj-v63-user-agency-auto'],
        options: [{ id: 'nmj-v63-user-agency-locked', label: '完全不代写' }, { id: 'nmj-v63-user-agency-assist', label: '有限协演' }, { id: 'nmj-v63-user-agency-auto', label: '全自动演绎' }],
    },
    {
        label: '场景张力', hint: '只调整当前故事的情绪压力',
        ids: ['nmj-v64-tension-lowfever-1', 'nmj-v64-tension-lowfever-2', 'nmj-v64-tension-lowfever-3'],
        options: [{ label: '自然' }, { id: 'nmj-v64-tension-lowfever-1', label: '低烧 I' }, { id: 'nmj-v64-tension-lowfever-2', label: '低烧 II' }, { id: 'nmj-v64-tension-lowfever-3', label: '低烧 III' }],
    },
    {
        label: '小剧场', hint: '正文结束后追加一段独立的边角频道',
        ids: ['nmj-v3-theater-ai', 'nmj-v3-theater-user-sim', 'nmj-v3-theater-group', 'nmj-v3-theater-random', 'nmj-v6-side-channel-terminal', 'nmj-v6-side-channel-evidence', 'nmj-v6-side-channel-public', 'nmj-v6-side-channel-wrong-reel', 'nmj-v3-theater-custom'],
        options: [{ label: '关闭' }, { id: 'nmj-v3-theater-ai', label: '角色与你' }, { id: 'nmj-v3-theater-user-sim', label: '你的倒影' }, { id: 'nmj-v3-theater-group', label: '你和角色们' }, { id: 'nmj-v3-theater-random', label: '随机换台' }, { id: 'nmj-v6-side-channel-terminal', label: '终端残响' }, { id: 'nmj-v6-side-channel-evidence', label: '失物与物证' }, { id: 'nmj-v6-side-channel-public', label: '公共频段' }, { id: 'nmj-v6-side-channel-wrong-reel', label: '错卷放映' }],
    },
    {
        label: '语言', hint: '正文使用哪一种中文',
        ids: ['nmj-v3-language-cn', 'nmj-v3-language-tw'],
        options: [{ id: 'nmj-v3-language-cn', label: '简体中文' }, { id: 'nmj-v3-language-tw', label: '繁體中文' }],
    },
    {
        label: '篇幅', hint: '每次续写的大致长度',
        ids: ['nmj-v3-length-short', 'nmj-v3-length-medium', 'nmj-v3-length-long'],
        options: [{ id: 'nmj-v3-length-short', label: '短' }, { id: 'nmj-v3-length-medium', label: '中' }, { id: 'nmj-v3-length-long', label: '长' }],
    },
];

const STORY_ROLE_LABELS: Record<StoryTheaterPresetPrompt['role'], string> = {
    system: '规则',
    user: '你',
    assistant: '正文',
};

const STORY_GENERATION_FIELDS = [
    ['temperature', '温度', 'Temperature', 0, 2, 0.05, '越低越稳定，越高越自由。Claude 只接受 0–1；预设高于 1 时，Claude 请求会自动按 1 发送。'],
    ['topP', '候选范围', 'Top P', 0, 1, 0.01, '另一种随机度控制。通常保持预设值即可，不建议和温度一起大幅调整。'],
    ['frequencyPenalty', '重复惩罚', 'Frequency penalty', -2, 2, 0.05, '正值会减少重复措辞，负值会允许更多复现。部分 Claude 中转会忽略这项。'],
    ['presencePenalty', '话题惩罚', 'Presence penalty', -2, 2, 0.05, '正值更愿意引入新内容，负值更愿意围绕已有内容继续。部分 Claude 中转会忽略这项。'],
    ['maxTokens', '最大输出', 'Max tokens', 256, 32000, 256, '只限制本轮最多能生成多少，不代表每次一定写满；篇幅仍主要由上面的“篇幅”选项决定。'],
] as const;

const toggleSelection = (ids: string[], id: string) => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];

const StoryPresetMaker: React.FC<Props> = ({ preset, clipboard, onCopy, onBack, onSave, onOpenCopy, onDelete }) => {
    const [draft, setDraft] = useState<StoryTheaterPreset>(() => ({
        ...preset,
        document: { ...ensureStoryTheaterPromptSection(preset.document), generation: { ...preset.document.generation }, prompts: ensureStoryTheaterPromptSection(preset.document).prompts.map(item => ({ ...item })) },
    }));
    const [mode, setMode] = useState<'simple' | 'pro'>('simple');
    const [activeGroupKey, setActiveGroupKey] = useState<string | null>(null);
    const [selectedId, setSelectedId] = useState('');
    const [saving, setSaving] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    const [checkedPromptIds, setCheckedPromptIds] = useState<string[]>([]);
    const [checkedGroupKeys, setCheckedGroupKeys] = useState<string[]>([]);
    const [notice, setNotice] = useState('');
    const [pasteOpen, setPasteOpen] = useState(false);
    const [pasteGroupKey, setPasteGroupKey] = useState('');
    const page = useRef<HTMLElement>(null);
    const [lastPasteIds, setLastPasteIds] = useState<string[]>([]);
    const readOnly = preset.builtIn === true;
    const groups = useMemo(() => getStoryPresetPromptGroups(draft.document), [draft.document]);
    const activeGroup = groups.find(group => group.key === activeGroupKey) || null;
    const activePrompts = useMemo(() => {
        if (!activeGroup) return [];
        const ids = new Set(activeGroup.promptIds);
        return draft.document.prompts.filter(prompt => ids.has(prompt.id) && !isStoryPresetSectionMarker(prompt));
    }, [activeGroup, draft.document.prompts]);
    const selected = activePrompts.find(prompt => prompt.id === selectedId) || null;
    const pasteGroups = groups.filter(canPasteIntoStoryPresetGroup);
    const pasteGroup = pasteGroups.find(group => group.key === pasteGroupKey) ?? pasteGroups[0];
    const clipboardCount = clipboard ? storyPresetClipboardPromptCount(clipboard) : 0;
    const clipboardGroupCount = clipboard?.kind === 'groups' ? clipboard.batches.length : 0;
    const checkedPrompts = draft.document.prompts.filter(prompt => canCopyStoryPresetPrompt(prompt) && checkedPromptIds.includes(prompt.id));
    const checkedGroups = groups.filter(group => checkedGroupKeys.includes(group.key));
    const pastedDepthCount = clipboard && draft.document.promptLayout !== 'ordered'
        ? clipboard.batches.reduce((count, batch) => count + batch.prompts.filter(prompt => prompt.inChat).length, 0) : 0;

    const replaceDocument = (document: StoryTheaterPresetDocument) => setDraft(current => ({ ...current, name: document.name, document, updatedAt: Date.now() }));
    const patchDocument = (patch: Partial<StoryTheaterPresetDocument>) => replaceDocument({ ...draft.document, ...patch });

    const copySelection = (kind: 'groups' | 'prompts', ids: string[]) => {
        const next = copyStoryPresetSelection(draft.document, { kind, ids });
        const count = storyPresetClipboardPromptCount(next);
        if (next.batches.length) {
            onCopy(next);
            if (kind === 'groups') setCheckedGroupKeys([]);
            else setCheckedPromptIds([]);
        }
        const copied = next.batches.length
            ? `已复制 ${kind === 'groups' ? `${next.batches.length} 个分类、` : ''}${count} 条提示词`
            : '当前选择没有可复制的提示词';
        setNotice(copied + (next.skipped ? `，跳过 ${next.skipped} 条受保护提示词` : '')
            + (next.flattened ? '。按当前分类列表展平，粘贴前可预览。' : ''));
    };

    const openPaste = () => {
        setPasteGroupKey(pasteGroups.find(group => group.key === activeGroupKey)?.key ?? pasteGroups[0]?.key ?? '');
        setPasteOpen(true);
        if (page.current) page.current.scrollTop = 0;
    };

    const paste = (target: Parameters<typeof pasteStoryPresetClipboard>[2]) => {
        if (readOnly || !clipboard) return;
        const result = pasteStoryPresetClipboard(draft.document, clipboard, target);
        if (!result) return;
        replaceDocument(result.document);
        setMode('pro');
        setActiveGroupKey(target.kind === 'new' && clipboard.batches.length > 1 ? null : result.firstGroupKey ?? null);
        setSelectedId('');
        setLastPasteIds(result.addedIds);
        setPasteOpen(false);
        setNotice(`已粘贴 ${clipboardCount} 条提示词${target.kind === 'new' ? `到 ${clipboard.batches.length} 个新分类` : ''}`);
    };

    const undoPaste = () => {
        const document = undoStoryPresetPaste(draft.document, lastPasteIds);
        replaceDocument(document);
        if (!getStoryPresetPromptGroups(document).some(group => group.key === activeGroupKey)) setActiveGroupKey(null);
        if (lastPasteIds.includes(selectedId)) setSelectedId('');
        setLastPasteIds([]);
        setPasteOpen(false);
        setNotice('已撤销本次粘贴');
    };
    const patchPrompt = (id: string, patch: Partial<StoryTheaterPresetPrompt>) => patchDocument({
        prompts: draft.document.prompts.map(prompt => prompt.id === id ? { ...prompt, ...patch } : prompt),
    });
    const selectSimpleChoice = (choice: StoryPresetSimpleChoice, id?: string) => {
        if (readOnly) return;
        replaceDocument(applyStoryPresetChoice(draft.document, choice.ids, id));
    };
    const moveGroup = (key: string, direction: -1 | 1) => {
        if (readOnly) return;
        const ordered = [...groups];
        const index = ordered.findIndex(group => group.key === key);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= ordered.length) return;
        [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
        const byId = new Map(draft.document.prompts.map(prompt => [prompt.id, prompt]));
        patchDocument({ prompts: ordered.flatMap(group => group.promptIds.map(id => byId.get(id)).filter((prompt): prompt is StoryTheaterPresetPrompt => Boolean(prompt))) });
    };
    const movePrompt = (id: string, direction: -1 | 1) => {
        const index = activePrompts.findIndex(prompt => prompt.id === id);
        const target = index + direction;
        if (readOnly || index < 0 || target < 0 || target >= activePrompts.length) return;
        const prompts = [...draft.document.prompts];
        const fromIndex = prompts.findIndex(prompt => prompt.id === id);
        const toIndex = prompts.findIndex(prompt => prompt.id === activePrompts[target].id);
        [prompts[fromIndex], prompts[toIndex]] = [prompts[toIndex], prompts[fromIndex]];
        patchDocument({ prompts });
    };
    const addPrompt = () => {
        if (!activeGroup || activeGroup.protected || readOnly) return;
        const next: StoryTheaterPresetPrompt = { id: makeStoryTheaterId(), name: '新提示词', enabled: true, role: 'system', content: '', ...(activeGroup.key === 'theater' ? { scope: 'story_theater_story' as const } : {}) };
        const prompts = [...draft.document.prompts];
        prompts.splice(storyPresetGroupInsertIndex(draft.document, activeGroup), 0, next);
        patchDocument({ prompts });
        setSelectedId(next.id);
    };
    const addGroup = () => {
        if (readOnly || !newGroupName.trim()) return;
        const document = addStoryPresetGroup(draft.document, newGroupName);
        replaceDocument(document);
        const added = getStoryPresetPromptGroups(document).at(-1);
        setActiveGroupKey(added?.key || null);
        setSelectedId('');
        setNewGroupName('');
    };
    const removePrompt = (id: string) => {
        const prompt = draft.document.prompts.find(item => item.id === id);
        if (!prompt || readOnly || isProtectedStoryPrompt(prompt)) return;
        patchDocument({ prompts: draft.document.prompts.filter(item => item.id !== id) });
        if (selectedId === id) setSelectedId('');
    };
    const save = async () => {
        if (readOnly) { await onOpenCopy(duplicateStoryPreset(draft)); return; }
        setSaving(true);
        try { await onSave({ ...draft, name: draft.document.name.trim() || '未命名剧情预设', updatedAt: Date.now() }); }
        finally { setSaving(false); }
    };

    const renderGenerationFields = () => <>
        <div className='mt-5 divide-y divide-slate-200 border-y border-slate-200'>
            {STORY_GENERATION_FIELDS.map(([key, label, technicalLabel, min, max, step, help]) => <label key={key} className='block py-4'>
                <span className='flex items-center gap-4'><span className='min-w-0 flex-1'><strong className='block text-xs text-slate-700'>{label}</strong><span className='mt-0.5 block text-[8px] uppercase tracking-wide text-slate-400'>{technicalLabel}</span></span><input disabled={readOnly} type='number' min={min} max={max} step={step} value={draft.document.generation[key]} onChange={event => patchDocument({ generation: { ...draft.document.generation, [key]: Number(event.target.value) } })} className='w-24 shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-right text-sm font-semibold outline-none disabled:opacity-50' /></span>
                <span className='mt-2 block text-[9px] leading-4 text-slate-400'>{help}</span>
            </label>)}
        </div>
        {draft.document.generation.temperature > 1 && <p className='mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-5 text-amber-800'>当前温度高于 1：OpenAI 类模型会保留这个值；使用 Claude 时会自动按 1.0 发送，避免第三方中转直接返回 400。</p>}
    </>;

    const renderGeneration = () => <section>
        <button onClick={() => setActiveGroupKey(null)} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
        <div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h2 className='mt-1 text-2xl font-serif font-semibold'>续写参数</h2>
        <p className='mt-2 text-[10px] leading-5 text-slate-500'>这些值会跟着预设保存。一般保持原值；接口报参数错误时再按提示调整。</p>
        {renderGenerationFields()}
        <label className='block mt-4'><span className='text-[10px] text-slate-500'>正文起笔</span><textarea disabled={readOnly} value={draft.document.assistantPrefill || ''} onChange={event => patchDocument({ assistantPrefill: event.target.value })} className='mt-1 w-full min-h-24 p-3 rounded-xl bg-white border border-slate-200 font-mono text-[11px] disabled:opacity-50' /></label>
    </section>;

    const renderGroupDetails = () => {
        if (!activeGroup) return null;
        return <section>
            <button onClick={() => { setActiveGroupKey(null); setSelectedId(''); }} className='mb-5 text-[10px] font-bold text-violet-600'>← 返回大分类</button>
            <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0'><h2 className='break-words text-2xl font-serif font-semibold'>{activeGroup.label}</h2>
                    <p className='mt-2 text-[10px] leading-5 text-slate-500'>{activeGroup.description}</p>
                </div>
                <button type='button' onClick={() => copySelection('groups', [activeGroup.key])} className='flex min-h-9 shrink-0 items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-semibold'>
                    <Copy size={14} />复制整个分类
                </button>
            </div>
            {activeGroup.protected && <div className='mt-5 p-4 rounded-2xl bg-amber-50 border border-amber-200 text-[11px] leading-6 text-amber-800'>这里是糯米机连接角色、你的身份、世界书与历史的骨架。可以上下调整发送顺序，但不能修改内容、开关、消息位置或类型，也不能删除。</div>}
            {activeGroup.customSectionId && !readOnly && <div className='mt-5 space-y-3'>
                <label className='block text-xs text-slate-500'>分组名称<input aria-label='分组名称' value={activeGroup.label} onChange={event => replaceDocument(renameStoryPresetGroup(draft.document, activeGroup.customSectionId!, event.target.value))} onBlur={event => replaceDocument(renameStoryPresetGroup(draft.document, activeGroup.customSectionId!, event.target.value.trim() || '自定义分组'))} className='mt-2 w-full p-3 rounded-xl bg-white border border-slate-200 text-slate-800' /></label>
                <button onClick={() => { replaceDocument(ungroupStoryPresetGroup(draft.document, activeGroup.customSectionId!)); setActiveGroupKey(null); setSelectedId(''); }} className='text-xs text-slate-500 underline'>取消分组，保留所有条目</button>
            </div>}
            <div className='mt-5 border-y border-slate-200 divide-y divide-slate-200'>
                {activePrompts.map((prompt, index) => {
                    const locked = activeGroup.protected || isProtectedStoryPrompt(prompt);
                    const copyable = canCopyStoryPresetPrompt(prompt);
                    return <div key={prompt.id} className={`flex items-center gap-1.5 py-3 ${selectedId === prompt.id ? 'text-violet-700' : ''}`}>
                    {copyable && <input type='checkbox' aria-label={`多选提示词 ${prompt.name}`} checked={checkedPromptIds.includes(prompt.id)}
                        onChange={() => setCheckedPromptIds(current => toggleSelection(current, prompt.id))} className='shrink-0 accent-violet-600' />}
                    <button disabled={readOnly || locked} onClick={() => patchPrompt(prompt.id, { enabled: !prompt.enabled })} className={`w-9 shrink-0 text-[9px] font-bold disabled:opacity-50 ${prompt.enabled ? 'text-emerald-600' : 'text-slate-300'}`}>{prompt.enabled ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setSelectedId(prompt.id)} className='min-w-0 flex-1 text-left'><span className='block text-xs font-semibold truncate'>{index + 1}. {prompt.name}</span><span className='block mt-1 text-[9px] text-slate-400'>{locked ? '系统连接位 · 内容锁定' : prompt.scope === 'story_only' ? '剧情回合' : prompt.scope ? '出演模式动态提示词' : prompt.inChat ? `历史深度 ${prompt.inChat.depth} · ${STORY_ROLE_LABELS[prompt.role]}` : STORY_ROLE_LABELS[prompt.role]}</span></button>
                    {copyable && <button type='button' onClick={() => copySelection('prompts', [prompt.id])} title='复制提示词'
                        aria-label={`复制提示词 ${prompt.name}`} className='grid h-9 w-8 shrink-0 place-items-center text-violet-700'><Copy size={15} /></button>}
                    {!readOnly && <span className='flex shrink-0'><button disabled={index === 0} onClick={() => movePrompt(prompt.id, -1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowUp size={14} /></button><button disabled={index === activePrompts.length - 1} onClick={() => movePrompt(prompt.id, 1)} className='p-1.5 text-slate-400 disabled:opacity-20'><ArrowDown size={14} /></button>{!locked && <button onClick={() => removePrompt(prompt.id)} className='p-1.5 text-rose-400'><Trash size={14} /></button>}</span>}
                </div>; })}
            </div>
            {!activeGroup.protected && !readOnly && <button onClick={addPrompt} className='mt-4 h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-bold flex items-center gap-1'><Plus size={14} />在本区新增提示词</button>}
            {selected && <div className='mt-7 pt-6 border-t border-slate-200'>
                {activeGroup.protected || isProtectedStoryPrompt(selected) ? <div className='py-8 text-center'><LockSimple size={28} className='mx-auto text-amber-400' /><div className='mt-2 text-xs font-bold'>系统连接内容已锁定</div><p className='mt-1 text-[10px] text-slate-400'>你仍可以在上方调整它与其他连接位的顺序。</p></div> : <>
                    <div className='grid grid-cols-2 gap-3'><label><span className='text-[10px] text-slate-500'>名称</span><input disabled={readOnly} value={selected.name} onChange={event => patchPrompt(selected.id, { name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs' /></label><label><span className='text-[10px] text-slate-500'>消息位置</span><select disabled={readOnly} value={selected.role} onChange={event => patchPrompt(selected.id, { role: event.target.value as StoryTheaterPresetPrompt['role'] })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-xs'><option value='system'>规则</option><option value='user'>你</option><option value='assistant'>正文</option></select></label></div>
                    <textarea disabled={readOnly} value={selected.content} onChange={event => patchPrompt(selected.id, { content: event.target.value })} className='mt-3 w-full min-h-64 p-4 rounded-2xl bg-white border border-slate-200 font-mono text-[11px] leading-6 resize-y' placeholder='支持 {{user}} / {{char}} / {{group}} / {{theater_mode_state}} / {{theater_cast_data}} / {{theater_candidate_data}} / {{theater_interaction_tendencies}} / {{theater_previous_interactions}} / {{theater_unrealized_tendencies}} / {{theater_prefill}} / {{theater_previous_axes}}' />
                    {!readOnly && <label className='mt-3 block text-xs text-slate-500'>移动到分组<select aria-label='移动到分组' value='' onChange={event => { const target = event.target.value; if (!target) return; replaceDocument(moveStoryPresetPromptToGroup(draft.document, selected.id, target)); setActiveGroupKey(target); }} className='mt-2 w-full p-3 rounded-xl bg-white border border-slate-200'><option value=''>选择目标分组</option>{groups.filter(group => !group.protected && group.key !== activeGroup.key).map(group => <option key={group.key} value={group.key}>{group.label}</option>)}</select></label>}
                </>}
            </div>}
        </section>;
    };

    const renderPaste = () => clipboard && pasteOpen && <section id='paste-story-preset' role='dialog' aria-labelledby='paste-story-preset-title'
        onKeyDown={event => { if (event.key === 'Escape') setPasteOpen(false); }}
        className='mb-5 space-y-3 rounded-2xl border border-violet-200 bg-white p-4'>
        <h2 id='paste-story-preset-title' className='text-sm font-semibold'>粘贴提示词</h2>
        {clipboard.flattened && <p className='text-xs leading-5 text-slate-600'>源预设包含嵌套或未识别的分组。以下是按当前编辑器展平的分类。</p>}
        {!!clipboardGroupCount && <ul className='max-h-28 space-y-1 overflow-auto text-xs text-slate-700'>
            {clipboard.batches.map((batch, index) => <li key={index}>{batch.name}（{batch.prompts.length} 条）</li>)}
        </ul>}
        {clipboard.skipped > 0 && <p className='text-xs text-slate-600'>复制时已跳过 {clipboard.skipped} 条受保护提示词。</p>}
        {pastedDepthCount > 0 && <p className='text-xs leading-5 text-slate-600'>目标预设使用相对顺序，{pastedDepthCount} 条带历史深度的提示词将按分类中的位置发送。</p>}
        <button type='button' autoFocus onClick={() => paste({ kind: 'new' })} className='min-h-10 w-full rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white'>
            {clipboardGroupCount > 1 ? `粘贴为 ${clipboardGroupCount} 个新分类` : '粘贴为新分类'}
        </button>
        {!!clipboardCount && pasteGroup && <div className='flex flex-wrap gap-2'>
            <select aria-label='粘贴到的分类' value={pasteGroup.key} onChange={event => setPasteGroupKey(event.target.value)}
                className='min-h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-xs'>
                {pasteGroups.map(group => <option key={group.key} value={group.key}>{group.label}</option>)}
            </select>
            <button type='button' onClick={() => paste({ kind: 'existing', groupKey: pasteGroup.key })}
                className='min-h-10 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-semibold'>追加到所选分类</button>
        </div>}
        <button type='button' onClick={() => setPasteOpen(false)} className='min-h-9 text-xs font-semibold text-slate-600'>取消粘贴</button>
    </section>;

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={onBack} aria-label='返回' className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.24em] font-bold text-violet-500'>Preset maker</div><div className='font-semibold truncate'>预设制作器</div></div>
                {readOnly && <span className='hidden sm:inline-flex text-[9px] px-2 py-1 rounded-full bg-amber-100 text-amber-700 font-bold'>内置只读</span>}
                <button onClick={() => { void downloadStoryPreset(draft); }} className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center' title='导出糯米机原生预设'><DownloadSimple size={16} /></button>
                <button onClick={save} className='h-9 px-3 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5'>{readOnly ? <Copy size={14} /> : <FloppyDisk size={14} />}{readOnly ? '复制调整' : saving ? '保存中' : '保存'}</button>
            </div>
            <div className='mx-5 mb-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                <button onClick={() => { setMode('simple'); setActiveGroupKey(null); }} className={`py-2 rounded-lg text-xs font-bold ${mode === 'simple' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>默认版</button>
                <button onClick={() => setMode('pro')} className={`py-2 rounded-lg text-xs font-bold ${mode === 'pro' ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>专业版</button>
            </div>
            {(clipboard || notice || lastPasteIds.length > 0 || (mode === 'pro' && (checkedGroups.length > 0 || checkedPrompts.length > 0)))
                && <div className='mx-5 mb-3 space-y-2 rounded-xl border border-slate-200 bg-white px-3 py-2'>
                    <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                        {clipboard && <span className='text-slate-600'>剪贴板 · {clipboardGroupCount ? `${clipboardGroupCount} 个分类、` : ''}{clipboardCount} 条提示词</span>}
                        {clipboard && !readOnly && <button type='button' onClick={openPaste} aria-expanded={pasteOpen} aria-controls={pasteOpen ? 'paste-story-preset' : undefined}
                            className='min-h-9 font-semibold text-violet-700'>粘贴</button>}
                        {lastPasteIds.length > 0 && <button type='button' onClick={undoPaste}
                            className='min-h-9 font-semibold text-violet-700'>撤销本次粘贴</button>}
                        {mode === 'pro' && checkedPrompts.length > 0 && <button type='button' onClick={() => copySelection('prompts', checkedPrompts.map(prompt => prompt.id))}
                            className='min-h-9 font-semibold text-violet-700'>复制所选提示词（{checkedPrompts.length}）</button>}
                        {mode === 'pro' && checkedGroups.length > 0 && <button type='button' onClick={() => copySelection('groups', checkedGroups.map(group => group.key))}
                            className='min-h-9 font-semibold text-violet-700'>复制所选分类（{checkedGroups.length}）</button>}
                    </div>
                    {notice && <p role='status' className='text-xs leading-5 text-slate-700'>{notice}</p>}
                </div>}
        </header>

        <main ref={page} className='story-page-scroll flex-1 overflow-y-auto px-5 py-6 pb-24'>
            <div className='max-w-2xl mx-auto'>
                {renderPaste()}
                {mode === 'simple' ? <>
                    <section className='pb-5 border-b border-slate-200'><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Easy controls</div><h1 className='mt-1 text-3xl font-serif font-semibold'>只调看得懂的部分</h1><p className='mt-3 text-[11px] leading-6 text-slate-500'>角色、世界书、历史注入和底层发送结构由糯米机照管。这里的选择不会修改角色档案。</p>{readOnly && <p className='mt-3 text-[10px] text-amber-700'>这是内置原版。点右上角“复制调整”后即可保存你的选择。</p>}</section>
                    <div className='divide-y divide-slate-200'>{STORY_PRESET_SIMPLE_CHOICES.filter(choice => choice.ids.some(id => draft.document.prompts.some(prompt => prompt.id === id))).map(choice => {
                        const active = choice.ids.find(id => draft.document.prompts.find(prompt => prompt.id === id)?.enabled);
                        return <section key={choice.label} className='py-6'><h2 className='text-sm font-bold'>{choice.label}</h2><p className='mt-1 text-[10px] text-slate-400'>{choice.hint}</p><div className='mt-3 flex flex-wrap gap-2'>{choice.options.map(option => { const selectedOption = option.id ? active === option.id : !active; return <button key={option.id || 'default'} disabled={readOnly} onClick={() => selectSimpleChoice(choice, option.id)} className={`px-3 py-2 rounded-full border text-[11px] font-semibold disabled:opacity-60 ${selectedOption ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600'}`}>{option.label}</button>; })}</div></section>;
                    })}</div>
                    <section className='py-6 border-t border-slate-200'><h2 className='text-sm font-bold'>续写参数</h2><p className='mt-1 text-[10px] leading-5 text-slate-400'>跟着这份预设保存；看不懂时保持原值即可。</p>{renderGenerationFields()}</section>
                    {!readOnly && <section className='pt-5 border-t border-slate-200'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-2 w-full px-3 py-3 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                </> : activeGroupKey === '__generation__' ? renderGeneration() : activeGroup ? renderGroupDetails() : <>
                    <section className='pb-5 border-b border-slate-200'><div className='text-[9px] uppercase tracking-[.22em] font-bold text-violet-500'>Professional</div><h1 className='mt-1 text-3xl font-serif font-semibold'>先选大区，再看细节</h1><p className='mt-3 text-[11px] leading-6 text-slate-500'>手机上一次只展开一个区。上下箭头移动整区；进入大区后才会显示内部条目。</p></section>
                    {!readOnly && <div className='flex gap-2 py-4'><input aria-label='新分组名称' value={newGroupName} onChange={event => setNewGroupName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addGroup(); }} placeholder='新分组名称' className='min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs' /><button disabled={!newGroupName.trim()} onClick={addGroup} className='shrink-0 flex items-center gap-1 rounded-xl bg-slate-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-40'><Plus size={14} />新增分组</button></div>}
                    <div className='divide-y divide-slate-200'>{groups.map((group, index) => {
                        const groupPrompts = draft.document.prompts.filter(prompt => group.promptIds.includes(prompt.id) && !isStoryPresetSectionMarker(prompt));
                        const enabled = groupPrompts.filter(prompt => prompt.enabled).length;
                        return <div key={group.key} className='flex items-center gap-1.5 py-4'>
                            <input type='checkbox' aria-label={`多选分类 ${group.label}`} checked={checkedGroupKeys.includes(group.key)}
                                onChange={() => setCheckedGroupKeys(current => toggleSelection(current, group.key))} className='shrink-0 accent-violet-600' />
                            <button onClick={() => { setActiveGroupKey(group.key); setSelectedId(''); }} className='min-w-0 flex-1 text-left'>
                                <span className='flex items-center gap-2'><strong className='break-words text-sm'>{group.label}</strong>{group.protected && <LockSimple size={13} className='text-amber-500' />}</span>
                                <span className='mt-1 block truncate text-[10px] text-slate-500'>{group.description}</span>
                                <span className='mt-1 block text-[9px] text-violet-500'>{enabled}/{groupPrompts.length} 条启用</span>
                            </button>
                            <button type='button' onClick={() => copySelection('groups', [group.key])} title='复制整个分类'
                                aria-label={`复制整个分类 ${group.label}`} className='grid h-9 w-8 shrink-0 place-items-center text-violet-700'><Copy size={16} /></button>
                            {!readOnly && <span className='flex shrink-0'>
                                <button disabled={index === 0} onClick={() => moveGroup(group.key, -1)} aria-label={`上移分类 ${group.label}`} className='p-2 text-slate-400 disabled:opacity-20'><ArrowUp size={15} /></button>
                                <button disabled={index === groups.length - 1} onClick={() => moveGroup(group.key, 1)} aria-label={`下移分类 ${group.label}`} className='p-2 text-slate-400 disabled:opacity-20'><ArrowDown size={15} /></button>
                            </span>}
                        </div>;
                    })}<button onClick={() => setActiveGroupKey('__generation__')} className='w-full py-5 text-left'><strong className='text-sm'>续写参数</strong><span className='block mt-1 text-[10px] text-slate-400'>Temperature、Top P、惩罚项与最大输出</span></button></div>
                    {!readOnly && <section className='pt-6 border-t border-slate-200 grid gap-3 sm:grid-cols-2'><label><span className='text-[10px] font-bold text-slate-500'>预设名称</span><input value={draft.document.name} onChange={event => patchDocument({ name: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label><label><span className='text-[10px] font-bold text-slate-500'>说明</span><input value={draft.document.description || ''} onChange={event => patchDocument({ description: event.target.value })} className='mt-1 w-full px-3 py-2.5 rounded-xl bg-white border border-slate-200 text-sm' /></label></section>}
                    {!readOnly && onDelete && <button onClick={() => onDelete(draft)} className='mt-8 w-full py-3 text-xs font-bold text-rose-500'>删除这个预设</button>}
                </>}
            </div>
        </main>
    </div>;
};

export default StoryPresetMaker;
