import type { Message, StoryTheaterPresetDocument } from '../types';

export const STORY_RELATIONSHIP_PROMPT_ID = 'nmj-v65-affinity-control';
export const STORY_RELATIONSHIP_AXES = ['FL', 'RI', 'DI'] as const;
export const STORY_RELATIONSHIP_LABELS = { FL: '关系联结', RI: '恋爱性心动', DI: '失序扰动' };

type Axis = typeof STORY_RELATIONSHIP_AXES[number];
type Strength = 'mild' | 'moderate' | 'strong';

interface Actor {
    id: string;
    name: string;
}

interface AxisValue {
    score: number;
    delta?: number;
    trigger?: string;
    evidence?: string;
    strength?: Strength;
    phase?: 'active' | 'ended';
}

interface Relationship {
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    axes: Partial<Record<Axis, AxisValue>>;
    relation_note?: string;
}

export interface StoryRelationshipPanel {
    primaryId: string;
    primaryName: string;
    state_note?: string;
    relationships: Relationship[];
}

export const STORY_RELATIONSHIP_PROMPT = [
    '主要角色由剧场设置中的角色 ID 确定，与用户执笔身份分别处理。主要角色在场时，分别记录其与其他出演角色的两个方向。',
    'FL 关系联结：信任、默契、熟悉、共同经历。可靠的陪伴、理解和合作可加深联结，失信、排斥和不适可削弱联结，依据具体相处缓慢变化。',
    'RI 恋爱性心动：由明确的恋爱性吸引触发，如恋爱性的注意、回味、渴望、亲密倾向。辨别竞争性占有与恋爱性亲密排他。时间和距离本身不扣分，有具体的心动消退、反感或排斥才更新。',
    'DI 失序扰动：具体事件让情绪、注意力或行动节奏偏移，如冒犯、挑衅、胜负、尴尬、惊讶或社交压力。普通好奇不计入。事件仍造成扰动时记 active，结束当轮记 ended；没有扰动事件则省略 phase 和 strength，由程序回落。',
    '结合双方各自的人格七维、认知和亲历事实判断吸引来源是否影响注意和具体轴：',
    '身体/审美（外貌、声音、气味、体态、触碰与距离）；能力/人格（才华、专注、判断力、价值观与底线）；被看见/安全（理解、记住细节、接住情绪、尊重边界与可靠）；',
    '互惠偏爱（被选择、主动、好感暗示与熟悉曝光）；情绪/经历（快乐、日常陪伴、共患难、遗憾与未完成）；反差/未知/社会（神秘、探索、他人认可、竞争与投射）；成长激励（想成为更好的自己、想配得上或并肩）。',
    '从每个方向的出发人物独立判断。人物只拥有自己能够知道的故事内事实。面板供读者回看。三轴各为 0–100，分别更新，同一事件影响多轴时逐轴写触发事件与证据。',
    '沿用主要角色自身的 state_note，记录其内在拉扯、选择代价或已形成的新理解。只在有新事实时更新。各方向可用 relation_note 记录当前的关系质地。',
].join('\n');

const panelPattern = /<relationship_panel\b[^>]*>([\s\S]*?)<\/relationship_panel\s*>/gi;

const legacyPanelPattern = /<affinity_panel\b[^>]*>([\s\S]*?)<\/affinity_panel\s*>/gi;
const legacyPersonPattern = /<affinity_person\b[^>]*>([\s\S]*?)<\/affinity_person\s*>/gi;

const shortText = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 400) : '';
const integer = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
const clamp = (score: number) => Math.max(0, Math.min(100, score));
const pairKey = (fromId: string, toId: string) => JSON.stringify([fromId, toId]);

const encodePanel = (value: unknown) => JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

function readPanel(body: string): StoryRelationshipPanel | undefined {
    let value;
    try {
        value = JSON.parse(body.trim().replace(/^(?:~~~|\x60{3})(?:json)?\s*|\s*(?:~~~|\x60{3})$/gi, ''));
    } catch {
        return undefined;
    }
    if (typeof value?.primaryId !== 'string' || !Array.isArray(value.relationships)) return undefined;
    return value;
}

