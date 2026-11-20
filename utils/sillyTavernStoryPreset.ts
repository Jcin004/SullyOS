import type { StoryTheaterPresetDocument, StoryTheaterPresetPrompt } from '../types';
import { normalizeStoryPresetGeneration, parseStoryDisplayBlocks } from './storyTheater';
import { DEFAULT_STORY_PRESET_PROTOCOLS, STORY_PRESET_PROTOCOLS, type StoryPresetProtocolId } from './storyPresetProtocols';

type JsonObject = Record<string, unknown>;
type Prompt = StoryTheaterPresetPrompt;
type Marker = NonNullable<Prompt['marker']>;
type Finding = { level: 'info' | 'approximation' | 'unsupported' | 'conflict'; area: string; subject: string; detail: string };
type SourcePrompt = { identifier: string; order: number | null; sourceEnabled: boolean; prompt: Prompt; group?: string };
type OrderProfile = { key: string; label: string; entries: JsonObject[] };
type PresetInput = { data: JsonObject; sourceFileName: string; profiles: OrderProfile[] };

const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown) => typeof value === 'string' ? value : '';
const token = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const has = (record: JsonObject, key: string) => Object.hasOwn(record, key);

const markers = new Map<string, Marker>([
    ['worldInfoBefore', 'world_before'], ['personaDescription', 'user'],
    ['charDescription', 'characters'], ['charPersonality', 'characters'], ['scenario', 'scenario'],
    ['worldInfoAfter', 'world_after'], ['dialogueExamples', 'examples'], ['chatHistory', 'history'],
]);
const slotNames: Record<Marker, string> = {
    characters: '角色资料与记忆', user: '执笔身份与记忆', scenario: '剧情与事件盒',
    history: '剧场历史', world_before: '世界书前置', world_after: '世界书后置', examples: '示例对话',
};
const legacyFields = [['main', 'main_prompt'], ['nsfw', 'nsfw_prompt'], ['jailbreak', 'jailbreak_prompt']] as const;
const legacyOrder = [
    'main', 'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario',
    'nsfw', 'worldInfoAfter', 'dialogueExamples', 'chatHistory', 'jailbreak',
];
const generationFields = {
    temperature: 'temperature', topP: 'top_p', frequencyPenalty: 'frequency_penalty',
    presencePenalty: 'presence_penalty', maxTokens: 'openai_max_tokens',
} as const;

export function readSillyTavernStoryPreset(text: string, sourceFileName: string): PresetInput {
    if (text.length > 5 * 1024 * 1024) throw new Error('文件超过 5 MB');
    let data: JsonObject;
    try { data = object(JSON.parse(text.replace(/^\uFEFF/, ''))); }
    catch { throw new Error('文件不是有效的 JSON'); }
    const hasPrompts = array(data.prompts).some(value => token(object(value).identifier));
    const hasLegacy = legacyFields.some(([, key]) => string(data[key]));
    if (data.schema === 'sullyos.story-preset' || (!hasPrompts && !hasLegacy)) {
        throw new Error('请选择酒馆 Chat Completion 预设 JSON');
    }
    const order = array(data.prompt_order).map(object);
    const profiles: OrderProfile[] = order.every(row => token(row.identifier)) && order.length
        ? [{ key: 'flat', label: '扁平顺序表', entries: order }]
        : order.filter(row => Array.isArray(row.order)).map((row, index) => ({
            key: String(index), label: token(row.character_id) || '顺序 ' + (index + 1),
            entries: array(row.order).map(object),
        }));
    return { data, sourceFileName, profiles };
}

