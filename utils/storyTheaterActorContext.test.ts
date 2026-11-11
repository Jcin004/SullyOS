import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import {
    compileStoryPreset,
    createBlankStoryPreset,
    estimateStoryTokens,
    formatStoryActorContexts,
    getStoryCharacterContextLimit,
} from './storyTheater';

const actor = (id: number) => ({ id: `actor-${id}`, name: `演员${id}` }) as CharacterProfile;
const record = (char: CharacterProfile, id: number, content: string, metadata?: Message['metadata']): Message =>
    ({ id, charId: char.id, timestamp: id, role: 'assistant', type: 'text', content, metadata });

describe('真实剧情的角色原文', () => {
    it('同一段旧剧情在 21 位角色的原文中只发送一次，并保留本剧情历史和各人独有的原文', () => {
        const paragraph = '<story_text>在老街的钟楼碰面。' + '他们在雨里回到街角。'.repeat(360) + '</story_text>';
        const contexts = Array.from({ length: 21 }, (_, i) => {
            const char = actor(i + 1);
            return { actor: char, core: `角色卡${i + 1}`, recent: [
                record(char, i * 2, paragraph),
                record(char, i * 2 + 1, `单独记录${i + 1}。`, { source: 'chat' }),
            ] };
        });
        const request = (share: boolean) => compileStoryPreset({
            preset: createBlankStoryPreset(),
            userName: '本人',
            characterNames: contexts.map(context => context.actor.name),
            historyMessages: [{ role: 'assistant', content: '本剧情的上一段正文。' }],
            slots: {
                actors: formatStoryActorContexts(contexts, '本人', '本人', share),
                persona: '',
                scenario: '',
                history: '',
                worldBefore: '',
                worldAfter: '',
            },
        }).messages.map(message => message.content).join('\n');
        const before = request(false);
        const after = request(true);
        expect(before.split(paragraph)).toHaveLength(22);
        expect(after.split(paragraph)).toHaveLength(2);
        expect(after).toContain(`时间线：${contexts.map(context => context.actor.name).join('、')}`);
        expect(after.split('本剧情的上一段正文。')).toHaveLength(2);
        for (let i = 1; i <= 21; i++) expect(after).toContain(`单独记录${i}。`);
        expect(before.length - after.length).toBeGreaterThan(paragraph.length * 19);
        expect(estimateStoryTokens(before) - estimateStoryTokens(after)).toBeGreaterThan(60_000);
    });

    it('按来源合并已标记的副本，区分同文不同事件、普通私聊和正文不同的记录', () => {
        const first = actor(1);
        const second = actor(2);
        const mirror = (theaterCentralId: number) => ({ source: 'story_theater_memory', theaterId: 'old-story', theaterCentralId });
        const prefix = '<story_text>' + '夜'.repeat(4000);
        const formatted = formatStoryActorContexts([
            { actor: first, core: '角色A', recent: [
                record(first, 11, '共享经历', mirror(1)),
                record(first, 12, '独立事件的相同句子', mirror(2)),
                record(first, 13, '私聊的相同句子', { source: 'chat' }),
                record(first, 14, prefix + '不同结尾甲</story_text>'),
            ] },
            { actor: second, core: '角色B', recent: [
                record(second, 21, '共享经历', mirror(1)),
                record(second, 22, '独立事件的相同句子', mirror(3)),
                record(second, 23, '私聊的相同句子', { source: 'chat' }),
                record(second, 24, prefix + '不同结尾乙</story_text>'),
            ] },
        ], '本人', '本人', true);
        expect(formatted.split('共享经历')).toHaveLength(2);
        expect(formatted.split('独立事件的相同句子')).toHaveLength(3);
        expect(formatted.split('私聊的相同句子')).toHaveLength(3);
        expect(formatted.split('<story_text>')).toHaveLength(3);
    });

    it('0 份角色原文时仍渲染所有角色的设定，并沿用未设置时的默认额度', () => {
        expect(getStoryCharacterContextLimit(undefined)).toBe(100);
        expect(getStoryCharacterContextLimit(0)).toBe(0);
        expect(getStoryCharacterContextLimit(1000)).toBe(500);
        const contexts = [1, 2, 3].map(id => ({ actor: actor(id), core: `角色卡${id}`, recent: [] }));
        const rendered = formatStoryActorContexts(contexts, '本人', '本人', true);
        expect(rendered).toBe('角色卡1\n\n---\n\n角色卡2\n\n---\n\n角色卡3');
    });
});