export function parseStoryRelationshipPanel(body: string): StoryRelationshipPanel | undefined {
    const value = readPanel(body);
    if (!value) return undefined;
    return {
        primaryId: value.primaryId,
        primaryName: shortText(value.primaryName),
        state_note: shortText(value.state_note),
        relationships: value.relationships.flatMap(row => {
            if (typeof row?.fromId !== 'string' || typeof row?.toId !== 'string'
                || row.fromId === row.toId || ![row.fromId, row.toId].includes(value.primaryId)) return [];
            const axes: Relationship['axes'] = {};
            for (const axis of STORY_RELATIONSHIP_AXES) {
                const item = row.axes?.[axis];
                const score = integer(item?.score);
                if (!item || score === undefined) continue;
                const strength = item.strength;
                axes[axis] = {
                    score: clamp(score),
                    delta: integer(item.delta),
                    trigger: shortText(item.trigger),
                    evidence: shortText(item.evidence),
                    ...(strength === 'mild' || strength === 'moderate' || strength === 'strong' ? { strength } : {}),
                };
            }
            return [{
                fromId: row.fromId, toId: row.toId,
                fromName: shortText(row.fromName) || row.fromId,
                toName: shortText(row.toName) || row.toId,
                axes, relation_note: shortText(row.relation_note),
            }];
        }),
    };
}

function readLegacyStateNote(content: string, primaryId: string): string {
    for (const [, panel] of content.matchAll(legacyPanelPattern)) {
        for (const [, person] of panel.matchAll(legacyPersonPattern)) {
            const id = /<character_id>([^<]+)<\/character_id>/i.exec(person)?.[1]?.trim();
            if (id === primaryId) return shortText(/<state_note>([^<]+)<\/state_note>/i.exec(person)?.[1]);
        }
    }
    return '';
}

export function stripStoryRelationshipPanels(content: string): string {
    return content
        .replace(/<(relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(?:relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?(?=<(?:scene_header|story_text|backstage|worldline|shot_debts|mini_theater|reply_choices)\b|$)/gi, '')
        .trim();
}

const decayDI = (score: number, strength?: Strength) => {
    if (strength === 'strong') return Math.floor(score * 0.8);
    if (strength === 'moderate') return Math.floor(score * 0.7);
    return clamp(score - 5);
};

/** Use the retained message history, including archived originals, up to the turn being generated. */
export function getStoryRelationshipBaseline(
    messages: readonly Message[], primary: Actor, actors: readonly Actor[],
): StoryRelationshipPanel {
    const relationships = actors.filter(actor => actor.id !== primary.id)
        .flatMap(actor => [[actor, primary], [primary, actor]])
        .map(([from, to]): Relationship => ({
            fromId: from.id, toId: to.id, fromName: from.name, toName: to.name, axes: {},
        }));
    const byPair = new Map(relationships.map(row => [pairKey(row.fromId, row.toId), row]));
    let stateNote = '';
    let skippedTurns = 0;
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role !== 'assistant' || message.metadata?.theaterOutOfStory) continue;
        const raw = [...message.content.matchAll(panelPattern)].at(-1)?.[1];
        const panel = raw && parseStoryRelationshipPanel(raw);
        if (panel) {
            if (!stateNote && panel.primaryId === primary.id) stateNote = panel.state_note || '';
            for (const previous of panel.relationships) {
                const row = byPair.get(pairKey(previous.fromId, previous.toId));
                if (!row) continue;
                if (!row.relation_note && previous.relation_note) row.relation_note = previous.relation_note;
                for (const axis of STORY_RELATIONSHIP_AXES) {
                    const item = previous.axes[axis];
                    if (!item || row.axes[axis]) continue;
                    let score = item.score;
                    if (axis === 'DI') {
                        for (let turn = 0; turn < skippedTurns && score > 0; turn++) score = decayDI(score, item.strength);
                    }
                    row.axes[axis] = { score, strength: item.strength };
                }
            }
        }
        if (!stateNote && !panel) stateNote = readLegacyStateNote(message.content, primary.id);
        if (stateNote && relationships.every(row => STORY_RELATIONSHIP_AXES.every(axis => row.axes[axis]))) break;
        skippedTurns++;
    }
    return { primaryId: primary.id, primaryName: primary.name, state_note: stateNote, relationships };
}