function readDefinitions(data: JsonObject, findings: Finding[]) {
    const definitions = new Map<string, JsonObject>();
    const invalid: string[] = [];
    for (const [index, value] of array(data.prompts).entries()) {
        const row = object(value);
        const id = token(row.identifier);
        if (!id) { invalid.push(String(index + 1)); continue; }
        if (definitions.has(id)) {
            findings.push({ level: 'conflict', area: '顺序', subject: id, detail: '提示词定义重复，采用第一份定义。' });
            continue;
        }
        definitions.set(id, row);
    }
    for (const [identifier, field] of legacyFields) {
        const content = string(data[field]);
        if (content) definitions.set(identifier, { ...definitions.get(identifier), identifier, content });
    }
    if (invalid.length) findings.push({ level: 'unsupported', area: '顺序', subject: invalid.join(', '), detail: '这些定义缺少 identifier。' });
    return definitions;
}

function resolveSourcePrompts(input: PresetInput, profileKey: string | undefined, findings: Finding[]) {
    const { data, profiles } = input;
    const definitions = readDefinitions(data, findings);
    const profile = profiles.find(item => item.key === profileKey) ?? profiles.find(item => item.label === '100001') ?? profiles[0];
    const legacy = !profiles.length && !array(data.prompts).length;
    const order: JsonObject[] = profile?.entries ?? (legacy
        ? legacyOrder.filter(id => markers.has(id) || definitions.has(id)).map(identifier => ({ identifier, enabled: true }))
        : [...definitions.values()]);
    if (!profile) findings.push({
        level: 'approximation', area: '顺序', subject: '顺序表',
        detail: legacy ? '旧版顶层提示词采用酒馆默认槽位顺序。' : '缺少可用顺序表，采用 prompts 数组顺序及条目自身开关。',
    });
    const referenced = new Set<string>();
    const seenMarkers = new Set<Marker>();
    const rows: SourcePrompt[] = [];

    const add = (id: string, orderEntry: JsonObject, orderIndex: number | null) => {
        const definition = definitions.get(id);
        const marker = markers.get(id);
        const name = string(definition?.name) || string(orderEntry.name) || (marker ? slotNames[marker] : id);
        if (orderIndex !== null && referenced.has(id)) {
            findings.push({ level: 'conflict', area: '顺序', subject: name, detail: '顺序表重复引用，采用第一次。' });
            return;
        }
        referenced.add(id);
        const sourceEnabled = typeof orderEntry.enabled === 'boolean' ? orderEntry.enabled : definition?.enabled !== false;
        const role = definition?.role ?? orderEntry.role;
        const prompt: Prompt = {
            id: 'st-' + (rows.length + 1) + '-' + id, name, enabled: sourceEnabled && orderIndex !== null,
            role: role === 'user' || role === 'assistant' ? role : 'system', content: string(definition?.content),
            ...(marker ? { marker } : {}),
        };
        rows.push({ identifier: id, order: orderIndex, sourceEnabled, prompt });
        const incompatible = (detail: string) => {
            prompt.enabled = false;
            findings.push({ level: 'unsupported', area: '提示词', subject: name, detail });
        };
        if (orderIndex === null) {
            findings.push({ level: 'info', area: '顺序', subject: name, detail: '条目未加入所选顺序表，保留为关闭的库存条目。' });
        }
        if (!definition && !marker) incompatible('顺序表引用了缺失的定义，保留关闭占位。');
        if (definition?.marker === true && !marker) incompatible('未知运行时槽位，保留关闭占位。');
        if (role !== undefined && role !== 'system' && role !== 'user' && role !== 'assistant') {
            incompatible('消息角色不受支持，保留为关闭条目。');
        }
        if (array(definition?.injection_trigger).length) {
            incompatible('使用酒馆触发生效条件，保留关闭。需适配对应的剧情动作。');
        }
        const position = definition?.injection_position ?? 0;
        if (position === 1 || position === '1') {
            const depth = definition?.injection_depth ?? 4;
            const priority = definition?.injection_order ?? 100;
            if (!marker && typeof depth === 'number' && Number.isSafeInteger(depth) && depth >= 0
                && typeof priority === 'number' && Number.isSafeInteger(priority)) {
                prompt.inChat = { depth, order: priority };
            } else incompatible('历史深度或优先级无效，或该槽位不支持深度注入。');
        } else if (position !== 0 && position !== '0') incompatible('未知的注入位置，保留关闭。');
        if (prompt.enabled && marker) {
            if (seenMarkers.has(marker)) findings.push({
                level: 'approximation', area: '槽位', subject: name,
                detail: '同一原生槽位只注入一次。角色描述和个性由第一处启用的角色资料槽合并接入。',
            });
            seenMarkers.add(marker);
            if (marker === 'examples') findings.push({
                level: 'unsupported', area: '槽位', subject: name,
                detail: '保留示例连接位。剧场目前没有独立的角色卡示例对话来源。',
            });
        }
    };

    order.forEach((entry, index) => {
        const id = token(entry.identifier);
        if (id) add(id, entry, index + 1);
        else findings.push({ level: 'unsupported', area: '顺序', subject: String(index + 1), detail: '顺序行缺少 identifier。' });
    });
    for (const [id, definition] of definitions) {
        if (!referenced.has(id)) add(id, definition, null);
    }
    if (!rows.length) throw new Error('预设没有可读取的提示词');
    return { rows, profile, seenMarkers };
}

