// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { exportStoryLibrarySetting, restoreStoryLibrarySetting } from './storyTheaterBackup';
import { getSharedStoryIds, getStoryFolder, loadStoryLibrary, moveStoryInLibrary, parseStoryLibrary, removeStoryFolder, saveStoryLibrary, type StoryLibrary } from './storyTheaterLibrary';

const main = { id: 'main', name: '主线', parentId: null };
const child = { id: 'child', name: '番外', parentId: main.id };

beforeEach(() => localStorage.clear());

describe('剧情文件夹', () => {
    it('通过现有备份恢复共通模式和归属，旧目录和子目录保持独立', () => {
        const library: StoryLibrary = {
            folders: [{ ...main, mode: 'shared' }, child],
            locations: { a: main.id, b: main.id, c: child.id, d: child.id },
        };
        saveStoryLibrary(library);
        const backup = exportStoryLibrarySetting();
        localStorage.clear();
        restoreStoryLibrarySetting(backup);
        const restored = loadStoryLibrary();
        expect(restored).toEqual(library);
        expect(getSharedStoryIds(restored, 'a')).toEqual(['b']);
        expect(getSharedStoryIds(restored, 'b')).toEqual(['a']);
        expect(getSharedStoryIds(restored, 'c')).toEqual([]);
        expect(getSharedStoryIds(moveStoryInLibrary(restored, 'b', null), 'a')).toEqual([]);
        expect(getSharedStoryIds(moveStoryInLibrary(restored, 'c', main.id), 'a')).toEqual(['b', 'c']);
    });
    it('旧剧情留在根目录，并能把二级分类随备份恢复', () => {
        let library = loadStoryLibrary();
        expect(getStoryFolder(library, 'existing')).toBeNull();
        library = moveStoryInLibrary({ ...library, folders: [main, child] }, 'existing', child.id);
        saveStoryLibrary(library);
        const backup = exportStoryLibrarySetting();
        localStorage.clear();
        restoreStoryLibrarySetting(backup);
        expect(loadStoryLibrary()).toEqual(library);
    });

    it('移除父文件夹时保留子文件夹、子文件夹中的剧情和直接放在父级的剧情', () => {
        const updated = removeStoryFolder({
            folders: [main, child],
            locations: { 'main-story': main.id, 'side-story': child.id },
        }, main);
        expect(updated.folders).toEqual([{ ...child, parentId: null }]);
        expect(getStoryFolder(updated, 'main-story')).toBeNull();
        expect(getStoryFolder(updated, 'side-story')).toBe(child.id);
    });

    it('忽略坏链接、循环引用和超出两级的目录，使受影响的剧情仍在根目录可见', () => {
        const library = parseStoryLibrary(JSON.stringify({
            folders: [main, child,
                { id: 'too-deep', name: '三级', parentId: child.id },
                { id: 'cycle', name: '循环', parentId: 'cycle' }],
            locations: { a: 'too-deep', b: 'cycle', c: 'deleted', d: child.id },
        }));
        expect(library).toEqual({ folders: [main, child], locations: { d: child.id } });
        expect(getStoryFolder(library, 'a')).toBeNull();
    });
});
