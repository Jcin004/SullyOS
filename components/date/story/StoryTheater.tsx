import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readShareFile } from '../../../utils/pngShare';
import { Archive, ArrowLeft, CaretRight, Database, DotsThree, DownloadSimple, FolderSimple, FolderSimplePlus, Plus, SpinnerGap, UploadSimple, UsersThree, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import TokenImg from '../../os/TokenImg';
import type { StoryTheaterEntry, StoryTheaterMask, StoryTheaterMaskSelection, StoryTheaterPreset } from '../../../types';
import { DB } from '../../../utils/db';
import {
    BUILTIN_NIGHT_SCREENING_PRESET,
    createBlankStoryPreset,
    createStoryTheaterDraft,
    downloadStoryPreset,
    normalizeStoryTheater,
    parseStoryTheaterPreset,
    dedupeTheaterWorldbooks,
    resolveStoryTheaterMask,
    storyTheaterThreadId,
    withBuiltInStoryPresets,
} from '../../../utils/storyTheater';
import StoryMaskBox from './StoryMaskBox';
import StoryPresetMaker from './StoryPresetMaker';
import { archiveStoryManually } from '../../../utils/storyTheaterArchive';
import StoryTheaterEditor from './StoryTheaterEditor';
import StoryTheaterSession from './StoryTheaterSession';
import StoryVectorMemoryPanel from './StoryVectorMemoryPanel';
import StoryArchivePanel from './StoryArchivePanel';
import { StoryAppearanceButton, StoryTheaterThemeProvider } from './StoryTheaterTheme';
import { deleteStoryTheaterData } from '../../../utils/storyTheaterDeletion';
import { getStoryFolder, loadStoryLibrary, moveStoryInLibrary, saveStoryLibrary, type StoryLibrary } from '../../../utils/storyTheaterLibrary';
import StoryLibraryDialog, { type StoryLibraryAction } from './StoryLibraryDialog';

interface Props {
    onSwitchCompanion?: () => void;
    onClose: () => void;
}

type View = 'list' | 'editor' | 'session' | 'preset' | 'masks' | 'vectors' | 'archives';

const StoryTheaterContent: React.FC<Props> = ({ onSwitchCompanion, onClose }) => {
    const { characters, userProfile, addToast, remoteVectorConfig, apiConfig } = useOS();
    const [view, setView] = useState<View>('list');
    const [entries, setEntries] = useState<StoryTheaterEntry[]>([]);
    const [customPresets, setCustomPresets] = useState<StoryTheaterPreset[]>([]);
    const [masks, setMasks] = useState<StoryTheaterMask[]>([]);
    const [activeEntry, setActiveEntry] = useState<StoryTheaterEntry | null>(null);
    const [editingPreset, setEditingPreset] = useState<StoryTheaterPreset | null>(null);
    const [maskLocked, setMaskLocked] = useState(false);
    const [deletingEntry, setDeletingEntry] = useState<StoryTheaterEntry | null>(null);
    const [deletingStory, setDeletingStory] = useState(false);
    const [library, setLibrary] = useState(loadStoryLibrary);
    const [folderId, setFolderId] = useState<string | null>(null);
    const [libraryAction, setLibraryAction] = useState<StoryLibraryAction | null>(null);
    const libraryScroll = useRef<HTMLElement>(null);
    const importInput = useRef<HTMLInputElement>(null);
    const presets = useMemo(() => withBuiltInStoryPresets(customPresets), [customPresets]);
    const currentFolder = library.folders.find(folder => folder.id === folderId);
    const parentFolder = library.folders.find(folder => folder.id === currentFolder?.parentId);
    const visibleFolders = library.folders.filter(folder => folder.parentId === folderId);
    const visibleEntries = entries.filter(entry => getStoryFolder(library, entry.id) === folderId);

    const updateLibrary = useCallback((update: (current: StoryLibrary) => StoryLibrary) => {
        try {
            const next = update(loadStoryLibrary());
            saveStoryLibrary(next);
            setLibrary(next);
            return true;
        } catch {
            addToast('文件夹更改未保存，请重试', 'error');
            return false;
        }
    }, [addToast]);

    const closeLibraryDialog = useCallback(() => setLibraryAction(null), []);
    const openFolder = (id: string | null) => {
        setFolderId(id);
        if (libraryScroll.current) libraryScroll.current.scrollTop = 0;
    };
    const startStory = () => {
        setMaskLocked(false);
        setActiveEntry({ ...createStoryTheaterDraft(), presetId: presets[0]?.id });
        setView('editor');
    };

    const reload = useCallback(async () => {
        const [storedEntries, storedPresets, storedMasks] = await Promise.all([DB.getStoryTheaters(), DB.getStoryTheaterPresets(), DB.getStoryTheaterMasks()]);
        setEntries(storedEntries.map(normalizeStoryTheater).sort((a, b) => b.updatedAt - a.updatedAt));
        setCustomPresets(storedPresets.filter(preset => !preset.builtIn).sort((a, b) => b.updatedAt - a.updatedAt));
        setMasks(storedMasks.sort((a, b) => b.updatedAt - a.updatedAt));
    }, []);

    useEffect(() => { void reload(); }, [reload]);

    const importPreset = useCallback(async (file: File): Promise<StoryTheaterPreset | null> => {
        try {
            const source = await readShareFile(file, 'story');
            const imported = parseStoryTheaterPreset(await source.text(), source.name);
            await DB.saveStoryTheaterPreset(imported);
            setCustomPresets(current => [imported, ...current.filter(item => item.id !== imported.id)]);
            addToast(`已导入糯米机剧情预设「${imported.name}」`, 'success');
            return imported;
        } catch (error: any) {
            addToast(error?.message || '预设导入失败', 'error');
            return null;
        }
    }, [addToast]);

    const saveEntry = useCallback(async (next: StoryTheaterEntry) => {
        const normalized = normalizeStoryTheater(next);
        await DB.saveStoryTheater(normalized);
        if (folderId && !entries.some(entry => entry.id === normalized.id)) {
            updateLibrary(current => moveStoryInLibrary(current, normalized.id, folderId));
        }
        setEntries(current => [normalized, ...current.filter(item => item.id !== normalized.id)].sort((a, b) => b.updatedAt - a.updatedAt));
        setActiveEntry(normalized);
        setView('session');
    }, [entries, folderId, updateLibrary]);

    const persistEntryInSession = useCallback(async (next: StoryTheaterEntry) => {
        const normalized = normalizeStoryTheater(next);
        await DB.saveStoryTheater(normalized);
        setActiveEntry(normalized);
        setEntries(current => [normalized, ...current.filter(item => item.id !== normalized.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    }, []);

    const savePreset = useCallback(async (next: StoryTheaterPreset) => {
        if (next.builtIn) return;
        await DB.saveStoryTheaterPreset(next);
        setCustomPresets(current => [next, ...current.filter(item => item.id !== next.id)]);
        setEditingPreset(next);
        addToast('剧情预设已保存', 'success');
    }, [addToast]);

    const copyPreset = useCallback(async (copy: StoryTheaterPreset) => {
        await DB.saveStoryTheaterPreset(copy);
        setCustomPresets(current => [copy, ...current.filter(item => item.id !== copy.id)]);
        setEditingPreset(copy);
        addToast('已复制为可编辑的糯米机预设', 'success');
    }, [addToast]);

    const deletePreset = useCallback(async (preset: StoryTheaterPreset) => {
        await DB.deleteStoryTheaterPreset(preset.id);
        setCustomPresets(current => current.filter(item => item.id !== preset.id));
        setEditingPreset(null);
        setView(activeEntry ? 'editor' : 'list');
        addToast('预设已删除；使用它的剧情会回退到内置预设', 'info');
    }, [activeEntry, addToast]);

    const saveMask = useCallback(async (mask: StoryTheaterMask) => {
        const next = { ...mask, name: mask.name.trim(), updatedAt: Date.now() };
        await DB.saveStoryTheaterMask(next);
        setMasks(current => [next, ...current.filter(item => item.id !== next.id)]);
        addToast('原创身份已放进面具箱', 'success');
    }, [addToast]);

    const deleteMask = useCallback(async (mask: StoryTheaterMask) => {
        await DB.deleteStoryTheaterMask(mask.id);
        setMasks(current => current.filter(item => item.id !== mask.id));
        if (activeEntry?.mask?.type === 'custom' && activeEntry.mask.id === mask.id) {
            setActiveEntry({ ...activeEntry, mask: { type: 'user' }, updatedAt: Date.now() });
        }
        addToast('原创身份已移出面具箱', 'info');
    }, [activeEntry, addToast]);

    const confirmDeleteEntry = useCallback(async () => {
        if (!deletingEntry || deletingStory) return;
        setDeletingStory(true);
        try {
            const result = await deleteStoryTheaterData(deletingEntry, remoteVectorConfig);
            setEntries(current => current.filter(item => item.id !== deletingEntry.id));
            if (getStoryFolder(library, deletingEntry.id)) {
                updateLibrary(current => moveStoryInLibrary(current, deletingEntry.id, null));
            }
            if (activeEntry?.id === deletingEntry.id) setActiveEntry(null);
            setDeletingEntry(null);
            setView('list');
            addToast(
                result.remoteVectorDeleteFailures > 0
                    ? `剧情已删除；${result.remoteVectorDeleteFailures} 条远端向量暂未同步，请检查网络`
                    : `整个剧情「${deletingEntry.title}」已删除`,
                result.remoteVectorDeleteFailures > 0 ? 'info' : 'success',
            );
        } catch (error: any) {
            addToast(error?.message || '删除整个剧情失败', 'error');
        } finally {
            setDeletingStory(false);
        }
    }, [activeEntry?.id, addToast, deletingEntry, deletingStory, library, remoteVectorConfig, updateLibrary]);

    const selectMask = useCallback((selection: StoryTheaterMaskSelection) => {
        if (maskLocked) return;
        setActiveEntry(current => {
            if (!current || current.writesToCharacterMemory) return current;
            const characterIds = selection.type === 'character'
                ? current.characterIds.filter(id => id !== selection.id)
                : current.characterIds;
            const remainingActors = characters.filter(char => characterIds.includes(char.id) || (selection.type === 'character' && selection.id === char.id));
            const validBookIds = new Set(dedupeTheaterWorldbooks(remainingActors).map(book => book.id));
            const characterContextLimits = { ...current.characterContextLimits };
            if (selection.type === 'character') {
                if (characterContextLimits[selection.id] === undefined) characterContextLimits[selection.id] = 100;
            }
            return {
                ...current,
                mask: selection,
                characterIds,
                selectedWorldbookIds: Array.from(new Set([
                    ...current.selectedWorldbookIds.filter(id => validBookIds.has(id)),
                    ...(selection.type === 'character' && (current.mask?.type !== 'character' || current.mask.id !== selection.id)
                        ? (characters.find(char => char.id === selection.id)?.mountedWorldbooks || []).map(book => book.id) : []),
                ])),
                characterContextLimits,
                updatedAt: Date.now(),
            };
        });
    }, [characters, maskLocked]);

    const openEntryEditor = useCallback(async (entry: StoryTheaterEntry) => {
        const rows = await DB.getMessagesByCharId(storyTheaterThreadId(entry.id), true);
        setMaskLocked(rows.some(message => message.metadata?.source === 'story_theater'));
        setView('editor');
    }, []);

    if (view === 'preset' && editingPreset) return <StoryPresetMaker key={editingPreset.id}
        preset={editingPreset}
        onBack={() => setView(activeEntry ? 'editor' : 'list')}
        onSave={savePreset}
        onOpenCopy={copyPreset}
        onDelete={editingPreset.builtIn ? undefined : deletePreset}
    />;

    if (view === 'masks' && activeEntry) return <StoryMaskBox
        user={userProfile}
        characters={characters}
        masks={masks}
        selected={activeEntry.mask || { type: 'user' }}
        onSelect={selectMask}
        onSave={saveMask}
        onDelete={deleteMask}
        onBack={() => setView('editor')}
        locked={maskLocked}
    />;

    if (view === 'editor' && activeEntry) return <StoryTheaterEditor key={`${activeEntry.id}:${activeEntry.updatedAt}`}
        initial={activeEntry}
        characters={characters}
        user={userProfile}
        masks={masks}
        maskLocked={maskLocked}
        presets={presets}
        onCancel={() => setView(entries.some(item => item.id === activeEntry.id) ? 'session' : 'list')}
        onSave={saveEntry}
        onManualArchive={async draft => {
            const next = await archiveStoryManually(normalizeStoryTheater(draft), apiConfig);
            setEntries(current => current.map(item => item.id === next.id ? next : item));
            setActiveEntry(next);
            addToast('本段剧情已总结为事件盒，原文仍保留', 'success');
            return next;
        }}
        onImportPreset={importPreset}
        onEditPreset={(preset, draft) => { setActiveEntry(draft); setEditingPreset(preset); setView('preset'); }}
        onOpenMaskBox={draft => { if (maskLocked || draft.writesToCharacterMemory) return; setActiveEntry(draft); setView('masks'); }}
    />;

    if (view === 'vectors' && activeEntry) return <StoryVectorMemoryPanel entry={activeEntry} onBack={() => setView('session')} />;
    if (view === 'archives' && activeEntry) return <StoryArchivePanel entry={activeEntry} masks={masks} onBack={() => setView('session')} onUpdated={next => {setActiveEntry(next);setEntries(current => current.map(item => item.id === next.id ? next : item));}} />;

    if (view === 'session' && activeEntry) {
        const preset = presets.find(item => item.id === activeEntry.presetId) || BUILTIN_NIGHT_SCREENING_PRESET;
        const hasVectorArchive = (!activeEntry.writesToCharacterMemory && activeEntry.archiveStrategy === 'vector') || activeEntry.archives.some(archive => archive.strategy === 'vector');
        return <StoryTheaterSession entry={activeEntry} preset={preset} masks={masks} onBack={() => { setActiveEntry(null); setView('list'); }} onEdit={() => void openEntryEditor(activeEntry)} onOpenArchives={() => setView('archives')} onOpenVectorMemory={hasVectorArchive ? () => setView('vectors') : undefined} onEntryChange={persistEntryInSession} />;
    }

    return <div className='h-full w-full flex flex-col bg-stone-100 text-slate-800'>
        <header className='story-safe-header shrink-0 border-b border-slate-200'>
            <div className='h-16 px-4 flex items-center gap-3'>
                <button onClick={() => currentFolder ? openFolder(currentFolder.parentId) : onClose()} aria-label={currentFolder ? '返回上一级' : '返回桌面'} className='w-9 h-9 rounded-full grid place-items-center'><ArrowLeft size={20} /></button>
                <h1 className='font-semibold'>{onSwitchCompanion ? '见面' : '剧情'}</h1>
                <StoryAppearanceButton className='ml-auto bg-white border border-slate-200' />
                <button onClick={startStory} aria-label='新建剧情' className='w-10 h-10 rounded-full bg-slate-900 text-white grid place-items-center'><Plus size={19} /></button>
            </div>
            {onSwitchCompanion && <div className='mx-5 mb-4 grid grid-cols-2 p-1 rounded-xl bg-slate-200'>
                <button onClick={onSwitchCompanion} className='py-2 rounded-lg text-xs font-bold text-slate-500'>陪伴</button>
                <button className='py-2 rounded-lg bg-white shadow-sm text-xs font-bold text-violet-700'>剧情</button>
            </div>}
        </header>

        <main ref={libraryScroll} className='story-page-scroll flex-1 overflow-y-auto px-5 pb-24'>
            <div className='max-w-2xl mx-auto'>
                <div className='flex min-h-14 flex-wrap items-center justify-between gap-x-3 border-b border-slate-200'>
                    <nav aria-label='剧情文件夹路径' className='min-w-0 flex flex-wrap items-center gap-x-1.5 text-sm'>
                        {currentFolder ? <button onClick={() => openFolder(null)} className='min-h-10 text-violet-700'>剧情目录</button> : <h2 className='font-semibold'>剧情目录</h2>}
                        {parentFolder && <><CaretRight size={12} className='shrink-0 text-slate-400' /><button onClick={() => openFolder(parentFolder.id)} className='min-h-10 max-w-full truncate text-violet-700'>{parentFolder.name}</button></>}
                        {currentFolder && <><CaretRight size={12} className='shrink-0 text-slate-400' /><span aria-current='location' className='min-w-0 break-words font-semibold'>{currentFolder.name}</span></>}
                    </nav>
                    {!parentFolder && <button onClick={() => setLibraryAction({ type: 'create', parentId: folderId })} className='min-h-11 shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700'>
                        <FolderSimplePlus size={18} />{currentFolder ? '新建子文件夹' : '新建文件夹'}
                    </button>}
                </div>

                <section className='divide-y divide-slate-200' aria-label='当前目录内容'>
                    {visibleFolders.map(folder => <div key={folder.id} className='flex items-center gap-2'>
                        <button onClick={() => openFolder(folder.id)} className='min-w-0 min-h-14 flex flex-1 items-center gap-3 text-left'>
                            <span className='w-10 h-10 shrink-0 rounded-xl grid place-items-center bg-violet-100 text-violet-700'><FolderSimple size={23} weight='duotone' /></span>
                            <span className='min-w-0 flex-1 truncate text-sm font-semibold'>{folder.name}</span>
                            {folder.mode === 'shared' && <span className='shrink-0 text-xs text-violet-700'>共通</span>}
                            <CaretRight size={14} className='shrink-0 text-slate-400' />
                        </button>
                        <button onClick={() => setLibraryAction({ type: 'folder', folder })} className='w-10 h-11 shrink-0 rounded-full grid place-items-center text-slate-500' aria-label={`管理文件夹 ${folder.name}`}><DotsThree size={23} weight='bold' /></button>
                    </div>)}
                    {visibleFolders.length === 0 && visibleEntries.length === 0 && <div className='py-9 text-center'>
                        <p className='text-sm text-slate-500'>{currentFolder ? '这个文件夹还是空的' : '这里还没有剧情'}</p>
                        <button onClick={startStory} className='mt-2 min-h-10 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-violet-700'>新建剧情</button>
                    </div>}
                    {visibleEntries.map(item => {
                        const cast = characters.filter(char => item.characterIds.includes(char.id));
                        const mask = resolveStoryTheaterMask(item.mask, userProfile, characters, masks);
                        const youLabel = mask.selection.type === 'user' ? '你' : `你（${mask.name}）`;
                        const vectorEnabled = item.archiveStrategy === 'vector' && !item.writesToCharacterMemory;
                        const hasVectorArchive = vectorEnabled || item.archives.some(archive => archive.strategy === 'vector');
                        return <div key={item.id} className='w-full py-5 flex items-center gap-2'>
                            <button onClick={() => { setActiveEntry(item); setView('session'); }} className='min-w-0 flex-1 flex items-center gap-4 text-left'>
                                <div className='flex -space-x-2'>{mask.avatar ? <TokenImg value={mask.avatar} alt='' className='w-10 h-10 rounded-full object-cover border-2 border-slate-800 relative z-10' /> : <span className='w-10 h-10 rounded-full bg-slate-800 text-white grid place-items-center border-2 border-slate-800 relative z-10 text-xs font-serif'>{mask.name.slice(0, 1)}</span>}{cast.slice(0, 2).map(char => <TokenImg key={char.id} value={char.avatar} alt='' className='w-10 h-10 rounded-full object-cover border-2 border-stone-100' />)}{cast.length === 0 && <span className='w-10 h-10 rounded-full bg-slate-200 grid place-items-center'><UsersThree size={18} /></span>}</div>
                                <div className='min-w-0 flex-1'><h3 className='font-serif font-semibold truncate'>{item.title}</h3><p className='mt-1 text-[10px] text-slate-400 truncate'>{youLabel} · 角色：{cast.map(char => char.name).join('、') || '暂无'} · {item.writesToCharacterMemory ? '进入角色记忆' : vectorEnabled ? '独立向量剧场' : '独立事件盒'}</p></div>
                                <time className='text-[9px] text-slate-400'>{new Date(item.updatedAt).toLocaleDateString()}</time>
                            </button>
                            {item.archives.some(archive => archive.strategy === 'summary') && <button onClick={() => { setActiveEntry(item); setView('archives'); }} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-violet-600' title='查看本剧情事件盒' aria-label='查看本剧情事件盒'><Archive size={17} /></button>}
                            {hasVectorArchive && <button onClick={() => { setActiveEntry(item); setView('vectors'); }} className='w-10 h-10 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-violet-600' title='查看本剧情向量记忆' aria-label='查看本剧情向量记忆'><Database size={17} /></button>}
                            <button onClick={() => setLibraryAction({ type: 'story', story: item })} className='w-10 h-11 shrink-0 rounded-full grid place-items-center text-slate-500' aria-label={`管理剧情 ${item.title}`}><DotsThree size={23} weight='bold' /></button>
                        </div>;
                    })}
                </section>

                {!currentFolder && <section className='mt-6 pt-6 border-t border-slate-200'>
                    <div className='flex items-center justify-between'><div><div className='text-[9px] tracking-[.22em] uppercase font-bold text-violet-500'>Native presets</div><h2 className='mt-1 text-lg font-semibold'>糯米机预设制作器</h2></div><div className='flex gap-2'><button onClick={() => importInput.current?.click()} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center'><UploadSimple size={17} /></button><button onClick={() => { setEditingPreset(createBlankStoryPreset()); setView('preset'); }} className='w-10 h-10 rounded-full bg-white border border-slate-200 grid place-items-center'><Plus size={17} /></button></div></div>
                    <p className='mt-2 text-[10px] leading-5 text-slate-500'>仅支持导入与导出糯米机专属剧情预设文件，不支持其他应用的预设格式。</p>
                    <input ref={importInput} type='file' accept='.json,.png,application/json,image/png' className='hidden' onChange={async event => { const file = event.target.files?.[0]; event.currentTarget.value = ''; if (file) await importPreset(file); }} />
                    <div className='mt-4 divide-y divide-slate-200'>{presets.map(preset => <div key={preset.id} className='flex items-center gap-2'><button onClick={() => { setEditingPreset(preset); setView('preset'); }} className='min-w-0 flex-1 py-3 flex items-center gap-3 text-left'><span className={`w-2 h-2 rounded-full ${preset.builtIn ? 'bg-amber-400' : 'bg-violet-500'}`} /><span className='min-w-0 flex-1 text-xs font-semibold truncate'>{preset.name}</span><span className='text-[9px] text-slate-400'>{preset.builtIn ? '内置只读' : `${preset.document.prompts.length} 条`}</span></button><button onClick={() => { void downloadStoryPreset(preset); }} className='w-9 h-9 shrink-0 rounded-full grid place-items-center text-slate-400' title={`导出 ${preset.name}`}><DownloadSimple size={15} /></button></div>)}</div>
                </section>}
            </div>
        </main>
        {libraryAction && <StoryLibraryDialog action={libraryAction} library={library} onSave={updateLibrary} onClose={closeLibraryDialog}
            onDeleteStory={story => { closeLibraryDialog(); setDeletingEntry(story); }} />}
        {deletingEntry && <div className='fixed top-0 right-0 bottom-0 left-0 z-[95] flex items-end justify-center overflow-y-auto overscroll-contain bg-slate-950/35' onClick={() => !deletingStory && setDeletingEntry(null)} role='presentation'>
            <div className='story-safe-sheet w-full sm:max-w-sm rounded-t-[28px] bg-stone-100 px-5 pt-5 shadow-2xl' onClick={event => event.stopPropagation()} role='dialog' aria-modal='true' aria-labelledby='delete-story-title'>
                <div className='flex items-start gap-4'><div className='min-w-0 flex-1'><div className='text-[9px] uppercase tracking-[.2em] font-bold text-rose-500'>删除确认</div><h2 id='delete-story-title' className='mt-1 text-lg font-semibold'>删除整个剧情？</h2></div><button disabled={deletingStory} onClick={() => setDeletingEntry(null)} className='w-9 h-9 shrink-0 rounded-full bg-white border border-slate-200 grid place-items-center text-slate-400 disabled:opacity-30' aria-label='关闭删除确认'><X size={16} /></button></div>
                <p className='mt-4 text-[11px] leading-6 text-slate-600'>「{deletingEntry.title}」的楼层、事件盒、关系备注和本剧情专属记忆会一起删除。</p>
                {deletingEntry.writesToCharacterMemory && <p className='mt-2 text-[10px] leading-5 text-amber-700'>同步到角色聊天记录里的剧情陪伴记录也会删除；已经被记忆宫殿总结成长期记忆的内容不会受影响。</p>}
                {deletingEntry.archives.some(archive => Object.keys(archive.memoryConversions || {}).length > 0) && <p className='mt-2 text-[10px] leading-5 text-amber-700'>已通过事件盒手动转入记忆宫殿或神经链接的记忆会保留，可到对应角色的记忆页面管理。</p>}
                <p className='mt-2 text-[10px] leading-5 text-slate-400'>其它剧情、普通聊天与角色原有向量记忆不会受影响。删除后无法恢复。</p>
                <div className='mt-5 grid grid-cols-2 gap-3'><button disabled={deletingStory} onClick={() => setDeletingEntry(null)} className='h-12 rounded-2xl border border-slate-200 bg-white text-xs font-bold text-slate-600 disabled:opacity-30'>取消</button><button disabled={deletingStory} onClick={() => void confirmDeleteEntry()} className='h-12 rounded-2xl bg-rose-600 text-white text-xs font-bold disabled:opacity-40'>{deletingStory ? <SpinnerGap size={17} className='mx-auto animate-spin' /> : '删除整个剧情'}</button></div>
            </div>
        </div>}
    </div>;
};

const StoryTheater: React.FC<Props> = props => <StoryTheaterThemeProvider><StoryTheaterContent {...props} /></StoryTheaterThemeProvider>;

export default StoryTheater;