function sectionPrompt(id: string, name: string, edge: 'start' | 'end'): Prompt {
    return { id: id + '-' + edge, name, enabled: false, role: 'system', content: '', section: { id, name, edge } };
}

function groupPrompts(rows: SourcePrompt[], extensions: JsonObject, findings: Finding[]): Prompt[] {
    const toolkit = object(object(extensions.baibaiToolkit).presetPromptGroups);
    const membership = object(toolkit.prompts);
    const groups = new Map(array(toolkit.groups).map(object).map(group => [token(group.id), group]));
    const byId = new Map(rows.map((row, index) => [row.identifier, index]));
    const ranges = new Map<number, { id: string; name: string }>();
    for (const value of array(extensions.entryGrouping)) {
        const group = object(value);
        const name = string(group.name) || '酒馆分组';
        const start = byId.get(token(group.startIdentifier));
        const end = byId.get(token(group.endIdentifier));
        if (start === undefined || end === undefined || start > end
            || (group.mode !== undefined && group.mode !== 'inclusive' && group.mode !== 'exclusive')) {
            findings.push({ level: 'unsupported', area: '分组', subject: name, detail: '起止端点缺失、顺序无效或分组模式未知。' });
            continue;
        }
        const first = group.mode === 'exclusive' ? start + 1 : start;
        const last = group.mode === 'exclusive' ? end - 1 : end;
        let overlap = false;
        for (let index = first; index <= last; index++) {
            if (ranges.has(index) || token(object(membership[rows[index].identifier]).groupId)) overlap = true;
            else ranges.set(index, { id: 'range-' + start + '-' + end, name });
        }
        if (overlap) findings.push({ level: 'approximation', area: '分组', subject: name, detail: '分组范围重叠，重叠条目沿用已有分组。' });
    }
    const disabledGroups = new Set<string>();
    const groupAt = rows.map((row, index) => {
        const groupId = token(object(membership[row.identifier]).groupId);
        const group = groups.get(groupId);
        if (group?.enabled === false && row.prompt.enabled) disabledGroups.add(string(group.name) || groupId);
        return groupId ? { id: groupId, name: string(group?.name) || groupId } : ranges.get(index);
    });
    for (const name of disabledGroups) findings.push({
        level: 'approximation', area: '分组', subject: name,
        detail: '插件的组开关与所选顺序表不一致，生效条目以顺序表为准。',
    });

    const prompts: Prompt[] = [];
    let cursor = 0;
    while (cursor < rows.length) {
        const group = groupAt[cursor];
        const id = 'st-section-' + cursor;
        let end = cursor + 1;
        while (end < rows.length && groupAt[end]?.id === group?.id) end++;
        if (group) prompts.push(sectionPrompt(id, group.name, 'start'));
        for (const row of rows.slice(cursor, end)) {
            row.group = group?.name;
            prompts.push(row.prompt);
        }
        if (group) prompts.push(sectionPrompt(id, group.name, 'end'));
        cursor = end;
    }
    return prompts;
}

