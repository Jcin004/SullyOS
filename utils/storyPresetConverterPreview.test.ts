// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import StoryPresetConverter from '../components/date/story/StoryPresetConverter';
import { shareOrDownloadFile } from './shareExport';
import { parseStoryTheaterPreset } from './storyTheater';

vi.mock('./shareExport', () => ({ shareOrDownloadFile: vi.fn(async () => 'downloaded') }));

it('在转换预览选择顺序、预览纯文本、导出原生文件与报告后再入库', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onImport = vi.fn(async () => {});
    const text = '<script>globalThis.testPreview = true</script>';
    const file = {
        name: '测试酒馆.json', size: 500,
        text: async () => JSON.stringify({
            prompts: [{ identifier: 'a', name: '第一条', content: text }, { identifier: 'b', name: '第二条', content: '继承文学规则' }],
            prompt_order: [
                { character_id: 100001, order: [{ identifier: 'a', enabled: true }] },
                { character_id: 42, order: [{ identifier: 'b', enabled: true }] },
            ],
        }),
    };
    const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
    try {
        await act(async () => root.render(createElement(StoryPresetConverter, { onBack: vi.fn(), onImport })));
        const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
        Object.defineProperty(input, 'files', { value: [file] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        expect(container.textContent).toContain(text);
        expect(container.querySelector('script')).toBeNull();
        expect(onImport).not.toHaveBeenCalled();
        const select = container.querySelector('select')!;
        select.value = '1';
        await act(async () => select.dispatchEvent(new Event('change', { bubbles: true })));
        expect(container.textContent).toContain('继承文学规则');
        await act(async () => button('导出剧情预设 JSON').click());
        await act(async () => button('导出兼容报告').click());
        const [native, report] = vi.mocked(shareOrDownloadFile).mock.calls.map(([options]) => options);
        expect(parseStoryTheaterPreset(native.content, native.fileName).document.prompts[0].content).toBe('继承文学规则');
        expect(JSON.parse(report.content).order).toBe('42');
        await act(async () => button('存入剧情预设库').click());
        expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ name: '测试酒馆' }));
    } finally {
        await act(async () => root.unmount());
        container.remove();
        vi.unstubAllGlobals();
    }
});
