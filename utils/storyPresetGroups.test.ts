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
        expect(scoped.length).toBe(7);
        const off = compileStoryPreset({ preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: ['角色'], slots: { actors: '角色资料', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' } });
        expect(off.messages.map(row => row.content).join('\n')).not.toContain('根据用户最新输入选择剧情模式');
        const on = compileStoryPreset({
            preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: ['角色'],
            slots: { actors: '角色资料', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' },
            storyTheaterMode: 'story',
            storyTheaterValues: {
                theater_mode_state: '剧情续写',
                theater_cast_data: '[{"id":"a","name":"角色A"}]',
                theater_prefill: '<scene_header>',
                theater_previous_axes: '{"a":"继续整理行李"}',
            },
        });
        const contents = on.messages.map(row => row.content);
        const modeIndex = contents.findIndex(value => value.includes('根据用户最新输入选择剧情模式'));
        const castIndex = contents.findIndex(value => value.includes('按代码预先确定的出演名单'));
        const tendencyIndex = contents.findIndex(value => value.includes('本轮交流倾向：'));
        const continuityIndex = contents.findIndex(value => value.includes('保持人物的时间、位置'));
        const outputIndex = contents.findIndex(value => value.includes('剧情模式按顺序输出'));
        const recordIndex = contents.findIndex(value => value.includes('在剧情正文结束后、私轴之前输出'));
        const axesIndex = contents.findIndex(value => value.includes('读取并承接各角色最近的私轴'));
        expect([modeIndex, castIndex, tendencyIndex, continuityIndex, outputIndex, recordIndex, axesIndex].every(index => index >= 0)).toBe(true);
        expect([modeIndex, castIndex, tendencyIndex, continuityIndex, outputIndex, recordIndex, axesIndex]).toEqual([...([modeIndex, castIndex, tendencyIndex, continuityIndex, outputIndex, recordIndex, axesIndex])].sort((a, b) => a - b));
        expect(contents.join('\n')).toContain('剧情续写');
        expect(contents.join('\n')).toContain('继续整理行李');
        expect(contents.join('\n')).toContain('<interaction_result>');
        expect(contents.join('\n')).toContain('本轮交流倾向：');
        expect(contents.join('\n')).toContain('<scene_header>');
        const outOfStory = compileStoryPreset({
            preset: BUILTIN_NIGHT_SCREENING_PRESET, userName: '用户', characterNames: [],
            slots: { actors: '', persona: '', scenario: '', worldBefore: '', worldAfter: '', history: '' },
            storyTheaterMode: 'out_of_story',
            storyTheaterValues: { theater_mode_state: '场外重写' },
        });
        expect(outOfStory.messages.map(row => row.content).join('\n')).toContain('场外模式只输出');
        expect(outOfStory.messages.map(row => row.content).join('\n')).not.toContain('按代码预先确定的出演名单');
        expect(outOfStory.messages.map(row => row.content).join('\n')).not.toContain('在剧情正文结束后、私轴之前输出');
    });

    it('旧预设在解析时补入出演模式区，不覆盖已有提示词', () => {
        const legacy = { ...BUILTIN_NIGHT_SCREENING_PRESET.document, prompts: BUILTIN_NIGHT_SCREENING_PRESET.document.prompts.filter(prompt => !prompt.id.startsWith('nmj-v67-')) };
        const imported = parseStoryTheaterPreset(JSON.stringify(legacy), 'legacy.json');
        expect(getStoryPresetPromptGroups(imported.document).some(group => group.key === 'theater')).toBe(true);
        expect(imported.document.prompts.some(prompt => prompt.id === 'nmj-v67-theater-cast')).toBe(true);
        expect(imported.document.prompts.some(prompt => prompt.id === 'nmj-v3-people-have-engines')).toBe(true);
    });
    it('升级已有出演区：迁移旧默认规则、补入交流倾向，并保留用户改写的内容', () => {
        const oldCast = '根据候选角色与当前剧情，决定本轮出演名单和分组。不要将用户执笔的身份列入出演名单。\n{{theater_cast_data}}\n单人组记录角色独自思考或行动。多人组记录直接交流或共同参与同一段讨论，让每位组员进入这段交流。交流对象转移时另列一组，允许角色跨组。\n按本轮剧情决定分组数量、成员与顺序。使用 [A,B] [B,C] 表示交流对象转移，使用 [A,B] [C,D] 表示并行交流，使用 [A,B,C,D] 表示共同讨论。有已确定分组时，沿用原分组。';
        const oldOutput = '剧情模式按顺序输出：\n1. <turn_cast>角色 ID 的 JSON 二维数组</turn_cast>。\n2. 从预设起始文本开始的完整剧情正文。\n3. <private_axes>JSON 对象</private_axes>。\n将出演名单放在正文之前，不要写入 <scene_header> 或 <story_text>。\n场外模式只输出 <out_of_story>正文</out_of_story>。\n剧情正文起始文本（仅剧情模式使用）：\n{{theater_prefill}}';
        const legacy = {
            ...BUILTIN_NIGHT_SCREENING_PRESET.document,
            prompts: BUILTIN_NIGHT_SCREENING_PRESET.document.prompts
                .filter(prompt => prompt.id !== 'nmj-v67-theater-interaction-bias')
                .flatMap(prompt => {
                    const current = prompt.id === 'nmj-v67-theater-cast' ? { ...prompt, content: oldCast }
                        : prompt.id === 'nmj-v67-theater-output' ? { ...prompt, content: oldOutput } : prompt;
                    return prompt.id === 'nmj-v67-theater-cast'
                        ? [current, { id: 'custom-theater-note', name: '用户补充', enabled: true, role: 'system' as const, scope: 'story_theater_story' as const, content: '保留在原位置。' }]
                        : [current];
                }),
        };
        const imported = parseStoryTheaterPreset(JSON.stringify(legacy), 'older-theater.json');
        const cast = imported.document.prompts.find(prompt => prompt.id === 'nmj-v67-theater-cast')!;
        const output = imported.document.prompts.find(prompt => prompt.id === 'nmj-v67-theater-output')!;
        expect(cast.content).toContain('按代码预先确定的出演名单');
        expect(imported.document.prompts.find(prompt => prompt.id === 'nmj-v67-theater-interaction-record')?.content).toContain('<interaction_result>');
        expect(imported.document.prompts.some(prompt => prompt.id === 'nmj-v67-theater-interaction-bias')).toBe(true);
        const promptOrder = imported.document.prompts.map(prompt => prompt.id);
        expect(promptOrder.indexOf('custom-theater-note')).toBeGreaterThan(promptOrder.indexOf('nmj-v67-theater-cast'));
        expect(promptOrder.indexOf('custom-theater-note')).toBeLessThan(promptOrder.indexOf('nmj-v67-theater-continuity'));

        const edited = {
            ...legacy,
            prompts: legacy.prompts.map(prompt => prompt.id === 'nmj-v67-theater-cast'
                ? { ...prompt, content: '用户亲自修改的出演名单规则。' } : prompt),
        };
        const preserved = parseStoryTheaterPreset(JSON.stringify(edited), 'edited-theater.json');
        expect(preserved.document.prompts.find(prompt => prompt.id === 'nmj-v67-theater-cast')?.content)
            .toBe('用户亲自修改的出演名单规则。');
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