function readGeneration(data: JsonObject, findings: Finding[]) {
    const fields: Partial<StoryTheaterPresetDocument['generation']> = {};
    for (const [target, source] of Object.entries(generationFields) as Array<[keyof typeof generationFields, string]>) {
        const raw = data[source];
        if (typeof raw === 'number' && Number.isFinite(raw)) fields[target] = raw;
        else if (has(data, source)) findings.push({ level: 'approximation', area: '采样参数', subject: source, detail: '值无效，使用原生默认值。' });
    }
    const generation = normalizeStoryPresetGeneration(fields);
    for (const key of Object.keys(fields) as Array<keyof typeof generationFields>) {
        if (fields[key] !== generation[key]) findings.push({
            level: 'approximation', area: '采样参数', subject: generationFields[key], detail: fields[key] + ' → ' + generation[key] + '（原生范围）。',
        });
    }
    for (const key of ['top_k', 'top_a', 'min_p', 'repetition_penalty', 'seed', 'n', 'openai_max_context', 'reasoning_effort', 'verbosity']) {
        if (has(data, key)) findings.push({ level: 'unsupported', area: '采样参数', subject: key,
            detail: '由酒馆或供应商管理，当前剧情请求没有此字段。' });
    }
    return generation;
}

function inspectSource(rows: SourcePrompt[], findings: Finding[]) {
    const namesByBody = new Map<string, string>();
    const singleChoice = new Map<string, string>();
    const nativeTags = new Set(['time', 'place', 'situation', 'story_text', 'reply_choices', 'choice', 'label', 'reply',
        'turn_cast', 'interaction_result', 'private_axes', 'out_of_story', 'character_id', 'character_name',
        'mt_title', 'mt_system', 'mt_ai', 'mt_user', 'name', 'text', 'owner', 'undertow', 'debt', 'origin', 'world_event', 'scope', 'change',
        ...STORY_PRESET_PROTOCOLS.flatMap(item => item.tags)]);
    const outputs = new Map<string, Set<string>>();
    const declaredNativeProtocols = new Map<string, string>();
    const protocolTags = new Set<string>(STORY_PRESET_PROTOCOLS.flatMap(item => item.tags).filter(tag => !tag.includes('/')));
    for (const { prompt } of rows) {
        if (!prompt.enabled || prompt.marker || !prompt.content.trim()) continue;
        const body = prompt.content.trim();
        const duplicate = namesByBody.get(body);
        if (duplicate) findings.push({ level: 'conflict', area: '提示词', subject: prompt.name, detail: '与「' + duplicate + '」的启用文本重复。' });
        else namesByBody.set(body, prompt.name);
        const choice = /[（(](?:选一|单选)[）)]\s*([^\s—\-：:]{1,24})[—\-：:]/.exec(prompt.name)?.[1];
        if (choice) {
            const current = singleChoice.get(choice);
            if (current) findings.push({ level: 'conflict', area: '互斥项', subject: choice, detail: '「' + current + '」与「' + prompt.name + '」同时开启。' });
            else singleChoice.set(choice, prompt.name);
        }
        const unsupportedMacros = new Set([...body.matchAll(/\{\{([^{}]+)\}\}/g)]
            .map(match => match[1]).filter(macro => !/^(?:user|char|group|charIfNotGroup|lastUserMessage)$/i.test(macro)));
        for (const macro of unsupportedMacros) findings.push({
            level: 'unsupported', area: '宏', subject: prompt.name, detail: '{{' + macro + '}} 保留为预设文本，酒馆专用宏需适配。',
        });
        const formatTokens = [...body.matchAll(/<\/([\p{L}][\p{L}\d_:-]{0,44})\s*>|:::([a-z][\w-]{0,39})\b/giu)]
            .map(match => match[1] ? match[1].toLowerCase() : ':::' + match[2]);
        for (const tag of formatTokens) {
            if (!outputs.has(tag)) outputs.set(tag, new Set());
            outputs.get(tag)!.add(prompt.name);
        }
        const lower = body.toLowerCase();
        for (const tag of new Set(formatTokens)) {
            if (!protocolTags.has(tag) || (!lower.includes('<' + tag + '>') && !lower.includes('<' + tag + ' '))) continue;
            const earlier = declaredNativeProtocols.get(tag);
            if (earlier) findings.push({ level: 'conflict', area: '协议', subject: tag,
                detail: '「' + earlier + '」与「' + prompt.name + '」都给出了完整标签，检查是否要求重复输出。' });
            else declaredNativeProtocols.set(tag, prompt.name);
        }
    }
    for (const [tag, names] of outputs) {
        const native = nativeTags.has(tag);
        findings.push({
            level: native ? 'info' : 'unsupported', area: '输出格式', subject: tag,
            detail: (native ? '标签可由对应的原生协议读取。' : '候选输出标签／区块，需要验证结构并接入原生渲染。')
                + ' 涉及条目：' + [...names].join('、'),
        });
    }
}

