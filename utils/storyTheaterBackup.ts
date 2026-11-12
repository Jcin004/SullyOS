import { parseStoryLibrary, saveStoryLibrary, STORY_LIBRARY_STORAGE_KEY } from './storyTheaterLibrary';

export const STORY_THEATER_APPEARANCE_STORAGE_KEY = 'sully_story_theater_appearance_v1';

export function exportStoryTheaterAppearanceSetting(): string | undefined {
    try {
        const value = localStorage.getItem(STORY_THEATER_APPEARANCE_STORAGE_KEY);
        return value || undefined;
    } catch {
        return undefined;
    }
}

export function restoreStoryTheaterAppearanceSetting(value: unknown): boolean {
    if (typeof value !== 'string' || !value) return false;
    try {
        const parsed = JSON.parse(value);
        if (
            !parsed
            || (parsed.color !== 'light' && parsed.color !== 'dark')
            || (parsed.decor !== 'plain' && parsed.decor !== 'cinema')
        ) {
            return false;
        }
        localStorage.setItem(STORY_THEATER_APPEARANCE_STORAGE_KEY, value);
        return true;
    } catch {
        return false;
    }
}
export function exportStoryLibrarySetting(): string | undefined {
    try { return localStorage.getItem(STORY_LIBRARY_STORAGE_KEY) ?? undefined; }
    catch { return undefined; }
}

export function restoreStoryLibrarySetting(value: unknown): void {
    if (typeof value !== 'string') return;
    try { saveStoryLibrary(parseStoryLibrary(value)); }
    catch { /* A malformed optional layout does not interrupt the story restore. */ }
}
