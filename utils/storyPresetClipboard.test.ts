import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import { BUILTIN_NIGHT_SCREENING_PRESET, getStoryPresetPromptGroups, makeStoryPresetGroupBoundaries, parseStoryTheaterPreset } from './storyTheater';
import { copyStoryPresetSelection, pasteStoryPresetClipboard, storyPresetClipboardPromptCount, undoStoryPresetPaste } from './storyPresetClipboard';
import { STORY_RELATIONSHIP_PROMPT_ID } from './storyTheaterRelationships';
import { convertSillyTavernStoryPreset, readSillyTavernStoryPreset } from './sillyTavernStoryPreset';

type Prompt = StoryTheaterPresetPrompt;
const prompt = (id: string, changes: Partial<Prompt> = {}): Prompt => ({
    id, name: id, enabled: true, role: 'system', content: '正文 ' + id, ...changes,
});
const section = (name: string, rows: Prompt[]) => {
    const [start, end] = makeStoryPresetGroupBoundaries(name);
    return [start, ...rows, end];
};
const preset = (prompts: Prompt[], ordered = true): StoryTheaterPresetDocument => ({
    schema: 'sullyos.story-preset', version: 1, name: '用例', ...(ordered ? { promptLayout: 'ordered' as const } : {}),
    generation: { temperature: 1, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 2000 }, prompts,
});
const visible = (document: StoryTheaterPresetDocument, label: string) =>
    getStoryPresetPromptGroups(document).find(group => group.label === label)!;
const rowsIn = (document: StoryTheaterPresetDocument, label: string) => visible(document, label).promptIds
    .map(id => document.prompts.find(row => row.id === id)!)
    .filter(row => !row.section);