function inspectRegex(data: JsonObject, extensions: JsonObject, findings: Finding[]) {
    const sources = [...array(extensions.regex_scripts), ...array(data.regex_scripts)];
    const activeByEffect = new Map<string, { name: string; replacement: string }>();
    return sources.map((value, index) => {
        const script = object(value);
        const name = string(script.scriptName) || '规则 ' + (index + 1);
        const pattern = string(script.findRegex);
        const replacement = string(script.replaceString);
        const enabled = script.disabled !== true;
        const placement = array(script.placement).filter((item): item is number => typeof item === 'number' && Number.isSafeInteger(item));
        const displayOnly = script.markdownOnly === true && script.promptOnly !== true;
        const depthLimited = script.minDepth != null || script.maxDepth != null;
        // Match the textual spelling of a tiny set of display shims. Never compile the imported pattern.
        const wrapper = /^\/<([a-z_]+)>\(\[\\s\\S\]\*\?\)<\\\/\1>\/[gi]*$/.exec(pattern)?.[1];
        const plainNativeBody = wrapper === 'story_text' && replacement === '$1'
            && parseStoryDisplayBlocks('<story_text>正文</story_text>')[0]?.text === '正文';
        const native = plainNativeBody && displayOnly && !depthLimited && placement.length === 1 && placement[0] === 2
            && !array(script.trimStrings).length && !script.substituteRegex;
        const html = /<\/?(?:html|div|style|script|span|iframe|details|img|button|svg|section)\b|<!doctype/i.test(replacement);
        const target = pattern.match(/<(?:\\s[*+?])?([\p{L}][\p{L}\d_-]*)|:::([a-z][\w-]*)/iu);
        if (enabled && pattern) {
            const effect = JSON.stringify([pattern, placement.slice().sort(), script.markdownOnly === true,
                script.promptOnly === true, script.minDepth ?? null, script.maxDepth ?? null, script.substituteRegex ?? 0, array(script.trimStrings)]);
            const earlier = activeByEffect.get(effect);
            if (earlier) findings.push({ level: 'conflict', area: '正则', subject: name,
                detail: (replacement === earlier.replacement ? '重复规则：' : '同一匹配位置存在多个替换：') + earlier.name });
            else activeByEffect.set(effect, { name, replacement });
        }
        return {
            index: index + 1, id: string(script.id), name, enabled, placement,
            markdownOnly: script.markdownOnly === true, promptOnly: script.promptOnly === true,
            minDepth: typeof script.minDepth === 'number' ? script.minDepth : null,
            maxDepth: typeof script.maxDepth === 'number' ? script.maxDepth : null,
            target: target?.[1] || target?.[2] || '',
            status: native ? 'native' as const : html ? 'needs-renderer' as const : 'needs-runtime' as const,
            detail: native ? '原生 story_text 已显示标签内正文，交给原生渲染。'
                : html ? '使用 HTML／样式模板，需按对应数据结构实现原生组件。'
                : '需要适配酒馆的文本变换、深度或应用阶段。',
        };
    });
}

