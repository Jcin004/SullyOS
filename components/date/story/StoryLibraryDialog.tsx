import React, { useState } from 'react';
import { CaretRight, Check, FolderSimple, FolderSimplePlus, Trash, X } from '@phosphor-icons/react';
import { useOS } from '../../../context/OSContext';
import type { StoryTheaterEntry } from '../../../types';
import { makeStoryTheaterId } from '../../../utils/storyTheater';
import {
    getStoryFolder, moveStoryInLibrary, removeStoryFolder, STORY_FOLDER_NAME_LIMIT,
    type StoryFolder, type StoryLibrary,
} from '../../../utils/storyTheaterLibrary';

export type StoryLibraryAction =
    | { type: 'create'; parentId: string | null }
    | { type: 'folder'; folder: StoryFolder }
    | { type: 'story'; story: StoryTheaterEntry };

interface Props {
    action: StoryLibraryAction;
    library: StoryLibrary;
    onSave: (update: (current: StoryLibrary) => StoryLibrary) => boolean;
    onDeleteStory: (story: StoryTheaterEntry) => void;
    onClose: () => void;
}

export default function StoryLibraryDialog({ action, library, onSave, onDeleteStory, onClose }: Props) {
    const { registerBackHandler } = useOS();
    const [name, setName] = useState(action.type === 'folder' ? action.folder.name : '');
    const [mode, setMode] = useState<NonNullable<StoryFolder['mode']>>(action.type === 'folder' ? action.folder.mode ?? 'normal' : 'normal');
    const [stage, setStage] = useState<'main' | 'move' | 'remove'>('main');
    const [destination, setDestination] = useState(action.type === 'story' ? getStoryFolder(library, action.story.id) : null);
    React.useEffect(() => registerBackHandler(() => { onClose(); return true; }), [onClose, registerBackHandler]);

    const folder = action.type === 'folder' ? action.folder : null;
    const parentId = action.type === 'create' ? action.parentId : folder?.parentId ?? null;
    const cleanedName = name.trim();
    const duplicate = library.folders.some(item => item.id !== folder?.id && item.parentId === parentId && item.name === cleanedName);
    const title = stage === 'move' ? '移动剧情' : stage === 'remove' ? '移除文件夹'
        : action.type === 'story' ? action.story.title : folder ? '文件夹设置' : parentId ? '新建子文件夹' : '新建文件夹';
    const saveFolder = (event: React.FormEvent) => {
        event.preventDefault();
        if (!cleanedName || duplicate || action.type === 'story') return;
        const next = { id: folder?.id ?? makeStoryTheaterId(), name: cleanedName, parentId, mode };
        if (onSave(current => ({
            ...current,
            folders: folder ? current.folders.map(item => item.id === folder.id ? next : item) : [...current.folders, next],
        }))) onClose();
    };

    const choice = (id: string | null, label: string, child = false) => (
        <button key={id ?? 'root'} type='button' aria-pressed={destination === id}
            onClick={() => setDestination(id)}
            className={`w-full flex items-center gap-3 min-h-11 py-2 pr-3 text-left text-sm border-b border-slate-200 ${child ? 'pl-9' : 'pl-2'}`}>
            <FolderSimple size={19} className='shrink-0 text-violet-500' />
            <span className='flex-1 min-w-0 break-words'>{label}</span>
            {destination === id && <Check size={18} className='shrink-0 text-violet-600' />}
        </button>
    );

    return <div className='fixed top-0 right-0 bottom-0 left-0 z-[95] flex items-end justify-center bg-slate-950/35' onClick={onClose} role='presentation'>
        <div role='dialog' aria-modal='true' aria-labelledby='story-library-dialog-title' onClick={event => event.stopPropagation()}
            className='story-safe-sheet w-full sm:max-w-md max-h-[80%] overflow-y-auto overscroll-contain rounded-t-[24px] bg-stone-100 px-5 pt-5 shadow-xl'>
            <div className='flex items-center gap-3'>
                <h2 id='story-library-dialog-title' className='min-w-0 flex-1 text-lg font-semibold truncate'>{title}</h2>
                <button type='button' onClick={onClose} aria-label='关闭' className='w-9 h-9 shrink-0 rounded-full grid place-items-center text-slate-500'><X size={18} /></button>
            </div>
            {action.type === 'story' && stage === 'main' && <div className='mt-2 divide-y divide-slate-200'>
                <button type='button' onClick={() => setStage('move')} className='w-full min-h-12 flex items-center gap-3 text-sm text-left'><FolderSimple size={20} className='text-violet-500' /><span className='flex-1'>移动到文件夹</span><CaretRight size={15} /></button>
                <button type='button' onClick={() => onDeleteStory(action.story)} className='w-full min-h-12 flex items-center gap-3 text-sm text-left text-rose-600'><Trash size={19} />删除整个剧情</button>
            </div>}
            {action.type === 'story' && stage === 'move' && <>
                <div className='mt-3 max-h-[36vh] overflow-y-auto' aria-label='移动位置'>
                    {choice(null, '剧情根目录')}
                    {library.folders.filter(item => item.parentId === null).map(item => <React.Fragment key={item.id}>
                        {choice(item.id, item.mode === 'shared' ? `${item.name}（共通）` : item.name)}
                        {library.folders.filter(child => child.parentId === item.id).map(child => choice(child.id, child.mode === 'shared' ? `${child.name}（共通）` : child.name, true))}
                    </React.Fragment>)}
                </div>
                <button type='button' onClick={() => { if (onSave(current => moveStoryInLibrary(current, action.story.id, destination))) onClose(); }}
                    disabled={destination === getStoryFolder(library, action.story.id)}
                    className='mt-4 w-full min-h-11 rounded-xl bg-violet-700 text-white text-sm font-semibold disabled:opacity-40'>移动到这里</button>
            </>}
            {action.type !== 'story' && stage === 'main' && <form className='mt-3' onSubmit={saveFolder}>
                <label className='block text-xs font-semibold text-slate-600' htmlFor='story-folder-name'>文件夹名称</label>
                <input id='story-folder-name' value={name} onChange={event => setName(event.target.value)} maxLength={STORY_FOLDER_NAME_LIMIT}
                    className='mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base' />
                {duplicate && <p className='mt-2 text-xs text-rose-600' role='status'>当前位置已有同名文件夹</p>}
                <label className='mt-3 block text-xs font-semibold text-slate-600' htmlFor='story-folder-mode'>文件夹类型</label>
                <select id='story-folder-mode' value={mode} onChange={event => setMode(event.target.value === 'shared' ? 'shared' : 'normal')}
                    className='mt-2 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-base'>
                    <option value='normal'>普通文件夹</option>
                    <option value='shared'>共通文件夹</option>
                </select>
                <p className='mt-2 text-xs text-slate-500'>{mode === 'shared' ? '直接放在这里的剧场共享尚未归档的剧情原文。' : '文件夹用于分类，各剧场独立续写。'}</p>
                <button type='submit' disabled={!cleanedName || duplicate} className='mt-4 min-h-11 w-full rounded-xl bg-violet-700 text-white text-sm font-semibold disabled:opacity-40'>
                    {folder ? '保存设置' : '创建文件夹'}
                </button>
                {folder && <button type='button' onClick={() => setStage('remove')} className='mt-1 min-h-11 w-full text-sm text-rose-600'>移除文件夹</button>}
            </form>}
            {folder && stage === 'remove' && <>
                <p className='mt-3 text-sm leading-6 text-slate-600'>「{folder.name}」里的剧场和子文件夹会移到上一级。</p>
                <button type='button' className='mt-4 min-h-11 w-full rounded-xl bg-rose-600 text-white text-sm font-semibold'
                    onClick={() => { if (onSave(current => removeStoryFolder(current, folder))) onClose(); }}>移除文件夹</button>
            </>}
        </div>
    </div>;
}