describe('跨预设剪贴板', () => {
    it('复制多条或单条时按源顺序制作独立快照，跨预设保留角色、正文、历史深度和启停', () => {
        const first = prompt('a', { role: 'assistant', enabled: false, inChat: { depth: 1, order: 3 }, content: '\n  原样内容  \n' });
        const second = prompt('b', { role: 'user' });
        const source = preset([...section('甲', [first]), ...section('乙', [second])]);
        const clip = copyStoryPresetSelection(source, { kind: 'prompts', ids: ['b', 'a', 'b'] });
        expect(storyPresetClipboardPromptCount(clip)).toBe(2);
        expect(copyStoryPresetSelection(source, { kind: 'prompts', ids: ['b'] }).batches[0].prompts).toEqual([second]);
        expect(clip.batches[0].prompts).toEqual([first, second]);
        expect(clip.batches[0].prompts[0]).not.toBe(first);
        expect(clip.batches[0].prompts[0].inChat).not.toBe(first.inChat);
        const target = preset(section('目标', [prompt('b')]));
        const result = pasteStoryPresetClipboard(target, clip, { kind: 'existing', groupKey: visible(target, '目标').key })!;
        expect(rowsIn(result.document, '目标').map(({ id, ...rest }) => rest)).toEqual(
            [target.prompts[1], first, second].map(({ id, ...rest }) => rest),
        );
        expect(result.addedIds.every(id => id !== 'a' && id !== 'b')).toBe(true);
        expect(result.document.prompts.slice(0, 2)).toEqual(target.prompts.slice(0, 2));
        expect(result.document.prompts.at(-1)).toBe(target.prompts.at(-1));
        expect(source.prompts[1]).toBe(first);
    });

    it('批量粘贴分类形成独立闭合区间，重复名称递增，跳过原生协议并保留互斥开关', () => {
        const normal = [prompt('nmj-v3-style-soda'), prompt('nmj-v3-style-comedy', { enabled: false, role: 'user' })];
        const protectedRows = [
            prompt('slot', { marker: 'characters' }), prompt('nmj-v67-theater-cast'), prompt('nmj-v67-theater-private-axes'),
            prompt(STORY_RELATIONSHIP_PROMPT_ID), prompt('sully-experience-time'), prompt('custom-scope', { scope: 'story_theater_story' }),
            prompt('nmj-v3-theater-custom'), prompt('nmj-v65-affinity-transparent'),
        ];
        const source = preset([...section('文风', [...normal, ...protectedRows]), ...section('人物', [prompt('c')])]);
        const clip = copyStoryPresetSelection(source, { kind: 'groups', ids: [visible(source, '人物').key, visible(source, '文风').key] });
        expect(clip.skipped).toBe(protectedRows.length);
        expect(clip.batches.map(batch => batch.name)).toEqual(['文风', '人物']);
        expect(clip.batches[0].prompts).toEqual(normal);
        expect(copyStoryPresetSelection(source, { kind: 'prompts', ids: protectedRows.map(row => row.id) }))
            .toMatchObject({ batches: [], skipped: protectedRows.length });

        const target = preset([...section('文风', [prompt('same')]), ...section('文风（2）', [prompt('old')])]);
        // A repeated generated ID, including one already present in the destination.
        const uuid = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('same' as ReturnType<Crypto['randomUUID']>);
        try {
            const result = pasteStoryPresetClipboard(target, clip, { kind: 'new' })!;
            const twice = pasteStoryPresetClipboard(result.document, clip, { kind: 'new' })!;
            expect(getStoryPresetPromptGroups(twice.document).map(group => group.label))
                .toEqual(['文风', '文风（2）', '文风（3）', '人物', '文风（4）', '人物（2）']);
            expect(rowsIn(twice.document, '文风（3）').map(row => row.enabled)).toEqual([true, false]);
            expect(rowsIn(twice.document, '文风（3）').map(row => row.role)).toEqual(['system', 'user']);
            const used = twice.document.prompts.flatMap(row => row.section?.edge === 'start' ? [row.id, row.section.id] : [row.id]);
            expect(new Set(used).size).toBe(used.length);
            const restored = parseStoryTheaterPreset(JSON.stringify(twice.document), 'copied.json').document;
            expect(restored.prompts).toEqual(twice.document.prompts);
        } finally {
            uuid.mockRestore();
        }
    });

    it('追加到已有分类不生成边界，拒绝受保护目标，旧预设按相对位置插入', () => {
        const native = BUILTIN_NIGHT_SCREENING_PRESET.document;
        const source = preset([prompt('source', { inChat: { depth: 1, order: 0 } })]);
        const clip = copyStoryPresetSelection(source, { kind: 'prompts', ids: ['source'] });
        expect(pasteStoryPresetClipboard(native, clip, { kind: 'existing', groupKey: 'sources' })).toBeNull();
        expect(pasteStoryPresetClipboard(native, clip, { kind: 'existing', groupKey: 'theater' })).toBeNull();
        const pasted = pasteStoryPresetClipboard(native, clip, { kind: 'existing', groupKey: 'exit' })!;
        const exit = visible(pasted.document, '出口与收尾');
        expect(exit.promptIds.indexOf(pasted.addedIds[0])).toBe(exit.promptIds.length - 2);
        const added = pasted.document.prompts.find(row => row.id === pasted.addedIds[0])!;
        expect(added.inChat).toBeUndefined();
        expect(added.section).toBeUndefined();
        expect(pasted.document.prompts.filter(row => row.id !== added.id)).toEqual(native.prompts);
    });

    it('按可见分类展平嵌套边界，普通提示词维持源顺序，撤销只移除本次新增项', () => {
        const source = preset(section('外层', [prompt('前'), ...section('内层', [prompt('中')]), prompt('后')]));
        const clip = copyStoryPresetSelection(source, { kind: 'groups', ids: getStoryPresetPromptGroups(source).map(group => group.key) });
        expect(clip.flattened).toBe(true);
        expect(clip.batches.flatMap(batch => batch.prompts.map(row => row.id))).toEqual(['前', '中', '后']);
        const target = preset(section('目标', [prompt('目标提示词')]));
        const pasted = pasteStoryPresetClipboard(target, clip, { kind: 'new' })!;
        expect(getStoryPresetPromptGroups(pasted.document).filter(group => group.customSectionId)).toHaveLength(4);
        expect(pasted.document.prompts.filter(row => row.section)).toHaveLength(8);

        const changed = { ...pasted.document, description: '后来编辑的描述',
            prompts: pasted.document.prompts.map(row => row.id === '目标提示词' ? { ...row, content: '后来编辑的正文' } : row) };
        const undone = undoStoryPresetPaste(changed, pasted.addedIds);
        expect(undone.description).toBe('后来编辑的描述');
        expect(undone.prompts.map(row => row.id)).toEqual(target.prompts.map(row => row.id));
        expect(undone.prompts[1].content).toBe('后来编辑的正文');
        expect(undoStoryPresetPaste(pasted.document, pasted.addedIds)).toEqual(target);
    });
});

const tavernSample = process.env.SULLY_TAVERN_SAMPLE;
it.skipIf(!tavernSample)('从众生相一次复制完整文风和复述分类，再追加到另一个原生预设', () => {
    const input = readSillyTavernStoryPreset(readFileSync(tavernSample!, 'utf8'), '众生相.json');
    const source = convertSillyTavernStoryPreset(input).document;
    const chosen = ['抢话/复述', '文风设定'];
    const groups = chosen.map(name => visible(source, name));
    const clip = copyStoryPresetSelection(source, { kind: 'groups', ids: groups.map(group => group.key) });
    expect(clip.batches.map(batch => batch.name)).toEqual(chosen);
    const fields = ({ enabled, role, content, name, inChat }: Prompt) => ({ enabled, role, content, name, inChat });
    const sourceRows = chosen.flatMap(name => rowsIn(source, name));
    const keep = sourceRows.map(fields);
    expect(keep.some(row => row.inChat && row.enabled)).toBe(true);
    expect(keep.some(row => !row.enabled)).toBe(true);

    const target = preset(section('合并区', [prompt('原有规则')]));
    const pasted = pasteStoryPresetClipboard(target, clip, { kind: 'existing', groupKey: visible(target, '合并区').key })!;
    const imported = parseStoryTheaterPreset(JSON.stringify(pasted.document), 'merged.sully.json').document;
    expect(rowsIn(imported, '合并区').slice(1).map(fields)).toEqual(keep);
    expect(undoStoryPresetPaste(pasted.document, pasted.addedIds)).toEqual(target);
});