function inspectExtensions(data: JsonObject, extensions: JsonObject, findings: Finding[]) {
    for (const key of Object.keys(extensions)) {
        if (['entryGrouping', 'regex_scripts'].includes(key)) continue;
        if (key === 'baibaiToolkit' && Object.keys(object(extensions[key])).every(field => field === 'presetPromptGroups')) continue;
        findings.push({ level: 'unsupported', area: '扩展', subject: key,
            detail: key === 'depth_prompt' ? '扩展附加的深度提示词与 Prompt Manager 条目是两套数据，需单独适配。'
                : '扩展配置作为外部数据读取，当前剧场没有对应运行时。' });
    }
    const defaultTemplates = new Map([['wi_format', '{0}'], ['scenario_format', '{{scenario}}'], ['personality_format', '{{personality}}']]);
    for (const key of ['wi_format', 'scenario_format', 'personality_format', 'new_chat_prompt', 'new_group_chat_prompt',
        'new_example_chat_prompt', 'continue_nudge_prompt', 'assistant_impersonation', 'send_if_empty', 'group_nudge_prompt',
        'squash_system_messages', 'continue_prefill', 'continue_postfix', 'function_calling', 'enable_web_search',
        'prefer_char_prompt', 'prefer_char_jailbreak']) {
        if (data[key] && data[key] !== defaultTemplates.get(key)) findings.push({
            level: 'unsupported', area: '请求选项', subject: key, detail: '酒馆特有的请求模板或选项，剧场沿用已有的请求行为。',
        });
    }
}

