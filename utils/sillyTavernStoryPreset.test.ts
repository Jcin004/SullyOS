import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assembleStoryPresetTurn, compileStoryPreset, getStoryPresetPromptGroups, parseStoryTheaterPreset, resolveStoryPresetDocument } from './storyTheater';
import { STORY_RELATIONSHIP_PROMPT_ID } from './storyTheaterRelationships';
import { convertSillyTavernStoryPreset, readSillyTavernStoryPreset } from './sillyTavernStoryPreset';

const convert = (data: unknown, options?: Parameters<typeof convertSillyTavernStoryPreset>[1]) =>
    convertSillyTavernStoryPreset(readSillyTavernStoryPreset(JSON.stringify(data), 'fixture.json'), options);
const restore = (result: ReturnType<typeof convert>) => parseStoryTheaterPreset(JSON.stringify(result.document), 'converted.json');
const slots = { actors: '角色记忆', persona: '我的记忆', scenario: '事件盒', worldBefore: '世界书前', worldAfter: '世界书后' };

describe('酒馆预设转换', () => {
    it('按所选角色顺序保留原文、角色、槽位和开关，在实际历史中放入深度规则', () => {
        const prompts = [
            { identifier: 'text', role: 'user', content: '  {{user}} 开场  \n' },
            { identifier: 'depth-zero', role: 'assistant', content: '深度零', injection_position: 1, injection_depth: 0 },
            { identifier: 'depth-one', role: 'system', content: '深度一', injection_position: 1, injection_depth: 1 },
            { identifier: 'depth-one-other', role: 'system', content: '{{lastUserMessage}}', injection_position: 1, injection_depth: 1 },
            { identifier: 'depth-role', role: 'assistant', content: '{{charIfNotGroup}}先回应', injection_position: 1, injection_depth: 1 },
            { identifier: 'jailbreak', role: 'assistant', content: '末尾规则' },
            { identifier: 'unused', content: '库存文本' },
        ];
        const order = ['text', 'charDescription', 'worldInfoBefore', 'depth-one', 'depth-zero', 'depth-one-other', 'depth-role', 'chatHistory', 'jailbreak', 'charPersonality'];
        const data = { prompts, prompt_order: [
            { character_id: 42, order: [{ identifier: 'jailbreak', enabled: false }] },
            { character_id: 100001, order: order.map(identifier => ({ identifier, enabled: true })) },
        ] };
        const result = convert(data, { protocols: [] });
        expect(result.report.order).toBe('100001');
        expect(result.report.entries.map(row => row.identifier)).toEqual([...order, 'unused']);
        expect(result.report.entries.at(-1)).toMatchObject({ order: null, enabled: false });
        const preset = restore(result);
        expect(preset.document).toEqual(result.document);
        const pendingTurn = { role: 'user' as const, content: '本轮输入' };
        const compiled = compileStoryPreset({
            preset, slots, userName: '测试用户', characterNames: ['甲'],
            historyMessages: [{ role: 'assistant', content: '上一楼层' }], pendingTurn,
        });
        const assembled = assembleStoryPresetTurn(compiled.messages, [{ role: 'system', content: '运行时规则' }], pendingTurn);
        expect(assembled.map(row => row.content)).toEqual([
            '  测试用户 开场  \n', '角色记忆', '世界书前', '我的记忆', '事件盒', '世界书后',
            '上一楼层', '甲先回应', '深度一\n本轮输入', '运行时规则', '本轮输入', '深度零', '末尾规则',
        ]);
        expect(assembled.find(row => row.content === '末尾规则')?.role).toBe('assistant');
        expect(assembleStoryPresetTurn(compiled.messages, [], pendingTurn, undefined, true).at(-1)).toBe(pendingTurn);
        expect(convert(data, { orderKey: '0', protocols: [] }).report.entries[0]).toMatchObject({ identifier: 'jailbreak', enabled: false });
    });

    it('处理旧版顶层文本，补原生槽位并报告采样参数限制', () => {
        const result = convert({
            main_prompt: '保留文学规则。', nsfw_prompt: '可选规则。', jailbreak_prompt: '历史后的规则。',
            temperature: 1.7, top_p: 0.87, frequency_penalty: 0.2, presence_penalty: -0.4,
            openai_max_tokens: 64_000, top_k: 30,
        });
        const preset = restore(result);
        expect(preset.document.generation).toEqual({ temperature: 1.7, topP: 0.87, frequencyPenalty: 0.2, presencePenalty: -0.4, maxTokens: 32000 });
        expect(preset.document.prompts.find(prompt => prompt.id === STORY_RELATIONSHIP_PROMPT_ID)?.enabled).toBe(true);
        expect(preset.document.prompts.filter(prompt => prompt.id.startsWith('st-') && prompt.content).map(prompt => prompt.content))
            .toEqual(['保留文学规则。', '可选规则。', '历史后的规则。']);
        expect(result.report.findings).toEqual(expect.arrayContaining([
            expect.objectContaining({ subject: 'openai_max_tokens', level: 'approximation' }),
            expect.objectContaining({ subject: 'top_k', level: 'unsupported' }),
        ]));
    });

    it('保留分组和源文本，报告重复、互斥、危险模板和不可移植的深度条件', () => {
        const prompts = [
            { identifier: 'a', name: '（选一）风格-甲', content: '<mini_theater>例</mini_theater>\n{{getvar::foo}}' },
            { identifier: 'b', name: '（选一）风格-乙', content: '<mini_theater>例</mini_theater>\n{{getvar::foo}}' },
            { identifier: 'non-normal', content: '静默段', injection_trigger: ['quiet'] },
        ];
        const simple = { placement: [2], markdownOnly: true, findRegex: '/<story_text>([\\s\\S]*?)<\\/story_text>/g' };
        const data = { prompts, extensions: {
            entryGrouping: [{ name: '选项组', mode: 'inclusive', startIdentifier: 'a', endIdentifier: 'b' }],
            regex_scripts: [
                { ...simple, scriptName: '原生正文', replaceString: '$1' },
                { ...simple, scriptName: '网页模板', replaceString: '<script>globalThis.run = 1</script><div>$1</div>' },
                { ...simple, scriptName: '有深度', replaceString: '$1', minDepth: 1 },
                { scriptName: '不可信正则', placement: [2], findRegex: '(a+)+$', replaceString: '' },
            ],
        } };
        const result = convert(data, { protocols: ['mini-theater'] });
        expect(result.report.regex.map(item => item.status)).toEqual(['native', 'needs-renderer', 'needs-runtime', 'needs-runtime']);
        expect(JSON.stringify(result.document)).not.toContain('globalThis');
        expect(JSON.stringify(result.document)).not.toContain('(a+)+$');
        expect(result.report.findings).toEqual(expect.arrayContaining(
            ['提示词', '互斥项', '协议', '正则'].map(area => expect.objectContaining({ area, level: 'conflict' })),
        ));
        expect(getStoryPresetPromptGroups(restore(result).document).find(group => group.label === '选项组')?.promptIds).toHaveLength(4);
        expect(result.report.entries.find(row => row.identifier === 'non-normal')).toMatchObject({ sourceEnabled: true, enabled: false });
        const after = convert(data, { protocols: [], disabledSourceIds: ['b'] });
        expect(after.report.findings.some(item => item.level === 'conflict' && item.area === '互斥项')).toBe(false);
        expect(resolveStoryPresetDocument(restore(after)).prompts.some(row => row.id === 'nmj-v3-theater-custom')).toBe(false);
    });

    it('保留关闭的来源槽位，同时补剧场连续性所需连接位', () => {
        const { document } = convert({
            prompts: [{ identifier: 'main', content: '正文' }],
            prompt_order: ['main', 'charDescription', 'chatHistory', 'worldInfoBefore'].map(identifier => ({ identifier, enabled: identifier === 'main' })),
        });
        expect(document.prompts.filter(prompt => prompt.marker === 'characters').map(prompt => prompt.enabled)).toEqual([false, true]);
        expect(document.prompts.filter(prompt => prompt.marker === 'history').map(prompt => prompt.enabled)).toEqual([false, true]);
        expect(document.prompts.filter(prompt => prompt.marker === 'world_before').map(prompt => prompt.enabled)).toEqual([false]);
        expect(document.prompts.filter(prompt => prompt.scope === 'story_theater_story').map(prompt => prompt.id)).toContain('nmj-v67-theater-private-axes');
    });

    it('场外重写沿用场外回合，跳过原生正篇协议', () => {
        const preset = restore(convert({ main_prompt: '文学规则' }, {
            protocols: ['experience-time', 'cast', 'scene', 'backstage', 'worldline', 'mini-theater', 'relationships'],
        }));
        const { messages } = compileStoryPreset({
            preset, slots, userName: '甲', characterNames: ['乙'], storyTheaterMode: 'out_of_story', relationshipMode: 'skip',
        });
        const text = messages.map(message => message.content).join('\n');
        expect(text).toContain('<out_of_story>');
        expect(text).not.toMatch(/<(?:scene_header|backstage|worldline|mini_theater|affinity_panel|turn_cast)>/);
    });

    it('拒绝原生预设和没有有效提示词的 JSON', () => {
        expect(() => readSillyTavernStoryPreset('{"prompts":[null]}', 'empty.json')).toThrow();
        expect(() => readSillyTavernStoryPreset(JSON.stringify(convert({ main_prompt: '测试' }).document), 'native.json')).toThrow();
    });
});

