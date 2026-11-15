import { describe, expect, it } from 'vitest';
import { addStoryPresetGroup, renameStoryPresetGroup, ungroupStoryPresetGroup, moveStoryPresetPromptToGroup, getStoryPresetPromptGroups, createBlankStoryPreset, parseStoryTheaterPreset, compileStoryPreset, BUILTIN_NIGHT_SCREENING_PRESET, duplicateStoryPreset } from './storyTheater';

describe('剧情自定义大区', () => {
    it('空分组可保存、改名、导出导入，移动条目后正文只发送一次', () => {
        let preset = createBlankStoryPreset();
        const originalPromptCount = preset.document.prompts.length;
        preset.document = addStoryPresetGroup(preset.document, '我的文风');
        const group = getStoryPresetPromptGroups(preset.document).at(-1)!;
        expect(group.label).toBe('我的文风');
        preset.document = moveStoryPresetPromptToGroup(preset.document, preset.document.prompts[0].id, group.key);
        preset.document = renameStoryPresetGroup(preset.document, group.customSectionId!, '写作习惯');
        const imported = parseStoryTheaterPreset(JSON.stringify(preset.document), 'test.json');
        expect(getStoryPresetPromptGroups(imported.document).at(-1)?.label).toBe('写作习惯');
        const compiled = compileStoryPreset({ preset: imported, userName: '用户', characterNames: ['角色'], slots: { actors: '角色资料', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' } });
        const text = JSON.stringify(compiled.messages);
        expect(text).not.toContain('写作习惯');
        expect(text.match(/直接续写连续的第三人称故事/g)).toHaveLength(1);
        const ungrouped = ungroupStoryPresetGroup(imported.document, group.customSectionId!);
        expect(ungrouped.prompts).toHaveLength(originalPromptCount);
        expect(ungrouped.prompts.some(prompt => prompt.content.includes('直接续写'))).toBe(true);
    });
    it('出演模式提示词位于预设区，可编辑、按数组顺序注入，并在关闭出演模式时完全跳过', () => {
        const document = BUILTIN_NIGHT_SCREENING_PRESET.document;
        const group = getStoryPresetPromptGroups(document).find(item => item.key === 'theater');
        expect(group?.label).toBe('出演模式');
        const scoped = document.prompts.filter(prompt => prompt.scope);
        expect(scoped.length).toBe(5);
        const off = compileStoryPreset({ preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: ['角色'], slots: { actors: '角色资料', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' } });
        expect(off.messages.map(row => row.content).join('\n')).not.toContain('根据用户最新输入选择剧情模式');
        const on = compileStoryPreset({
            preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: ['角色'],
            slots: { actors: '角色资料', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' },
            storyTheaterMode: 'story',
            storyTheaterValues: {
                theater_mode_state: '剧情续写',
                theater_cast_data: '候选角色（ID、姓名）：[["a","角色A"]]',
                theater_prefill: '<scene_header>',
                theater_previous_axes: '{"a":"继续整理行李"}',
            },
        });
        const contents = on.messages.map(row => row.content);
        const modeIndex = contents.findIndex(value => value.includes('根据用户最新输入选择剧情模式'));
        const castIndex = contents.findIndex(value => value.includes('根据候选角色与当前剧情'));
        const continuityIndex = contents.findIndex(value => value.includes('保持人物的时间、位置'));
        const outputIndex = contents.findIndex(value => value.includes('剧情模式按顺序输出'));
        const axesIndex = contents.findIndex(value => value.includes('读取并承接各角色最近的私轴'));
        expect([modeIndex, castIndex, continuityIndex, outputIndex, axesIndex].every(index => index >= 0)).toBe(true);
        expect([modeIndex, castIndex, continuityIndex, outputIndex, axesIndex]).toEqual([...([modeIndex, castIndex, continuityIndex, outputIndex, axesIndex])].sort((a, b) => a - b));
        expect(contents.join('\n')).toContain('剧情续写');
        expect(contents.join('\n')).toContain('继续整理行李');
        expect(contents.join('\n')).toContain('<scene_header>');
        const outOfStory = compileStoryPreset({
            preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: [],
            slots: { actors: '', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' },
            storyTheaterMode: 'out_of_story',
            storyTheaterValues: { theater_mode_state: '场外重写' },
        });
        expect(outOfStory.messages.map(row => row.content).join('\n')).toContain('场外模式只输出');
        expect(outOfStory.messages.map(row => row.content).join('\n')).not.toContain('根据候选角色与当前剧情');
    });

    it('旧预设在解析时补入出演模式区，不覆盖已有提示词', () => {
        const legacy = { ...BUILTIN_NIGHT_SCREENING_PRESET.document, prompts: BUILTIN_NIGHT_SCREENING_PRESET.document.prompts.filter(prompt => !prompt.id.startsWith('nmj-v67-')) };
        const imported = parseStoryTheaterPreset(JSON.stringify(legacy), 'legacy.json');
        expect(getStoryPresetPromptGroups(imported.document).some(group => group.key === 'theater')).toBe(true);
        expect(imported.document.prompts.some(prompt => prompt.id === 'nmj-v67-theater-cast')).toBe(true);
        expect(imported.document.prompts.some(prompt => prompt.content.includes('每个人都有自己的发动机'))).toBe(true);
    });

    it('保留内置区的保护规则，不允许把系统连接位移出或将普通条目移入', () => {
        const doc = addStoryPresetGroup(duplicateStoryPreset(BUILTIN_NIGHT_SCREENING_PRESET).document, '自定义');
        const groups = getStoryPresetPromptGroups(doc);
        const protectedGroup = groups.find(group => group.protected)!;
        const custom = groups.at(-1)!;
        const protectedId = protectedGroup.promptIds[1];
        expect(moveStoryPresetPromptToGroup(doc, protectedId, custom.key)).toBe(doc);
        expect(moveStoryPresetPromptToGroup(doc, doc.prompts.find(prompt => prompt.content && !prompt.marker)!.id, protectedGroup.key)).toBe(doc);
    });
});