export function convertSillyTavernStoryPreset(input: PresetInput, options: {
    orderKey?: string;
    protocols?: readonly StoryPresetProtocolId[];
    disabledSourceIds?: readonly string[];
} = {}) {
    const findings: Finding[] = [];
    const extensions = object(input.data.extensions);
    const { rows, profile, seenMarkers } = resolveSourcePrompts(input, options.orderKey, findings);
    const disabled = new Set(options.disabledSourceIds);
    for (const row of rows) {
        if (disabled.has(row.identifier) && row.prompt.enabled && !row.prompt.marker) {
            row.prompt.enabled = false;
            findings.push({ level: 'info', area: '提示词', subject: row.prompt.name, detail: '在转换预览中关闭。' });
        }
    }
    inspectSource(rows, findings);
    findings.push({ level: 'info', area: '请求顺序', subject: '最后一条保持用户消息',
        detail: '剧场开启该接口兼容选项时，位于本轮输入之后的源条目会提前到用户消息之前。' });
    inspectExtensions(input.data, extensions, findings);
    const regex = inspectRegex(input.data, extensions, findings);
    const prompts = groupPrompts(rows, extensions, findings);
    const selected = new Set(options.protocols ?? DEFAULT_STORY_PRESET_PROTOCOLS);
    if (selected.has('private-axes') && !selected.has('cast')) {
        selected.add('cast');
        findings.push({ level: 'info', area: '协议', subject: '私轴', detail: '私轴依赖实际出演名单，已加上出演协议。' });
    }
    const additions: Prompt[] = [];
    for (const marker of ['characters', 'user', 'scenario', 'history', 'world_before', 'world_after'] as const) {
        if (seenMarkers.has(marker)) continue;
        if (marker.startsWith('world_') && rows.some(row => row.order !== null && row.prompt.marker === marker)) continue;
        additions.push({ id: 'st-slot-' + marker, name: slotNames[marker], role: 'system', enabled: true, content: '', marker });
        findings.push({ level: 'approximation', area: '槽位', subject: slotNames[marker],
            detail: '已补入 SullyOS 的上下文连接位，源条目开关保持原样。' });
    }
    if (additions.length) {
        const scope = 'st-runtime-slots';
        const currentHistory = prompts.findIndex(prompt => prompt.enabled && prompt.marker === 'history');
        const fallback = [sectionPrompt(scope, 'SullyOS 补充槽位', 'start'), ...additions, sectionPrompt(scope, 'SullyOS 补充槽位', 'end')];
        // Keep group boundaries flat when inserting just before the history group.
        if (currentHistory < 0) prompts.push(...fallback);
        else {
            const start = prompts.slice(0, currentHistory).map(prompt => Boolean(prompt.section)).lastIndexOf(true);
            const before = start >= 0 && prompts[start].section?.edge === 'start' ? start : currentHistory;
            prompts.splice(before, 0, ...fallback);
        }
    }
    const protocolAdditions: Prompt[] = [];
    const activeSource = rows.filter(row => row.prompt.enabled && !row.prompt.marker);
    for (const protocol of STORY_PRESET_PROTOCOLS) {
        if (!selected.has(protocol.id)) continue;
        const matches = activeSource.filter(({ prompt }) => protocol.tags.some(tag => {
            const text = prompt.content.toLowerCase();
            if (tag === 'scene_header/time') return text.includes('<scene_header') && text.includes('<time>');
            return text.includes('<' + tag + '>') || text.includes('<' + tag + ' ');
        }));
        const reused = new Set<string>();
        for (const rule of protocol.prompts) {
            const same = matches.find(row => !row.prompt.inChat && row.prompt.role === rule.role && row.prompt.content.trim() === rule.content.trim());
            if (same) {
                Object.assign(same.prompt, { id: rule.id, scope: rule.scope });
                reused.add(same.identifier);
                findings.push({ level: 'info', area: '协议', subject: protocol.name, detail: '复用同内容的源条目「' + same.prompt.name + '」，保留原位置。' });
            } else protocolAdditions.push({ ...rule });
        }
        for (const row of matches.filter(row => !reused.has(row.identifier))) findings.push({
            level: 'conflict', area: '协议', subject: protocol.name,
            detail: '源条目「' + row.prompt.name + '」也引用此标签。检查输出职责，可关闭源条目或取消添加协议。',
        });
    }
    if (protocolAdditions.length) {
        const scope = 'st-native-protocols';
        prompts.push(sectionPrompt(scope, 'SullyOS 功能协议', 'start'), ...protocolAdditions, sectionPrompt(scope, 'SullyOS 功能协议', 'end'));
    }
    const name = string(input.data.name).trim() || input.sourceFileName.replace(/\.json$/i, '').trim() || '酒馆剧情预设';
    const document: StoryTheaterPresetDocument = {
        schema: 'sullyos.story-preset', version: 1, promptLayout: 'ordered', name,
        description: string(input.data.description), generation: readGeneration(input.data, findings), prompts,
        assistantPrefill: string(input.data.assistant_prefill),
    };
    if (document.assistantPrefill?.trim()) findings.push({
        level: 'approximation', area: '请求选项', subject: 'assistant_prefill',
        detail: '自由续写使用原生助手预填，出演和场外模式沿用剧场对预填的处理。',
    });
    return {
        document,
        report: {
            version: 1, sourceFileName: input.sourceFileName, order: profile?.label ?? '默认／定义顺序',
            protocols: [...selected],
            entries: rows.map(({ identifier, order, sourceEnabled, prompt, group }) => ({
                identifier, order, targetId: prompt.id, name: prompt.name, role: prompt.role, sourceEnabled, enabled: prompt.enabled,
                marker: prompt.marker, inChat: prompt.inChat, group,
            })),
            generation: document.generation,
            findings, regex,
        },
    };
}

export type SillyTavernStoryPresetInput = ReturnType<typeof readSillyTavernStoryPreset>;
export type SillyTavernStoryPresetConversion = ReturnType<typeof convertSillyTavernStoryPreset>;
