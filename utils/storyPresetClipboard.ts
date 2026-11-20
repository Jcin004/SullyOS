import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import {
    getStoryPresetPromptGroups, isProtectedStoryPrompt, isStoryPresetSectionMarker,
    makeStoryPresetGroupBoundaries, makeStoryTheaterId, storyPresetGroupInsertIndex,
    STORY_MINI_THEATER_PROMPT_IDS, type StoryPresetPromptGroup,
} from './storyTheater';
import { STORY_PRESET_PROTOCOLS } from './storyPresetProtocols';

type Prompt = StoryTheaterPresetPrompt;
type Document = StoryTheaterPresetDocument;
type Selection = { kind: 'groups' | 'prompts'; ids: readonly string[] };

export interface StoryPresetClipboard {
    kind: Selection['kind'];
    batches: { name: string; prompts: Prompt[] }[];
    skipped: number;
    flattened: boolean;
}

type Target = { kind: 'new' } | { kind: 'existing'; groupKey: string };

const protocolIds = new Set<string>([
    ...STORY_PRESET_PROTOCOLS.flatMap(module => module.prompts.map(prompt => prompt.id)),
    ...STORY_MINI_THEATER_PROMPT_IDS,
    'nmj-v61-shot-debts', 'nmj-v6-gemini-format-lock', 'nmj-v616-silent-preflight', 'nmj-v3-exit-check',
]);

export const canCopyStoryPresetPrompt = (prompt: Prompt): boolean => (
    !isStoryPresetSectionMarker(prompt) && !isProtectedStoryPrompt(prompt) && !prompt.scope
    && !protocolIds.has(prompt.id) && !/^nmj-v(?:65-affinity-|67-theater-)/.test(prompt.id)
);

export const canPasteIntoStoryPresetGroup = (group: StoryPresetPromptGroup): boolean => (
    !group.protected && group.key !== 'theater'
    && group.customSectionId !== 'st-runtime-slots' && group.customSectionId !== 'st-native-protocols'
);

export const storyPresetClipboardPromptCount = (clipboard: StoryPresetClipboard): number => (
    clipboard.batches.reduce((count, batch) => count + batch.prompts.length, 0)
);

export function copyStoryPresetSelection(document: Document, selection: Selection): StoryPresetClipboard {
    const selectedIds = new Set(selection.ids);
    const groups = getStoryPresetPromptGroups(document);
    const batches: StoryPresetClipboard['batches'] = [];
    let skipped = 0;
    const snapshot = (rows: Prompt[]) => {
        const prompts: Prompt[] = [];
        for (const row of rows) {
            if (isStoryPresetSectionMarker(row)) continue;
            if (!canCopyStoryPresetPrompt(row)) {
                skipped++;
                continue;
            }
            prompts.push({ ...row, ...(row.inChat ? { inChat: { ...row.inChat } } : {}) });
        }
        return prompts;
    };

    if (selection.kind === 'prompts') {
        const prompts = snapshot(document.prompts.filter(row => selectedIds.has(row.id)));
        if (prompts.length) batches.push({ name: '复制的提示词', prompts });
        return { kind: selection.kind, batches, skipped, flattened: false };
    }

    for (const group of groups) {
        if (!selectedIds.has(group.key)) continue;
        const before = skipped;
        const prompts = snapshot(document.prompts.slice(group.startIndex, group.endIndex + 1));
        // Keep truly empty groups. A section containing only protected prompts has no transferable content.
        if (prompts.length || (before === skipped && !group.key.startsWith('custom:'))) batches.push({ name: group.label, prompts });
    }
    const represented = new Set(groups.map(group => group.customSectionId));
    const flattened = document.prompts.some(row => row.section && !represented.has(row.section.id));
    return { kind: selection.kind, batches, skipped, flattened };
}

function uniqueGroupName(name: string, usedNames: Set<string>): string {
    const base = name.trim() || '自定义分组';
    let label = base;
    for (let suffix = 2; usedNames.has(label); suffix++) label = `${base}（${suffix}）`;
    usedNames.add(label);
    return label;
}

export function pasteStoryPresetClipboard(document: Document, clipboard: StoryPresetClipboard, target: Target) {
    const groups = getStoryPresetPromptGroups(document);
    const destination = target.kind === 'existing' ? groups.find(group => group.key === target.groupKey) : undefined;
    if (target.kind === 'existing' && (!destination || !canPasteIntoStoryPresetGroup(destination))) return null;
    const usedIds = new Set([
        ...document.prompts.flatMap(prompt => prompt.section ? [prompt.id, prompt.section.id] : [prompt.id]),
        ...clipboard.batches.flatMap(batch => batch.prompts.map(prompt => prompt.id)),
    ]);
    const makeId = () => {
        const base = makeStoryTheaterId();
        let id = base;
        for (let suffix = 2; usedIds.has(id); suffix++) id = `${base}-${suffix}`;
        usedIds.add(id);
        return id;
    };
    const batches = clipboard.batches.flatMap(batch => {
        const prompts = batch.prompts.filter(canCopyStoryPresetPrompt).map(({ name, enabled, content, role, inChat }): Prompt => ({
            id: makeId(), name, enabled, content, role,
            ...(inChat && document.promptLayout === 'ordered' ? { inChat: { ...inChat } } : {}),
        }));
        return prompts.length || (clipboard.kind === 'groups' && !batch.prompts.length) ? [{ name: batch.name, prompts }] : [];
    });
    const added: Prompt[] = [];
    let firstGroupKey = destination?.key;
    if (destination) {
        for (const batch of batches) added.push(...batch.prompts);
    } else {
        const usedNames = new Set(groups.map(group => group.label.trim()));
        for (const batch of batches) {
            const [start, end] = makeStoryPresetGroupBoundaries(uniqueGroupName(batch.name, usedNames), makeId);
            added.push(start, ...batch.prompts, end);
            firstGroupKey ??= 'section:' + start.section!.id;
        }
    }
    if (!added.length) return null;

    const index = destination ? storyPresetGroupInsertIndex(document, destination) : document.prompts.length;
    const prompts = [...document.prompts.slice(0, index), ...added, ...document.prompts.slice(index)];
    return { document: { ...document, prompts }, addedIds: added.map(prompt => prompt.id), firstGroupKey };
}

export function undoStoryPresetPaste(document: Document, addedIds: readonly string[]): Document {
    const added = new Set(addedIds);
    return { ...document, prompts: document.prompts.filter(prompt => !added.has(prompt.id)) };
}