export function buildStoryRelationshipGuide(baseline?: StoryRelationshipPanel): string {
    if (!baseline) return '本轮没有主要角色出演，省略关系面板。';
    return [
        '剧情模式在正文和其他附加模块之后输出唯一一组 <relationship_panel>JSON 对象</relationship_panel>；场外模式不输出关系面板。沿用下列 primaryId 及每条 fromId、toId；所有方向各写一次。数值只承接下列同一角色 ID 和方向的基线。历史正文、事件盒与回忆只提供事件和认知。',
        '各方向在 axes 内分别写 FL、RI、DI。沿用已存在的轴，变化时返回整数 delta，由程序据基线计算。首次从角色卡及已发生事件独立估计整数 score，缺少证据时填 0。为数值变化提供 trigger（事件）和 evidence（该人物的反应或推断）。',
        'DI 的 active 或 ended 需有 trigger、evidence 和 strength（mild / moderate / strong）；无事件时留空，由程序衰减。state_note 沿用下面主要角色自己的记录或按本轮事实更新。',
        '示例轴字段："axes":{"FL":{"score":20,"delta":2,"trigger":"接住了她的邀请","evidence":"她愿意把下一次见面的安排交给对方"},"RI":{"score":0},"DI":{"score":0}}',
        '本轮身份和基线：',
        encodePanel(baseline),
    ].join('\n');
}

function reconcileAxis(axis: Axis, previous: AxisValue | undefined, proposed?: AxisValue): AxisValue | undefined {
    const score = integer(proposed?.score);
    if (!previous && score === undefined) return undefined;
    const prior = previous?.score ?? 0;
    const trigger = shortText(proposed?.trigger);
    const evidence = shortText(proposed?.evidence);
    const strength = proposed?.strength;
    const supported = Boolean(trigger && evidence);
    const change = previous ? integer(proposed?.delta) ?? 0 : score ?? 0;
    if (axis === 'DI') {
        const phase = proposed?.phase;
        if (supported && (phase === 'active' || phase === 'ended')
            && (strength === 'mild' || strength === 'moderate' || strength === 'strong')) {
            const peak = clamp(prior + change);
            const next = phase === 'active' ? peak : decayDI(peak, strength);
            return { score: next, delta: next - prior, trigger, evidence, strength };
        }
        const next = decayDI(prior, previous?.strength);
        return {
            score: next, delta: next - prior, strength: previous?.strength,
            ...(next !== prior ? { trigger: '无持续扰动', evidence: '扰动回落' } : {}),
        };
    }
    const next = clamp(prior + (supported ? change : 0));
    return { score: next, delta: next - prior, ...(next !== prior ? { trigger, evidence } : {}) };
}

/** Store a canonical panel with the reply, so reroll and archive use the same immutable turn boundary. */
export function reconcileStoryRelationships(content: string, baseline?: StoryRelationshipPanel): string {
    const raw = [...content.matchAll(panelPattern)].at(-1)?.[1];
    const parsed = raw && readPanel(raw);
    const prose = stripStoryRelationshipPanels(content);
    if (!baseline) return prose;
    const proposal = parsed && parsed.primaryId === baseline.primaryId ? parsed : undefined;
    const changes = new Map(proposal?.relationships
        .filter(row => typeof row?.fromId === 'string' && typeof row.toId === 'string')
        .map(row => [pairKey(row.fromId, row.toId), row]));
    const relationships = baseline.relationships.map(row => {
        const proposed = changes.get(pairKey(row.fromId, row.toId));
        const axes: Relationship['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const value = reconcileAxis(axis, row.axes[axis], proposed?.axes?.[axis]);
            if (value) axes[axis] = value;
        }
        return { ...row, axes, relation_note: shortText(proposed?.relation_note) || row.relation_note };
    }).filter(row => Object.keys(row.axes).length || row.relation_note);
    const stateNote = shortText(proposal?.state_note) || baseline.state_note;
    if (!stateNote && relationships.length === 0) return prose;
    return prose + '\n\n<relationship_panel>\n' + encodePanel({
        ...baseline, state_note: stateNote, relationships,
    }) + '\n</relationship_panel>';
}

