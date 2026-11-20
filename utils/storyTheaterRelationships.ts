import type { Message, StoryTheaterPresetDocument } from '../types';
import { storyCandidateResolver } from './storyTheaterCast';

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
    /** A delta-only report cannot initialize an axis. */
    hasScore?: boolean;
    delta?: number;
    trigger?: string;
    evidence?: string;
    strength?: Strength;
    phase?: 'active' | 'ended';
    /** v2 replay: first assessment vs a delta from an existing score. */
    initial?: boolean;
    /** Input before clamping/DI decay; delta remains the displayed net change. */
    eventDelta?: number;
}

interface Relationship {
    fromId: string;
    toId: string;
    fromName: string;
    toName: string;
    axes: Partial<Record<Axis, AxisValue>>;
    relation_note?: string;
    relation_fragments?: string[];
    identity?: string;
    cognition?: string;
    trigger?: string;
    evidence?: string;
}

export type StoryRelationshipAxis = Axis;
export type StoryRelationshipAxisValue = AxisValue;
export type StoryRelationshipDirection = Relationship;
export type StoryRelationshipActor = Actor;

export interface StoryRelationshipPanel {
    primaryId: string;
    primaryName: string;
    state_note?: string;
    relationships: Relationship[];
    historyVersion?: 2;
    state_notes?: Record<string, { name: string; note: string }>;
    actors?: Actor[];
    /** Distinguish a deliberately empty report from entries discarded during parsing. */
    hadRelationshipEntries?: boolean;
}

export interface StoryRelationshipUpdate {
    direction: Relationship;
    mode: 'proposal' | 'snapshot' | 'canonical' | 'manual';
    clearAxes?: Axis[];
    decayDI?: true;
}

export interface StoryRelationshipPayload {
    version: 1;
    updates: StoryRelationshipUpdate[];
    stateNotes: NonNullable<StoryRelationshipPanel['state_notes']>;
}

export interface StoryRelationshipParticipation {
    cast: ReadonlySet<string>;
    interactions: readonly (readonly string[])[];
}

export const LEGACY_CENTERED_STORY_RELATIONSHIP_PROMPT = "主要角色由剧场设置中的角色 ID 确定，与用户执笔身份分别处理。主要角色在场时，分别记录其与其他出演角色的两个方向。\nFL 关系联结：信任、默契、熟悉、共同经历。首次记录依据双方各自的角色卡、既有关系和共同经历确定初值。后续依据陪伴、理解、合作、失信、排斥等具体相处事实缓慢变化。\nRI 恋爱性心动：由明确的恋爱性吸引触发，如恋爱性的注意、回味、渴望、亲密倾向。辨别竞争性占有与恋爱性亲密排他。时间和距离本身不扣分，有具体的心动消退、反感或排斥才更新。\nDI 失序扰动：具体事件让情绪、注意力或行动节奏偏移，如冒犯、挑衅、胜负、尴尬、惊讶或社交压力。普通好奇不计入。事件仍造成扰动时记 active，结束当轮记 ended；没有扰动事件则省略 phase 和 strength，由程序回落。\n结合双方各自的人格七维、认知和亲历事实判断吸引来源是否影响注意和具体轴：\n身体/审美（外貌、声音、气味、体态、触碰与距离）；能力/人格（才华、专注、判断力、价值观与底线）；被看见/安全（理解、记住细节、接住情绪、尊重边界与可靠）；\n互惠偏爱（被选择、主动、好感暗示与熟悉曝光）；情绪/经历（快乐、日常陪伴、共患难、遗憾与未完成）；反差/未知/社会（神秘、探索、他人认可、竞争与投射）；成长激励（想成为更好的自己、想配得上或并肩）。\n从每个方向的出发人物独立判断。人物只拥有自己能够知道的故事内事实。面板供读者回看。三轴各为 0–100，分别更新，同一事件影响多轴时逐轴写触发事件与证据。\n沿用主要角色自身的 state_note，记录其内在拉扯、选择代价或已形成的新理解。只在有新事实时更新。各方向可用 relation_note 记录当前的关系质地。";

export const LEGACY_PAIR_STORY_RELATIONSHIP_PROMPT = [
    '按本轮正文实际发生关系事件的双方角色 ID 记录，每对分别判断两个方向；任意两位角色都可以更新，不设主要角色中心。只同场、旁观、被提及或出现在非正篇小剧场不构成关系事件。',
    'FL 关系联结：信任、默契、熟悉、共同经历。首次记录依据双方各自的角色卡、既有关系和共同经历确定初值。后续依据陪伴、理解、合作、失信、排斥等具体相处事实缓慢变化。',
    'RI 恋爱性心动：由明确的恋爱性吸引触发，如恋爱性的注意、回味、渴望、亲密倾向。辨别竞争性占有与恋爱性亲密排他。时间和距离本身不扣分，有具体的心动消退、反感或排斥才更新。',
    'DI 失序扰动：具体事件让情绪、注意力或行动节奏偏移，如冒犯、挑衅、胜负、尴尬、惊讶或社交压力。普通好奇不计入。事件仍造成扰动时记 active，结束当轮记 ended；没有扰动事件则省略 phase 和 strength，由程序回落。',
    '结合双方各自的人格七维、认知和亲历事实判断吸引来源是否影响注意和具体轴：',
    '身体/审美（外貌、声音、气味、体态、触碰与距离）；能力/人格（才华、专注、判断力、价值观与底线）；被看见/安全（理解、记住细节、接住情绪、尊重边界与可靠）；',
    '互惠偏爱（被选择、主动、好感暗示与熟悉曝光）；情绪/经历（快乐、日常陪伴、共患难、遗憾与未完成）；反差/未知/社会（神秘、探索、他人认可、竞争与投射）；成长激励（想成为更好的自己、想配得上或并肩）。',
    '从每个方向的出发人物独立判断。人物只拥有自己能够知道的故事内事实。面板供读者回看。三轴各为 0–100，分别更新，同一事件影响多轴时逐轴写触发事件与证据。',
    '只更新有新关系事实的人物对，其他人的 FL、RI、DI 保持历史；本轮被记录的人物对中，RI/DI 继续按上述规则计算。两个方向各自给证据，不能照抄分数；缺少另一方向的事实时保留其历史。',
    '自我记录用 <self_record><character_id>角色 ID</character_id><state_note>新理解、内在拉扯或选择代价</state_note></self_record>，仅在该人物有新事实时填写。各方向可用 relation_note 记录当前的关系质地。',
].join('\n');

