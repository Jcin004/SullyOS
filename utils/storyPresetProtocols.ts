import type { StoryTheaterPresetPrompt } from '../types';
import { BUILTIN_NIGHT_SCREENING_PRESET } from './storyTheater';
import { STORY_RELATIONSHIP_PROMPT, STORY_RELATIONSHIP_PROMPT_ID } from './storyTheaterRelationships';

type Scope = StoryTheaterPresetPrompt['scope'];

const rule = (id: string, name: string, content: string, scope?: Scope): StoryTheaterPresetPrompt => ({
    id, name, content, role: 'system', enabled: true, ...(scope ? { scope } : {}),
});

// These entries contain the existing candidate, name-resolution and interaction contracts.
const nativeCastRule = (id: string): StoryTheaterPresetPrompt => {
    const prompt = BUILTIN_NIGHT_SCREENING_PRESET.document.prompts.find(item => item.id === id);
    if (!prompt) throw new Error('找不到原生出演协议 ' + id);
    return { ...prompt, enabled: true };
};

export const STORY_PRESET_PROTOCOLS = [
    {
        id: 'experience-time', name: '经历时间', defaultEnabled: true,
        description: '使用已有剧情时间，续接角色的经历日期。',
        tags: ['scene_header/time'],
        prompts: [rule('sully-experience-time', '经历时间',
            '按剧场既有时间线和用户本轮明确的时间推进，在 <scene_header><time>结束时的剧情时间</time></scene_header> 记录本轮结束时间。有确切日期时使用 YYYY-MM-DD HH:mm；只有相对推进时写明确的相对时间。已有场景条时把 time 写入同一个 scene_header。', 'story_only')],
    },
    {
        id: 'cast', name: '出演与实际互动', defaultEnabled: true,
        description: '沿用候选角色、交流倾向、实际出演和场外报告协议。',
        tags: ['turn_cast', 'interaction_result', 'out_of_story'],
        prompts: [
            nativeCastRule('nmj-v67-theater-mode'),
            nativeCastRule('nmj-v67-theater-cast'),
            nativeCastRule('nmj-v67-theater-interaction-bias'),
            nativeCastRule('nmj-v67-theater-interaction-record'),
            rule('nmj-v67-theater-output', '剧情／场外输出顺序',
                '剧情模式先完成正篇，之后在独立标签中依次提交本轮启用的出演、实际交流和私轴记录。明确进入场外时，只输出 <out_of_story>场外回复</out_of_story>。\n正篇使用这段起笔（留空则自由起笔）：{{theater_prefill}}',
                'story_theater'),
        ],
    },
    {
        id: 'private-axes', name: '私轴', defaultEnabled: true,
        description: '续接实际出演角色自己的事务、念头和行动。',
        tags: ['private_axes'],
        prompts: [rule('nmj-v67-theater-private-axes', '角色私轴',
            '最近的私轴：\n{{theater_previous_axes}}\n在实际交流记录之后输出 <private_axes>JSON 对象</private_axes>。键为本轮实际出演角色的 ID（见候选资料），值为简短文字，记录角色自己的事务、念头和行动，承接尚未结束的事项。无需更新时输出 {}。',
            'story_theater_story')],
    },
    {
        id: 'relationships', name: '三轴关系 FL / RI / DI', defaultEnabled: true,
        description: '启用现有关系协议，承接当前剧场的三轴历史。',
        tags: ['affinity_panel', 'relationship_panel'],
        prompts: [rule(STORY_RELATIONSHIP_PROMPT_ID, '三轴关系 FL / RI / DI', STORY_RELATIONSHIP_PROMPT)],
    },
    {
        id: 'scene', name: '场景条', defaultEnabled: false,
        description: '显示这一幕的时间、地点和场面。',
        tags: ['scene_header'],
        prompts: [rule('nmj-v3-scene-header', '场景条',
            '正文前输出一个 <scene_header><time>剧情时间</time><place>地点</place><situation>当前场面</situation></scene_header>。如同时启用了经历时间，time 记录本轮结束时的剧情时间。', 'story_only')],
    },
    {
        id: 'backstage', name: '幕后与余波', defaultEnabled: false,
        description: '把幕后事实和未结事项并入原生折叠区。',
        tags: ['backstage', 'mind_weather', 'shot_debts'],
        prompts: [rule('nmj-v48-backstage', '幕后与余波',
            '正篇之后可分开记录人物未公开的反应或事实，以及已发生事件留下的未结事项。使用 <backstage><owner>人物</owner><undertow>幕后反应或事实</undertow></backstage>，接着用 <shot_debts><debt>尚未解决的事项</debt><origin>起因</origin></shot_debts>。没有内容的部分可以留空。', 'story_only')],
    },
    {
        id: 'worldline', name: '世界线', defaultEnabled: false,
        description: '用原生世界线卡片显示已落地的变化。',
        tags: ['worldline', 'world_line'],
        prompts: [rule('nmj-v48-worldline', '世界线',
            '正篇之后可用 <worldline><world_event>已发生的事件</world_event><scope>影响范围</scope><change>已落地的变化</change></worldline> 记录本轮的外部变化。没有变化时省略。', 'story_only')],
    },
    {
        id: 'mini-theater', name: '小剧场', defaultEnabled: false,
        description: '使用原生气泡显示一段独立的幕间对话。',
        tags: ['mini_theater'],
        prompts: [rule('nmj-v3-theater-custom', '幕间小剧场',
            '正篇之后另写一段独立小剧场。使用 <mini_theater><mt_title>标题</mt_title><mt_ai><name>人物名</name><text>消息</text></mt_ai><mt_user><name>人物名</name><text>消息</text></mt_user></mini_theater>。每条消息单独使用一个 mt_ai 或 mt_user，闭合所有标签。', 'story_only')],
    },
] as const;

export type StoryPresetProtocolId = typeof STORY_PRESET_PROTOCOLS[number]['id'];
export const DEFAULT_STORY_PRESET_PROTOCOLS = STORY_PRESET_PROTOCOLS.filter(item => item.defaultEnabled).map(item => item.id);
