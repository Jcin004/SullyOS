// @vitest-environment jsdom
import { act, createElement, Fragment, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import StoryPresetMaker from '../components/date/story/StoryPresetMaker';
import type { StoryTheaterPreset, StoryTheaterPresetPrompt } from '../types';
import { getStoryPresetPromptGroups, makeStoryPresetGroupBoundaries } from './storyTheater';
import type { StoryPresetClipboard } from './storyPresetClipboard';

const row = (id: string, name: string, enabled = true): StoryTheaterPresetPrompt => ({
    id, name, enabled, role: 'assistant', content: name + '原文',
});
const group = (name: string, ...prompts: StoryTheaterPresetPrompt[]) => {
    const [start, end] = makeStoryPresetGroupBoundaries(name);
    return [start, ...prompts, end];
};
const preset = (name: string, prompts: StoryTheaterPresetPrompt[], builtIn = false): StoryTheaterPreset => ({
    id: name, name, format: 'sullyos-story-preset', builtIn, createdAt: 0, updatedAt: 0,
    document: { schema: 'sullyos.story-preset', version: 1, promptLayout: 'ordered', name, prompts,
        generation: { temperature: 0.9, topP: 1, frequencyPenalty: 0, presencePenalty: 0, maxTokens: 8000 } },
});

it('跨页面直接复制和批量复制，可以取消、追加、移动新分类和撤销', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const source = preset('源预设', [
        ...group('文风', row('a', '第一种'), row('b', '第二种', false), row('nmj-v67-theater-private-axes', '私轴')),
        ...group('人物', row('c', '人物规则')),
    ], true);
    const target = preset('目标预设', group('文风', row('existing', '原有规则')));
    const onSave = vi.fn<(value: StoryTheaterPreset) => void>();
    const App = () => {
        const [active, setActive] = useState<StoryTheaterPreset | null>(null);
        const [clipboard, setClipboard] = useState<StoryPresetClipboard | null>(null);
        return active ? createElement(StoryPresetMaker, {
            key: active.id, preset: active, clipboard, onCopy: setClipboard,
            onBack: () => setActive(null), onOpenCopy: setActive, onSave,
        }) : createElement(Fragment, null,
            createElement('button', { onClick: () => setActive(source) }, '打开源预设'),
            createElement('button', { onClick: () => setActive(target) }, '打开目标预设'),
        );
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('button')];
    const fire = (element: HTMLElement | undefined | null) => {
        expect(element).toBeTruthy();
        return act(async () => { element!.click(); });
    };
    const click = (text: string) => fire(buttons().find(button => button.textContent?.trim() === text));
    const label = (text: string) => fire(host.querySelector<HTMLElement>('[aria-label="' + text + '"]'));
    const openGroup = (name: string) => fire([...host.querySelectorAll('button strong')].find(node => node.textContent === name)?.closest('button'));
    const goBack = () => fire(buttons()[0]);
    const savedPrompts = () => onSave.mock.calls.at(-1)![0].document.prompts;
    try {
        await act(async () => root.render(createElement(App)));
        await click('打开源预设');
        await click('专业版');
        await label('复制整个分类 文风');
        expect(host.querySelector('[role=status]')?.textContent).toBe('已复制 1 个分类、2 条提示词，跳过 1 条受保护提示词');
        await openGroup('文风');
        expect(host.querySelector('[aria-label="复制提示词 私轴"]')).toBeNull();
        await label('复制提示词 第二种');
        expect(host.querySelector('[role=status]')?.textContent).toBe('已复制 1 条提示词');
        await label('多选提示词 第二种');
        await label('多选提示词 第一种');
        await click('复制所选提示词（2）');
        await goBack();

        await click('打开目标预设');
        expect(host.textContent).toContain('剪贴板 · 2 条提示词');
        await click('专业版');
        await openGroup('文风');
        await click('粘贴');
        expect(host.querySelector('[role=dialog] select option:checked')?.textContent).toBe('文风');
        await click('取消粘贴');
        await click('保存');
        expect(savedPrompts()).toEqual(target.document.prompts);
        await click('粘贴');
        await click('追加到所选分类');
        await click('保存');
        expect(savedPrompts().filter(prompt => !prompt.section).map(({ name, enabled, role }) => ({ name, enabled, role })))
            .toEqual([row('existing', '原有规则'), row('a', '第一种'), row('b', '第二种', false)].map(({ name, enabled, role }) => ({ name, enabled, role })));
        await click('撤销本次粘贴');
        await click('保存');
        expect(savedPrompts()).toEqual(target.document.prompts);
        await goBack();

        await click('打开源预设');
        await click('专业版');
        await label('多选分类 人物');
        await label('多选分类 文风');
        await click('复制所选分类（2）');
        expect(host.querySelector('[role=status]')?.textContent).toBe('已复制 2 个分类、3 条提示词，跳过 1 条受保护提示词');
        await goBack();
        await click('打开目标预设');
        await click('粘贴');
        expect(host.querySelector('[role=dialog]')?.textContent).toContain('文风（2 条）');
        await click('粘贴为 2 个新分类');
        await label('上移分类 文风（2）');
        await click('保存');
        expect(getStoryPresetPromptGroups(onSave.mock.calls.at(-1)![0].document).map(item => item.label))
            .toEqual(['文风（2）', '文风', '人物']);
        expect(savedPrompts().some(prompt => prompt.id === 'nmj-v67-theater-private-axes')).toBe(false);
        await click('撤销本次粘贴');
        await click('保存');
        expect(savedPrompts()).toEqual(target.document.prompts);
        expect(source.document.prompts.filter(prompt => !prompt.section).map(prompt => prompt.id))
            .toEqual(['a', 'b', 'nmj-v67-theater-private-axes', 'c']);
    } finally {
        await act(async () => root.unmount());
        host.remove();
        vi.unstubAllGlobals();
    }
});