export const LEGACY_REAL_STORY_RELATIONSHIP_PROMPT = LEGACY_PAIR_STORY_RELATIONSHIP_PROMPT + '\n' + [
    '真实陪伴剧场共用一张真实世界关系网，虚构剧场使用自己的独立关系历史。真实关系变化、出演名单和私轴在本轮同一次回复中分别记录；名单格式问题不影响已经成立的关系事件。',
    '真实世界每个方向还可分别更新关系认同 relation_identity（我认为对方是我的什么人）与第一视角关系认知 relation_cognition，附 relation_trigger 和 relation_evidence；它们是该人物的私有认知，不能泄露给未获知此事的其他人物。',
    '真实关系的称谓、认知与三轴独立更新。没有变化的轴省略并维持原值；DI 只有明确记录本轴事件时才计算，包括 ended 回落。数值 0 已初始化，缺少该轴才是尚未初始化。',
].join('\n');

export const PREVIOUS_STORY_RELATIONSHIP_PROMPT = LEGACY_REAL_STORY_RELATIONSHIP_PROMPT
    .replace('没有扰动事件则省略 phase 和 strength，由程序回落。', '虚构剧场没有扰动事件时由程序按既有规则回落。')
    + '\n' + [
        '剧情结束后输出一份 <affinity_panel mode="three_axes">，场外省略。按已给的人物 ID 更新有新事实的方向与轴。虚构出演模式的双方也须列入出演名单。',
        '每轴首次评估填 score，已有值填 delta，附 trigger（触发事件）和 evidence（具体事实）。没有变化时省略该轴。DI 可用 active / ended 和 mild / moderate / strong。',
        '<affinity_panel mode="three_axes"><affinity_person><from_id>起点ID</from_id><to_id>终点ID</to_id><FL><delta>5</delta><trigger>触发事件</trigger><evidence>具体事实</evidence></FL></affinity_person></affinity_panel>',
    ].join('\n');

