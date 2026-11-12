export interface StoryFolder {
    id: string;
    name: string;
    parentId: string | null;
}

export interface StoryLibrary {
    folders: StoryFolder[];
    locations: Record<string, string>;
}

export const STORY_LIBRARY_STORAGE_KEY = 'sully_story_theater_library_v1';
export const STORY_FOLDER_NAME_LIMIT = 40;

export function parseStoryLibrary(value: string): StoryLibrary {
    const data = JSON.parse(value);
    if (!data || !Array.isArray(data.folders) || !data.locations || typeof data.locations !== 'object') {
        throw new Error('无效的剧情文件夹数据');
    }

    const foldersById = new Map<string, StoryFolder>();
    for (const folder of data.folders) {
        if (!folder || typeof folder.id !== 'string' || !folder.id || foldersById.has(folder.id)
            || typeof folder.name !== 'string' || !folder.name.trim()
            || (folder.parentId !== null && typeof folder.parentId !== 'string')) continue;
        foldersById.set(folder.id, {
            id: folder.id,
            name: folder.name.trim().slice(0, STORY_FOLDER_NAME_LIMIT),
            parentId: folder.parentId,
        });
    }
    const folders = [...foldersById.values()].filter(folder =>
        folder.parentId === null || foldersById.get(folder.parentId)?.parentId === null);
    const validIds = new Set(folders.map(folder => folder.id));
    const locations = Object.fromEntries(Object.entries(data.locations).filter(
        (pair): pair is [string, string] => typeof pair[1] === 'string' && validIds.has(pair[1]),
    ));
    return { folders, locations };
}

export function loadStoryLibrary(): StoryLibrary {
    try {
        const raw = localStorage.getItem(STORY_LIBRARY_STORAGE_KEY);
        if (raw) return parseStoryLibrary(raw);
    } catch { /* An unreadable folder layout leaves all stories visible at the root. */ }
    return { folders: [], locations: {} };
}

export function saveStoryLibrary(library: StoryLibrary): void {
    localStorage.setItem(STORY_LIBRARY_STORAGE_KEY, JSON.stringify(library));
}

export function getStoryFolder(library: StoryLibrary, storyId: string): string | null {
    return Object.prototype.hasOwnProperty.call(library.locations, storyId) ? library.locations[storyId] : null;
}

export function moveStoryInLibrary(library: StoryLibrary, storyId: string, folderId: string | null): StoryLibrary {
    const locations = { ...library.locations };
    delete locations[storyId];
    if (folderId && library.folders.some(folder => folder.id === folderId)) {
        return { ...library, locations: { ...locations, [storyId]: folderId } };
    }
    return { ...library, locations };
}

export function removeStoryFolder(library: StoryLibrary, folder: StoryFolder): StoryLibrary {
    const folders = library.folders.filter(item => item.id !== folder.id).map(item =>
        item.parentId === folder.id ? { ...item, parentId: folder.parentId } : item);
    const locations = Object.fromEntries(Object.entries(library.locations).flatMap(([storyId, folderId]) => {
        if (folderId !== folder.id) return [[storyId, folderId]];
        return folder.parentId ? [[storyId, folder.parentId]] : [];
    }));
    return { folders, locations };
}