const samplePath = process.env.SULLY_TAVERN_SAMPLE;
it.skipIf(!samplePath)('真实样本保留 311 条提示词、两种深度开关与分组，标出 92 条正则', () => {
    const text = readFileSync(samplePath!, 'utf8');
    const sample = JSON.parse(text.replace(/^\uFEFF/, ''));
    const result = convertSillyTavernStoryPreset(readSillyTavernStoryPreset(text, '【众生相】Gemini-v4.3.json'));
    const imported = restore(result);
    const prompts = new Map(imported.document.prompts.map(prompt => [prompt.id, prompt]));
    expect(result.report.entries.length).toBe(311);
    expect(result.report.entries.filter(entry => entry.enabled).length).toBe(87);
    expect(result.report.entries.map(entry => entry.identifier)).toEqual(sample.prompt_order[0].order.map((entry: { identifier: string }) => entry.identifier));
    for (const [index, entry] of result.report.entries.entries()) {
        const source = sample.prompts.find((row: { identifier: string }) => row.identifier === entry.identifier);
        expect(prompts.get(entry.targetId)?.content).toBe(source.content ?? '');
        expect(entry.sourceEnabled).toBe(sample.prompt_order[0].order[index].enabled);
        expect(entry.role).toBe(source.role);
    }
    const depths = result.report.entries.filter(row => row.inChat);
    expect(depths.map(row => [row.inChat?.depth, row.enabled])).toEqual(expect.arrayContaining([[1, true], [1, false]]));
    expect(getStoryPresetPromptGroups(imported.document).map(group => group.label))
        .toEqual(expect.arrayContaining(['顶部', '文风设定', '背景设定', '小剧场', 'SullyOS 功能协议']));
    expect(imported.document.generation).toEqual({ temperature: 1, topP: 0.88, frequencyPenalty: 0.4, presencePenalty: 0.3, maxTokens: 30000 });
    expect(result.report.regex.length).toBe(92);
    expect(result.report.regex.filter(row => row.enabled).length).toBe(16);
    expect(result.report.regex.find(row => row.name === '（9）电影片尾')?.status).toBe('needs-renderer');
    expect(result.report.findings.some(item => item.subject === 'depth_prompt')).toBe(true);
    expect(imported.document).toEqual(result.document);
});