export const STORY_RELATIONSHIP_PROMPT = [
    "从本轮正篇的亲历或明确获知的事实评估人物关系。用候选人物 ID 标识起点和终点，各方向独立。只同场、被提及、交流倾向和非正篇小剧场不能作为加减分的证据。三个轴独立，范围均为 0–100。",
    "FL 关系联结（Friendship Level）：衡量信任、熟悉、默契和陪伴。首次参考角色卡、既有关系与共同经历。理解、陪伴、合作、可靠、安心和主动支持可增加，失信、反感、排斥、失落、冲突和具体经历造成的疏离可减少，通常缓慢变化。",
    "RI 恋爱性心动（Romance Index）：原生审美受触动、对外貌或声音等产生恋爱性注意、回味某个瞬间、想靠近或想念、渴望亲密、恋爱性排他和亲密占有，都可能增加。心动消退、吸引减弱、自我消化、重新认识、反感或实际冷却可减少。时间和距离只有造成可辨认的心动变化才扣分。轻微心动也要记录，区分恋爱性排他与竞争性占有。RI 不自动衰减。",
    "DI 失序扰动（Disorder Index）：衡量对方使自己的注意力、情绪或行动节奏发生即时偏移。额外观察、追问、反复琢磨的好奇或探究，被气、冒犯、受挫、挑衅、斗嘴、胜负欲、竞争性占有，尴尬、惊讶、社交压力、领地与面子被触动，审美刺激、亲密接触导致失措，以及被打断注意或耽误原定行动，均可触发。按实际注意偏移、强度、持续和行为后果判断 mild / moderate / strong。扰动仍持续（即使没有新增量）用 active，已结束用 ended。没有持续扰动时省略 DI，程序只对确认参与本轮相关情节的人物方向执行回落。",
    "结合人格、经历、认知和情境，从七类来源独立判断 FL、RI、DI 或注意倾向：",
    "1. 身体/审美：外貌、声音、气味、体态、触碰、距离、近距离紧张唤醒。",
    "2. 能力／人格：才华、专注、判断力、价值观、原则、底线。",
    "3. 被看见／安全：理解、记住细节、接住情绪、尊重边界、可靠、保护、可放松。",
    "4. 互惠／偏爱：被选择、被主动、被偏爱、好感暗示、熟悉曝光。",
    "5. 情绪／经历：快乐、松弛、被逗笑、分享日常、陪伴、共患难、遗憾、未完成。",
    "6. 反差／未知／社会：反差、神秘、探索、他人认可、稀缺竞争、理想化投射。",
    "7. 成长激励：被对方人格或存在影响，想成为更好的自己、想配得上、想并肩。",
    "剧情结束后输出一份 <affinity_panel mode=\"three_axes\">。仅输出变化，一事影响多轴时各自写 trigger 和 evidence。每轴首次填 score，已有值填 delta，0 分已初始化。可用很小的分值表示轻微变化。场外对话省略关系报告。",
    "以下是四个方向记录示例，替换为本轮真实发生的事实和候选 ID：",
    "<affinity_person><from_id>A</from_id><to_id>B</to_id><FL><delta>2</delta><trigger>守约</trigger><evidence>她按约带来了答应借我的书</evidence></FL></affinity_person>",
    "<affinity_person><from_id>A</from_id><to_id>B</to_id><RI><score>3</score><trigger>初次心动</trigger><evidence>听她轻声念书名时，我第一次想以恋人的身份靠近她</evidence></RI></affinity_person>",
    "<affinity_person><from_id>A</from_id><to_id>B</to_id><DI><delta>6</delta><phase>active</phase><strength>mild</strength><trigger>好奇</trigger><evidence>我反复琢磨他为什么认识这本书，漏听了报站</evidence></DI></affinity_person>",
    "<affinity_person><from_id>A</from_id><to_id>B</to_id><RI><delta>2</delta><trigger>近距离说话</trigger><evidence>我想以后还和她这样亲近</evidence></RI><DI><delta>4</delta><phase>active</phase><strength>mild</strength><trigger>突然靠近</trigger><evidence>我一时慌乱，把原本要问的话忘了</evidence></DI></affinity_person>",
    "关系认同 relation_identity、第一视角认知 relation_cognition、稳定关系质地 relation_note、本轮事实 relation_fragment 可独立更新。用 relation_trigger 和 relation_evidence 给方向事实作证；轴的事实也可作为关系质地和片段的依据。自我记录用 <self_record><character_id>人物ID</character_id><state_note>亲历后的新理解</state_note></self_record>。认同、认知和自我记录为人物私有，其他人物不能知道未表达的内心。",
    "关系与 <turn_cast> 分别报告。自由续写也可在面板外用 <turn_cast> 填写实际交集清楚的候选人物 ID 数组，供程序判定安静楼层的 DI 回落。",
].join('\n');

const panelPattern = /<relationship_panel\b[^>]*>([\s\S]*?)<\/relationship_panel\s*>/gi;

const legacyPanelPattern = /<affinity_panel\b[^>]*>([\s\S]*?)<\/affinity_panel\s*>/gi;
const legacyPersonPattern = /<affinity_person\b[^>]*>([\s\S]*?)<\/affinity_person\s*>/gi;
export const isStoryThreeAxisPanel = (opening: string) => /\bmode\s*=\s*(?:"three_axes"|'three_axes'|three_axes(?=\s|>))/i.test(opening);

const shortText = (value: unknown) => typeof value === 'string' ? value.trim().slice(0, 400) : '';
const integer = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : undefined;
const clamp = (score: number) => Math.max(0, Math.min(100, score));
const pairKey = (fromId: string, toId: string) => JSON.stringify([fromId, toId]);

const encodePanel = (value: unknown) => JSON.stringify(value)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');