export function formatStoryRelationshipPanel(panel: StoryRelationshipPanel): string {
    return [
        panel.state_note ? panel.primaryName + ' · 自我记录：' + panel.state_note : '',
        ...panel.relationships.map(row => [
            row.fromName + ' → ' + row.toName,
            ...STORY_RELATIONSHIP_AXES.flatMap(axis => {
                const value = row.axes[axis];
                if (!value) return [];
                const delta = value.delta ? ' (' + (value.delta > 0 ? '+' : '') + value.delta + ')' : '';
                const evidence = [value.trigger, value.evidence].filter(Boolean).join(' · ');
                return [axis + ' ' + STORY_RELATIONSHIP_LABELS[axis] + '：' + value.score + delta + (evidence ? ' · ' + evidence : '')];
            }),
            row.relation_note || '',
        ].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n\n');
}

export function upgradeStoryRelationshipPrompts(document: StoryTheaterPresetDocument): StoryTheaterPresetDocument {
    if (!document.prompts.some(prompt => prompt.id === STORY_RELATIONSHIP_PROMPT_ID)) return document;
    return {
        ...document,
        prompts: document.prompts
            .filter(prompt => !['nmj-v65-affinity-opaque', 'nmj-v65-affinity-transparent'].includes(prompt.id))
            .map(prompt => {
                if (prompt.id === STORY_RELATIONSHIP_PROMPT_ID) {
                    return { ...prompt, name: '💗双向关系｜FL · RI · DI', content: STORY_RELATIONSHIP_PROMPT };
                }
                let { name, content } = prompt;
                if (prompt.id === 'nmj-v65-section-affinity-start') name = '🧩↓双向关系｜FL · RI · DI';
                if (prompt.id === 'nmj-v65-section-affinity-end') name = '🧩↑双向关系｜结束';
                if (prompt.id === 'nmj-v616-silent-preflight') {
                    content = content
                        .replace(/；<u_affinity> 属于执笔灯号；/, '；')
                        .replace(/，最新 U→C 与 reason 又反馈了怎样的阅读体验；/, '；')
                        .replace(/^6\. 关系侧表：.*(?:五根推子|五维).*$/gm, '6. 关系侧表：启用双向关系时，以出演角色 ID 确认双方，分别依据各自亲历事件更新 FL、RI、DI。')
                        .replace(/^.*(?:理解|读取)执笔灯号.*$/gm, '').trimEnd();
                }
                if (prompt.id === 'nmj-v3-exit-check') {
                    content = content.replace(/每位角色按 character_id[^\n]+/g, '启用双向关系时，检查两个方向各自的证据和三轴变化。');
                }
                if (prompt.id === 'nmj-v619-possession-humanity') {
                    content = content.replace('而关系温度与占有拉力同时处在高位', '而真心与占有冲动同时强烈');
                }
                if (prompt.id === 'nmj-v6-gemini-format-lock') {
                    content = content.replace(/启用(?:多角色双向关系温度|双向好感)时，<affinity_panel> 必须完整且只出现一次；/g,
                        '本轮要求输出关系面板时，<relationship_panel> 必须完整且只出现一次；');
                }
                if (['nmj-v3-scene-header', 'nmj-v3-exit-check'].includes(prompt.id)) {
                    content = content.replace(/多角色双向关系温度|双向好感|双向温度/g, '双向关系三轴');
                }
                return { ...prompt, name, content };
            }),
    };
}
