import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../types';
import { safeFetchJson } from '../safeApi';
import { extractMemoriesFromBuffer, splitExtractionMessages } from './extraction';
import { extractExternalMemoryText, parseCompleteExternalMemoryReply, splitExternalMemoryText, EXTERNAL_MEMORY_TIMEOUT_MS } from './externalMemory';

vi.mock('../safeApi', () => ({ safeFetchJson: vi.fn() }));
const fetchJson = vi.mocked(safeFetchJson);
const config = { baseUrl: 'https://example.test/v1', apiKey: 'test', model: 'test' };
const message = (content: string, id = 1): Message => ({ id, charId: 'c', type: 'text', role: 'assistant', content, timestamp: 1792692000000, metadata: { source: 'story_theater_memory' } });
const reply = (content: string, finish_reason = 'stop') => ({ choices: [{ message: { content }, finish_reason }] });

beforeEach(() => { fetchJson.mockReset(); localStorage.clear(); });

describe('long scene extraction', () => {
    it('marks both roles of theater mirrors as neutral records while preserving ordinary chat', async () => {
        const input = [
            { ...message('和叶拿着创可贴走进教室。', 10), role: 'user' as const },
            message('炭治郎转身，其他教室里有人上课。', 11),
            { ...message('今天第一节是体育课。', 12), role: 'user' as const, metadata: undefined },
        ];
        fetchJson.mockResolvedValue(reply('[]'));
        await extractMemoriesFromBuffer(input, 'c', '炭治郎', config, undefined, '和叶');
        const request = JSON.parse(String(fetchJson.mock.calls[0][1]?.body));
        const story = request.messages[1].content as string;
        expect(story).toContain('[剧场记录]: 和叶拿着创可贴走进教室。');
        expect(story).toContain('[剧场记录]: 炭治郎转身，其他教室里有人上课。');
        expect(story).toContain('[和叶]: 今天第一节是体育课。');
        expect(story).not.toContain('[炭治郎]: 炭治郎转身');
        expect(request.messages[0].content).toContain('剧场记录识读');
        expect(request.messages[0].content).toContain('其他地点或分组');
    });
    it('keeps ordinary conversation formatting and prompt unchanged without theater mirrors', async () => {
        fetchJson.mockResolvedValue(reply('[]'));
        await extractMemoriesFromBuffer([{ ...message('你好', 1), metadata: undefined }], 'c', '炭治郎', config, undefined, '和叶');
        const request = JSON.parse(String(fetchJson.mock.calls[0][1]?.body));
        expect(request.messages[1].content).toContain('[炭治郎]: 你好');
        expect(request.messages[0].content).not.toContain('剧场记录识读');
    });
    it('sends the entire scene and the subsequent Kanata message, including text beyond 600 characters', async () => {
        const scene = '<scene_header>场景</scene_header><story_text>' + '场景描写。'.repeat(200) + '结尾约定一起去海边。</story_text>';
        fetchJson.mockResolvedValue(reply('[]'));
        await extractMemoriesFromBuffer([message(scene), message('彼方：在娱乐室跳舞。', 2)], 'c', '角色', config);
        const body = JSON.parse(String(fetchJson.mock.calls[0][1]?.body));
        expect(body.messages[1].content).toContain(scene);
        expect(body.messages[1].content).toContain('彼方：在娱乐室跳舞。');
    });
    it('batches by full text size without dropping or clipping a message', async () => {
        const input = [message('甲'.repeat(13000)), message('乙'.repeat(13000), 2), message('结尾', 3)];
        expect(splitExtractionMessages(input, '角色', '用户').flat()).toEqual(input);
        fetchJson.mockResolvedValue(reply('[]'));
        await extractMemoriesFromBuffer(input, 'c', '角色', config);
        expect(fetchJson).toHaveBeenCalledTimes(2);
        const sent = fetchJson.mock.calls.map(call => JSON.parse(String(call[1]?.body)).messages[1].content).join('\n');
        for (const item of input) expect(sent).toContain(item.content);
    });
    it.each([reply('不是 JSON'), reply(''), reply('[{"content":"半份","room":"living_room"}]', 'length')])('fails instead of treating malformed or truncated output as no memories', async data => {
        fetchJson.mockResolvedValue(data);
        await expect(extractMemoriesFromBuffer([message('重要经历')], 'c', '角色', config)).rejects.toThrow();
    });
    it('rejects the whole multi-request extraction if a later batch fails', async () => {
        fetchJson.mockResolvedValueOnce(reply('[{"content":"第一批","room":"living_room"}]')).mockRejectedValueOnce(new Error('network'));
        await expect(extractMemoriesFromBuffer([message('甲'.repeat(13000)), message('乙'.repeat(13000), 2)], 'c', '角色', config)).rejects.toThrow('network');
    });
});

describe('external memory cleaning', () => {
    it('accepts complete fenced JSON, preserving quoted brackets, but rejects truncation', () => {
        expect(parseCompleteExternalMemoryReply('```json\n[{"content":"[保留] 原文"}]\n```')).toEqual([{ content: '[保留] 原文' }]);
        expect(() => parseCompleteExternalMemoryReply('```json\n[{"content":"前半份"}\n```')).toThrow();
    });
    it('splits 16000 characters into small batches without losing text', () => {
        const source = '内容'.repeat(8000);
        const batches = splitExternalMemoryText(source);
        expect(batches.length).toBeGreaterThan(5);
        expect(batches.every(batch => batch.length <= 3000)).toBe(true);
        expect(batches.join('')).toBe(source);
    });
    it('uses the longer timeout and does not retry an uncertain network failure', async () => {
        fetchJson.mockRejectedValue(new Error('timeout'));
        const result = await extractExternalMemoryText('原文内容', 'c', '角色', '用户', config);
        expect(fetchJson).toHaveBeenCalledTimes(1);
        expect(fetchJson.mock.calls[0][3]).toBe(EXTERNAL_MEMORY_TIMEOUT_MS);
        expect(result.batches[0].ok).toBe(false);
    });
    it('retries format failure once and accepts complete fenced output', async () => {
        const item = { date: null, content: '原文内容', room: 'living_room', importance: 5, mood: 'neutral', valence: 0, arousal: 0, tags: [] };
        fetchJson.mockResolvedValueOnce(reply('错误格式')).mockResolvedValueOnce(reply('```json\n' + JSON.stringify([item]) + '\n```'));
        const result = await extractExternalMemoryText('原文内容', 'c', '角色', '用户', config);
        expect(fetchJson).toHaveBeenCalledTimes(2);
        expect(result.memories[0].content).toBe('原文内容');
        expect(result.batches[0].ok).toBe(true);
    });
});