const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unxml = (text: string) => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rawFields = (source: string, tag: string) =>
    [...source.matchAll(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'))]
        .map(match => match[1].trim());
const fields = (source: string, tag: string) => rawFields(source, tag).map(unxml);
const field = (source: string, tag: string) => fields(source, tag)[0] || '';
const fieldInt = (source: string, tag: string) => {
    const value = field(source, tag);
    return /^[+-]?\d+$/.test(value) ? integer(Number(value)) : undefined;
};
const tag = (key: string, value: string | number | undefined) =>
    value === undefined || value === '' ? '' : '<' + key + '>' + xml(String(value)) + '</' + key + '>';
const strengthOf = (value: unknown): Strength | undefined =>
    value === 'mild' || value === 'moderate' || value === 'strong' ? value : undefined;

type RelationshipIssue = (reason: string) => void;

function readThreeAxisPanel(body: string, report?: RelationshipIssue): StoryRelationshipPanel {
    const primaryId = field(body, 'primary_id');
    const state_notes: NonNullable<StoryRelationshipPanel['state_notes']> = {};
    for (const record of rawFields(body, 'self_record')) {
        const id = field(record, 'character_id'), note = shortText(field(record, 'state_note'));
        if (id && note) state_notes[id] = { name: field(record, 'character_name') || id, note };
    }
    const people = [...body.matchAll(legacyPersonPattern)];
    const relationships = people.flatMap(([, person]): Relationship[] => {
        const fromId = field(person, 'from_id');
        const toId = field(person, 'to_id');
        if (!fromId || !toId || fromId === toId) {
            report?.('方向缺少角色 ID 或起点和终点相同');
            return [];
        }
        const axes: Relationship['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const source = rawFields(person, axis)[0] || '';
            const score = fieldInt(source, 'score');
            const delta = fieldInt(source, 'delta');
            const phase = field(source, 'phase');
            if (score === undefined && delta === undefined && !(axis === 'DI' && (phase === 'active' || phase === 'ended'))) {
                if (source) report?.(axis + ' 缺少有效的 score 或 delta');
                continue;
            }
            axes[axis] = {
                score: clamp(score ?? 0), delta,
                hasScore: score !== undefined,
                trigger: shortText(field(source, 'trigger')), evidence: shortText(field(source, 'evidence')),
                strength: strengthOf(field(source, 'strength')), phase: phase === 'active' || phase === 'ended' ? phase : undefined,
                initial: field(source, 'initial') === 'true' ? true : field(source, 'initial') === 'false' ? false : undefined,
                eventDelta: fieldInt(source, 'event_delta'),
            };
        }
        return [{
            fromId, toId, fromName: field(person, 'from_name') || fromId, toName: field(person, 'to_name') || toId,
            axes, relation_note: rawFields(person, 'relation_note').length ? shortText(field(person, 'relation_note')) : undefined,
            identity: rawFields(person, 'relation_identity').length ? field(person, 'relation_identity').slice(0, 200) : undefined,
            cognition: rawFields(person, 'relation_cognition').length ? field(person, 'relation_cognition').slice(0, 2000) : undefined,
            trigger: shortText(field(person, 'relation_trigger')), evidence: shortText(field(person, 'relation_evidence')),
            relation_fragments: fields(person, 'relation_fragment').map(shortText).filter(Boolean).slice(0, 3),
        }];
    });
    const primaryNote = body.replace(legacyPersonPattern, '').replace(/<self_record\b[^>]*>[\s\S]*?<\/self_record\s*>/gi, '');
    const hadRelationshipEntries = /<affinity_person\b/i.test(body);
    if (hadRelationshipEntries && !people.length) report?.('人物方向标签未闭合');
    return { primaryId, primaryName: field(body, 'primary_name') || primaryId, state_note: shortText(field(primaryNote, 'state_note')),
        state_notes, historyVersion: field(body, 'history_version') === '2' ? 2 : undefined, relationships,
        hadRelationshipEntries };
}

export function serializeStoryThreeAxisPanel(panel: StoryRelationshipPanel): string {
    return [
        '<affinity_panel mode="three_axes">', tag('primary_id', panel.primaryId), tag('primary_name', panel.primaryName),
        tag('history_version', panel.historyVersion),
        tag('state_note', panel.state_note),
        ...Object.entries(panel.state_notes ?? {}).map(([id, value]) => '<self_record>' + tag('character_id', id)
            + tag('character_name', value.name) + tag('state_note', value.note) + '</self_record>'),
        ...panel.relationships.flatMap(row => [
            '<affinity_person>', tag('from_id', row.fromId), tag('to_id', row.toId), tag('from_name', row.fromName), tag('to_name', row.toName),
            ...STORY_RELATIONSHIP_AXES.flatMap(axis => {
                const value = row.axes[axis];
                if (!value) return [];
                return ['<' + axis + '>' + tag('score', value.score) + tag('delta', value.delta)
                    + tag('trigger', value.trigger) + tag('evidence', value.evidence)
                    + tag('strength', value.strength) + tag('phase', value.phase)
                    + tag('initial', value.initial === undefined ? undefined : String(value.initial))
                    + tag('event_delta', value.eventDelta) + '</' + axis + '>'];
            }),
            tag('relation_note', row.relation_note), ...(row.relation_fragments ?? []).map(value => tag('relation_fragment', value)),
            '</affinity_person>',
        ]),
        '</affinity_panel>',
    ].filter(Boolean).join('\n');
}

function readPanel(body: string): StoryRelationshipPanel | undefined {
    let value;
    try {
        value = JSON.parse(body.trim().replace(/^(?:~~~|\x60{3})(?:json)?\s*|\s*(?:~~~|\x60{3})$/gi, ''));
    } catch {
        return undefined;
    }
    if (!value || !Array.isArray(value.relationships)) return undefined;
    value.primaryId = typeof value.primaryId === 'string' ? value.primaryId : '';
    return value;
}

export function parseStoryRelationshipPanel(body: string, format: 'xml' | 'json' = 'json', report?: RelationshipIssue): StoryRelationshipPanel | undefined {
    if (format === 'xml') return readThreeAxisPanel(body, report);
    const value = readPanel(body);
    if (!value) return undefined;
    return {
        primaryId: value.primaryId,
        primaryName: shortText(value.primaryName),
        state_note: shortText(value.state_note),
        historyVersion: value.historyVersion === 2 ? 2 : undefined,
        hadRelationshipEntries: value.relationships.length > 0,
        state_notes: value.state_notes && typeof value.state_notes === 'object' ? Object.fromEntries(
            Object.entries(value.state_notes).flatMap(([id, item]) => typeof (item as any)?.note === 'string'
                ? [[id, { name: shortText((item as any).name) || id, note: shortText((item as any).note) }]] : []),
        ) : {},
        relationships: value.relationships.flatMap(row => {
            if (typeof row?.fromId !== 'string' || typeof row?.toId !== 'string'
                || !row.fromId || !row.toId || row.fromId === row.toId) {
                report?.('方向缺少角色 ID 或起点和终点相同');
                return [];
            }
            const axes: Relationship['axes'] = {};
            for (const axis of STORY_RELATIONSHIP_AXES) {
                const item = row.axes?.[axis];
                const score = integer(item?.score);
                const delta = integer(item?.delta);
                if (!item) continue;
                if (score === undefined && delta === undefined && !(axis === 'DI' && (item.phase === 'active' || item.phase === 'ended'))) {
                    report?.(axis + ' 缺少有效的 score 或 delta');
                    continue;
                }
                const strength = item.strength;
                axes[axis] = {
                    score: clamp(score ?? 0),
                    hasScore: score !== undefined,
                    delta,
                    trigger: shortText(item.trigger),
                    evidence: shortText(item.evidence),
                    ...(strength === 'mild' || strength === 'moderate' || strength === 'strong' ? { strength } : {}),
                    phase: item.phase === 'active' || item.phase === 'ended' ? item.phase : undefined,
                    initial: typeof item.initial === 'boolean' ? item.initial : undefined,
                    eventDelta: integer(item.eventDelta),
                };
            }
            return [{
                fromId: row.fromId, toId: row.toId,
                fromName: shortText(row.fromName) || row.fromId,
                toName: shortText(row.toName) || row.toId,
                axes, relation_note: typeof row.relation_note === 'string' ? shortText(row.relation_note) : undefined,
                identity: typeof row.identity === 'string' ? row.identity.trim().slice(0, 200) : undefined,
                cognition: typeof row.cognition === 'string' ? row.cognition.trim().slice(0, 2000) : undefined,
                trigger: shortText(row.trigger), evidence: shortText(row.evidence),
                relation_fragments: Array.isArray(row.relation_fragments) ? row.relation_fragments.map(shortText).filter(Boolean).slice(0, 3) : undefined,
            }];
        }),
    };
}

function readLegacyStateNote(content: string, primary: Actor): string {
    for (const [, panel] of content.matchAll(legacyPanelPattern)) {
        for (const [, person] of panel.matchAll(legacyPersonPattern)) {
            const id = /<character_id>([^<]+)<\/character_id>/i.exec(person)?.[1]?.trim();
            if (id === primary.id) return shortText(field(person, 'state_note'));
        }
    }
    return '';
}

export function legacyStoryRelationshipSelfNotes(content: string): NonNullable<StoryRelationshipPanel['state_notes']> {
    const notes: NonNullable<StoryRelationshipPanel['state_notes']> = {};
    for (const [, panel] of content.matchAll(legacyPanelPattern)) for (const [, person] of panel.matchAll(legacyPersonPattern)) {
        const id = field(person, 'character_id'), note = shortText(field(person, 'state_note'));
        if (id && note) notes[id] = { name: field(person, 'character_name') || id, note };
    }
    return notes;
}

export function stripStoryRelationshipPanels(content: string): string {
    return content
        .replace(/<(relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(?:relationship_panel|affinity_panel|u_affinity_updates|u_affinity)\b[^>]*>[\s\S]*?(?=<(?:scene_header|story_text|backstage|worldline|shot_debts|mini_theater|reply_choices)\b|$)/gi, '')
        .trim();
}

/** Reader-facing panels/private self records must not become another actor's memories. */
export function storyTheaterMirrorContent(message: Pick<Message, 'content' | 'role' | 'metadata'>): string {
    return message.role === 'assistant' && message.metadata?.theaterRealRelationshipProtocol === 1
        ? stripStoryRelationshipPanels(message.content) : message.content;
}

const decayDI = (score: number, strength?: Strength) => {
    if (strength === 'strong') return Math.floor(score * 0.8);
    if (strength === 'moderate') return Math.floor(score * 0.7);
    return clamp(score - 5);
};

export function parseStoryRelationshipContent(content: string, report?: RelationshipIssue): StoryRelationshipPanel | undefined {
    const panels = Array.from(content.matchAll(legacyPanelPattern)).filter(match => isStoryThreeAxisPanel(match[0].slice(0, match[0].indexOf('>') + 1)));
    const old = Array.from(content.matchAll(panelPattern));
    const openings = Array.from(content.matchAll(/<(?:affinity_panel|relationship_panel)\b[^>]*>/gi))
        .filter(([tag]) => /^<relationship_panel/i.test(tag) || isStoryThreeAxisPanel(tag));
    if (openings.length > 1) { report?.('本轮输出了多份三轴关系面板'); return; }
    if (openings.length > panels.length + old.length) { report?.('三轴关系面板未闭合'); return; }
    const parsed = panels.length ? parseStoryRelationshipPanel(panels[0][1], 'xml', report)
        : old.length ? parseStoryRelationshipPanel(old[0][1], 'json', report) : undefined;
    if (!parsed) {
        if (old.length) report?.('关系面板 JSON 无效或缺少 relationships 数组');
        else if (/<affinity_panel\b/i.test(content)) report?.('未找到三轴模式的关系面板');
        return;
    }
    if (panels.length && !parsed.hadRelationshipEntries && !parsed.state_note && !Object.keys(parsed.state_notes ?? {}).length
        && panels[0][1].replace(/<(primary_id|primary_name|history_version)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').trim()) {
        report?.('三轴关系面板中缺少有效的人物方向或自我记录');
        return;
    }
    const counts = new Map<string, number>();
    for (const row of parsed.relationships) {
        const key = pairKey(row.fromId, row.toId);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return { ...parsed, relationships: parsed.relationships.filter(row => {
        if (counts.get(pairKey(row.fromId, row.toId)) === 1) return true;
        report?.('面板重复报告了同一人物方向');
        return false;
    }) };
}

/** Replay central originals in commit order. Callers select the world and reroll boundary first. */
export function getStoryRelationshipBaseline(messages: readonly Message[], actors: readonly Actor[]): StoryRelationshipPanel {
    const relationships = actors.flatMap(from => actors.filter(to => to.id !== from.id).map(to => ({
        fromId: from.id, toId: to.id, fromName: from.name, toName: to.name, axes: {},
    } as Relationship)));
    const byPair = new Map(relationships.map(row => [pairKey(row.fromId, row.toId), row]));
    const state_notes: NonNullable<StoryRelationshipPanel['state_notes']> = {};
    for (const message of [...messages].sort((a, b) => a.id - b.id)) {
        if (message.role !== 'assistant' || message.metadata?.theaterOutOfStory) continue;
        const saved = readStoryRelationshipPayload(message.metadata?.theaterStoryRelationshipEvent)
            ?? readStoryRelationshipPayload(message.metadata?.theaterRealRelationshipEvent);
        if (saved) {
            for (const [id, note] of Object.entries(saved.stateNotes)) if (actors.some(actor => actor.id === id)) state_notes[id] = note;
            for (const update of saved.updates) {
                const { fromId, toId } = update.direction;
                const key = pairKey(fromId, toId);
                const row = byPair.get(key);
                if (row) byPair.set(key, applyStoryRelationshipUpdate(update, row).next);
            }
            continue;
        }
        const panel = parseStoryRelationshipContent(message.content);
        const cast = Array.isArray(message.metadata?.theaterCastIds) ? new Set<string>(message.metadata.theaterCastIds) : undefined;
        const allowed = (id: string) => actors.some(actor => actor.id === id) && (!cast || cast.has(id));
        if (panel) {
            const notes = { ...panel.state_notes };
            if (panel.primaryId && panel.state_note) notes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
            for (const [id, value] of Object.entries(notes)) if (allowed(id)) {
                state_notes[id] = { name: actors.find(actor => actor.id === id)!.name, note: value.note };
            }
            for (const previous of panel.relationships) {
                const row = byPair.get(pairKey(previous.fromId, previous.toId));
                if (!row || !allowed(row.fromId) || !allowed(row.toId)) continue;
                if (previous.relation_note) row.relation_note = previous.relation_note;
                if (previous.identity !== undefined) row.identity = previous.identity;
                if (previous.cognition !== undefined) row.cognition = previous.cognition;
                for (const axis of STORY_RELATIONSHIP_AXES) {
                    const item = previous.axes[axis];
                    if (!item) continue;
                    const prior = row.axes[axis];
                    // Legacy panels are snapshots, never guessed deltas or five-axis conversions.
                    const next = replayStoryRelationshipAxis(axis, prior, item, panel.historyVersion);
                    if (next) row.axes[axis] = { score: next.score, strength: next.strength };
                    // If its initial assessment was deleted, a later delta cannot invent a new baseline.
                }
            }
        } else {
            for (const actor of actors) {
                const note = readLegacyStateNote(message.content, actor);
                if (note && allowed(actor.id)) state_notes[actor.id] = { name: actor.name, note };
            }
        }
    }
    return { primaryId: '', primaryName: '', actors: actors.map(({ id, name }) => ({ id, name })), state_notes,
        relationships: [...byPair.values()] };
}

export function restrictStoryRelationshipsToCast(baseline: StoryRelationshipPanel | undefined, actors: ReadonlySet<string>): StoryRelationshipPanel | undefined {
    if (!baseline) return undefined;
    return { ...baseline, state_notes: Object.fromEntries(Object.entries(baseline.state_notes ?? {}).filter(([id]) => actors.has(id))),
        actors: baseline.actors?.filter(actor => actors.has(actor.id)),
        relationships: baseline.relationships.filter(row => actors.has(row.fromId) && actors.has(row.toId)) };
}

export function buildStoryRelationshipGuide(baseline?: StoryRelationshipPanel, scope = ''): string {
    if (!baseline) return '';
    const { actors, state_notes, relationships } = baseline;
    return '关系历史归属：' + scope + '\n方向基线：' + encodePanel({ actors, state_notes,
        relationships: relationships.filter(row => Object.keys(row.axes).length || row.identity !== undefined
            || row.cognition !== undefined || row.relation_note).map(row => ({
            fromId: row.fromId, toId: row.toId, fromName: row.fromName, toName: row.toName,
            identity: row.identity, cognition: row.cognition, relation_note: row.relation_note,
            axes: Object.fromEntries(Object.entries(row.axes).map(([axis, value]) => [axis, axis === 'DI'
                ? { score: value.score, strength: value.strength, phase: value.phase } : { score: value.score }])),
        })) });
}

export function calculateStoryRelationshipAxis(axis: Axis, previous: AxisValue | undefined, proposed?: AxisValue): AxisValue | undefined {
    const score = integer(proposed?.score);
    const prior = previous?.score ?? 0;
    const trigger = shortText(proposed?.trigger);
    const evidence = shortText(proposed?.evidence);
    const supported = Boolean(trigger && evidence);
    if (!previous && (score === undefined || !supported || proposed?.hasScore === false)) return undefined;
    const change = previous ? integer(proposed?.delta) ?? 0 : score ?? 0;
    if (axis === 'DI') {
        if (proposed) {
            if (!supported) return undefined;
            const phase = proposed.phase ?? 'active';
            const strength = proposed.strength ?? previous?.strength ?? 'mild';
            const peak = clamp(prior + change);
            const next = phase === 'active' ? peak : decayDI(peak, strength);
            return { score: next, delta: next - prior, trigger, evidence, strength, phase };
        }
        const next = decayDI(prior, previous?.strength);
        return {
            score: next, delta: next - prior, strength: previous?.strength,
            ...(next !== prior ? { trigger: '无持续扰动', evidence: '扰动回落' } : {}),
        };
    }
    const next = clamp(prior + (supported ? change : 0));
    return { score: next, delta: next - prior, ...(supported ? { trigger, evidence } : {}) };
}

/** Existing v1 absolute snapshots and v2 canonical events share one replay rule. */
export function replayStoryRelationshipAxis(axis: Axis, previous: AxisValue | undefined, item: AxisValue, historyVersion?: 2): AxisValue | undefined {
    if (historyVersion !== 2 || item.initial === true) return { score: item.score, strength: item.strength };
    if (!previous) return undefined;
    // Old canonical DI without a phase represented a passive decay, including older invalid reports.
    return axis === 'DI' ? calculateStoryRelationshipAxis(axis, previous,
        item.phase && item.strength && item.trigger && item.evidence ? { ...item, delta: item.eventDelta } : undefined)
        : { score: clamp(previous.score + (item.trigger && item.evidence ? item.eventDelta ?? item.delta ?? 0 : 0)), strength: item.strength };
}

/** Validate one already-parsed report and record the participation-based DI decision. */
export function buildStoryRelationshipPayload(panel: StoryRelationshipPanel | undefined, actors: readonly Actor[],
    baseline: StoryRelationshipPanel, report: RelationshipIssue, participation?: StoryRelationshipParticipation): StoryRelationshipPayload | undefined {
    const names = new Map(actors.map(actor => [actor.id, actor.name]));
    const resolve = storyCandidateResolver(actors);
    const previous = new Map(baseline.relationships.map(row => [pairKey(row.fromId, row.toId), row]));
    const updates = new Map<string, StoryRelationshipUpdate>();
    const seen = new Set<string>();
    const explicitDI = new Set<string>();
    for (const row of panel?.relationships ?? []) {
        let fromId: string, toId: string;
        try { fromId = resolve(row.fromId); toId = resolve(row.toId); }
        catch { report('关系方向包含未知或无法唯一匹配的角色'); continue; }
        if (fromId === toId) { report('关系方向的起点和终点相同'); continue; }
        const key = pairKey(fromId, toId);
        if (seen.has(key)) { report('面板重复报告了同一人物方向'); return; }
        seen.add(key);
        if (row.axes.DI) explicitDI.add(key);
        const axes: Relationship['axes'] = {};
        for (const axis of STORY_RELATIONSHIP_AXES) {
            const value = row.axes[axis];
            if (!value) continue;
            const label = names.get(fromId) + ' → ' + names.get(toId) + ' ' + axis;
            if (!value.trigger || !value.evidence) { report(label + ' 缺少触发事件或证据'); continue; }
            const prior = previous.get(key)?.axes[axis];
            if (!prior && value.hasScore === false) report(label + ' 尚未初始化，需要首次评分');
            if (prior && value.delta === undefined && axis !== 'DI') report(label + ' 缺少 delta，分数保持原值');
            axes[axis] = value;
        }
        const privateEvidence = Boolean(row.trigger && row.evidence);
        const axisEvidence = Object.keys(axes).length > 0;
        const identity = privateEvidence ? row.identity : undefined;
        const cognition = privateEvidence ? row.cognition : undefined;
        const relation_note = privateEvidence || axisEvidence ? row.relation_note : undefined;
        const relation_fragments = (privateEvidence || axisEvidence) && row.relation_fragments?.length ? row.relation_fragments : undefined;
        if (!privateEvidence && (row.identity !== undefined || row.cognition !== undefined
            || (!axisEvidence && (row.relation_note || row.relation_fragments?.length)))) {
            report('关系文字缺少触发事件或证据');
        }
        if (!axisEvidence && identity === undefined && cognition === undefined && relation_note === undefined && !relation_fragments) continue;
        updates.set(key, { mode: 'proposal', direction: {
            fromId, toId, fromName: names.get(fromId)!, toName: names.get(toId)!, axes, identity, cognition,
            ...(privateEvidence ? { trigger: row.trigger, evidence: row.evidence } : {}),
            relation_note, relation_fragments,
        } });
    }

    const notes = { ...panel?.state_notes };
    if (panel?.primaryId && panel.state_note) notes[panel.primaryId] = { name: panel.primaryName, note: panel.state_note };
    const stateNotes = Object.fromEntries(Object.entries(notes).flatMap(([id, value]) =>
        names.has(id) && value.note ? [[id, { name: names.get(id)!, note: value.note }]] : []));
    if (!updates.size && !Object.keys(stateNotes).length && panel?.hadRelationshipEntries) {
        report('没有可写入的关系方向');
        return;
    }
    if (participation) for (const [key, row] of previous) {
        if (!row.axes.DI || explicitDI.has(key)) continue;
        const { cast, interactions } = participation;
        if (!cast.has(row.fromId) || !cast.has(row.toId)) continue;
        const sameScene = cast.size === 2 || updates.has(key)
            || interactions.some(group => group.includes(row.fromId) && group.includes(row.toId));
        if (!sameScene) continue;
        const update = updates.get(key) ?? { mode: 'proposal', direction: {
            fromId: row.fromId, toId: row.toId, fromName: row.fromName, toName: row.toName, axes: {},
        } };
        updates.set(key, { ...update, decayDI: true });
    }
    if (!panel && !updates.size) return;
    return { version: 1, updates: [...updates.values()], stateNotes };
}

export function readStoryRelationshipPayload(value: unknown): StoryRelationshipPayload | undefined {
    const payload = value as StoryRelationshipPayload | undefined;
    if (payload?.version === 1 && payload.stateNotes && Array.isArray(payload.updates) && payload.updates.every(update =>
        update?.direction?.fromId && update.direction.toId && update.direction.axes
        && ['proposal', 'snapshot', 'canonical'].includes(update.mode))) return payload;
}

/** Shared direction reducer for the two world scopes, ledger replay and the reader's panel. */
export function applyStoryRelationshipUpdate(update: StoryRelationshipUpdate, previous?: Relationship, render = false) {
    const row = update.direction;
    const next: Relationship = { ...previous, fromId: row.fromId, toId: row.toId,
        fromName: row.fromName, toName: row.toName, axes: { ...previous?.axes } };
    const displayed: Relationship['axes'] = {};
    for (const axis of STORY_RELATIONSHIP_AXES) {
        const value = row.axes[axis], prior = next.axes[axis];
        if (update.clearAxes?.includes(axis)) { delete next.axes[axis]; continue; }
        let after: AxisValue | undefined;
        if (value) {
            if (update.mode === 'canonical') after = replayStoryRelationshipAxis(axis, prior, value, 2);
            else if (update.mode === 'proposal') after = calculateStoryRelationshipAxis(axis, prior, value);
            else if (value.hasScore !== false) after = { ...value };
            else if (prior && value.trigger && value.evidence) after = calculateStoryRelationshipAxis(axis, prior, value);
        } else if (axis === 'DI' && update.decayDI && prior) {
            after = calculateStoryRelationshipAxis(axis, prior);
        }
        if (!after) continue;
        next.axes[axis] = after;
        if (render && (value || after.score !== prior?.score)) displayed[axis] = { ...after, initial: !prior,
            eventDelta: prior ? value?.eventDelta ?? value?.delta ?? 0 : value?.score };
    }
    for (const field of ['identity', 'cognition', 'trigger', 'evidence', 'relation_note', 'relation_fragments'] as const) {
        if (row[field] !== undefined) Object.assign(next, { [field]: row[field] });
    }
    return { next, display: render && (Object.keys(displayed).length || row.relation_note || row.relation_fragments?.length)
        ? { ...row, axes: displayed } : undefined };
}

export function appendStoryRelationshipPanel(prose: string, relationships: Relationship[], state_notes: StoryRelationshipPayload['stateNotes']): string {
    if (!relationships.length && !Object.keys(state_notes).length) return prose;
    return prose + '\n\n' + serializeStoryThreeAxisPanel({ primaryId: '', primaryName: '', historyVersion: 2, relationships, state_notes });
}

/** Legacy string callers use the same parser and reducer. The session passes its validated event. */
export function reconcileStoryRelationships(content: string, baseline?: StoryRelationshipPanel,
    prepared?: { payload: StoryRelationshipPayload | undefined }): string {
    const prose = prepared ? content : stripStoryRelationshipPanels(content);
    if (!baseline) return prose;
    const payload = prepared ? prepared.payload : buildStoryRelationshipPayload(parseStoryRelationshipContent(content),
        baseline.actors ?? [], baseline, () => {});
    if (!payload) return prose;
    const previous = new Map(baseline.relationships.map(row => [pairKey(row.fromId, row.toId), row]));
    const relationships = payload.updates.flatMap(update => {
        const { fromId, toId } = update.direction;
        const { display } = applyStoryRelationshipUpdate(update, previous.get(pairKey(fromId, toId)), true);
        return display ? [display] : [];
    });
    return appendStoryRelationshipPanel(prose, relationships, payload.stateNotes);
}

export function formatStoryRelationshipPanel(panel: StoryRelationshipPanel): string {
    return [
        panel.state_note ? panel.primaryName + ' · 自我记录：' + panel.state_note : '',
        ...Object.values(panel.state_notes ?? {}).map(value => value.name + ' · 自我记录：' + value.note),
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
            ...(row.relation_fragments ?? []),
        ].filter(Boolean).join('\n')),
    ].filter(Boolean).join('\n\n');
}

export function getPreviousStoryRelationshipDocument(document: StoryTheaterPresetDocument): StoryTheaterPresetDocument {
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
                        .replace(/^6\. 关系侧表：.*(?:五根推子|五维).*$/gm, '6. 关系侧表：启用双向关系时，按三轴关系规则检查本轮关系报告。')
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
                        '本轮要求输出关系面板时，<affinity_panel mode="three_axes"> 必须完整且只出现一次；');
                }
                if (['nmj-v3-scene-header', 'nmj-v3-exit-check'].includes(prompt.id)) {
                    content = content.replace(/多角色双向关系温度|双向好感|双向温度/g, '双向关系三轴');
                }
                return { ...prompt, name, content };
            }),
    };
}
