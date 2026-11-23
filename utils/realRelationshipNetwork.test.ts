// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { DB } from './db';
import RealRelationshipNetwork from '../components/date/story/RealRelationshipNetwork';
import { realRelationshipKey } from './realRelationshipModel';

const mocks = vi.hoisted(() => ({ state: {} as Record<string, unknown>, flow: {} as any, toast: vi.fn() }));
vi.mock('../context/OSContext', () => ({ useOS: () => mocks.state }));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
vi.mock('@xyflow/react', async importOriginal => {
    const actual = await importOriginal<typeof import('@xyflow/react')>();
    const { createElement } = await import('react');
    return { ...actual, Background: () => null, Controls: () => null, ReactFlow: (props: any) => {
        mocks.flow = props;
        return createElement('div', { 'data-testid': 'graph-library' }, props.edges.map((edge: any) =>
            createElement('button', { key: edge.id, 'data-edge': edge.id, onClick: () => props.onEdgeClick({}, edge) }, edge.label)));
    } };
});

it('画布连接独立布局、双向详情、0/未初始化和手动编辑；并发编辑保留草稿并拒绝覆盖', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const fetch = vi.fn(() => { throw new Error('关系画布不应发起模型请求'); });
    vi.stubGlobal('fetch', fetch);
    const actors = [{ id: 'canvas-a', name: '狛治', avatar: '' }, { id: 'canvas-b', name: '香奈乎', avatar: '' }] as CharacterProfile[];
    for (const actor of actors) await DB.saveCharacter(actor);
    const [a, b] = actors;
    let graph = await DB.getRealRelationshipGraph();
    graph = await DB.editRealRelationship({ fromId: a.id, toId: b.id, identity: '朋友', cognition: '我知道她记得约定', axes: { FL: 5 }, reason: '初始事实' }, graph.revision);
    await DB.editRealRelationship({ fromId: b.id, toId: a.id, identity: '刚认识的人', cognition: '我还需要了解他', axes: { FL: 75, RI: 0 }, reason: '另一人的认识' }, graph.revision);
    Object.assign(mocks.state, { characters: actors, addToast: mocks.toast });
    const container = document.createElement('div'); document.body.append(container);
    let root = createRoot(container);
    const back = vi.fn();
    const render = () => act(async () => root.render(createElement(RealRelationshipNetwork, { onBack: back })));
    const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    const findButton = (text: string) => Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(button => button.textContent === text)!;
    const click = async (button: HTMLButtonElement) => { await act(async () => button.click()); await flush(); };
    const edit = (label: string, value: string) => act(async () => {
        const input = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
        const prototype = input.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const input = (label: string) => container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
    try {
        await render();
        await vi.waitFor(async () => { await flush(); expect(mocks.flow.edges).toHaveLength(2); });
        expect(mocks.flow.zoomOnPinch).toBe(true);
        expect(mocks.flow.panOnDrag).toBe(true);
        expect(mocks.flow.nodesConnectable).toBe(false);
        expect(mocks.flow.edges.every((edge: any) => edge.markerEnd?.type)).toBe(true);
        const revision = (await DB.getRealRelationshipGraph()).revision;
        await act(async () => {
            mocks.flow.onNodeDragStop({}, { id: a.id, position: { x: 43, y: 87 } });
            mocks.flow.onMoveEnd({}, { x: 21, y: 32, zoom: 0.7 });
        });
        await vi.waitFor(async () => expect(await DB.getRealRelationshipLayout()).toMatchObject({ positions: { [a.id]: { x: 43, y: 87 } }, viewport: { x: 21, y: 32, zoom: 0.7 } }));
        expect((await DB.getRealRelationshipGraph()).revision).toBe(revision);
        await click(container.querySelector<HTMLButtonElement>(`button[data-edge='${realRelationshipKey(a.id, b.id)}']`)!);
        expect(container.querySelector('dialog')?.open).toBe(true);
        expect(input('关系认同').value).toBe('朋友');
        expect(input('FL 当前数值').value).toBe('5');
        expect(input('RI 当前数值').value).toBe('');
        const reverse = Array.from(container.querySelectorAll<HTMLButtonElement>('dialog button')).find(button => button.textContent?.startsWith('香奈乎 → 狛治'))!;
        await click(reverse);
        expect(input('FL 当前数值').value).toBe('75');
        expect(input('RI 当前数值').value).toBe('0');
        await edit('FL 当前数值', '0'); await edit('关系认同', '伙伴'); await edit('手动修正依据', '核对角色经历');
        await click(findButton('保存这个方向'));
        await vi.waitFor(async () => expect((await DB.getRealRelationshipGraph()).directions[realRelationshipKey(b.id, a.id)].axes.FL?.score).toBe(0));
        expect((await DB.getRealRelationshipGraph()).directions[realRelationshipKey(a.id, b.id)].axes.FL?.score).toBe(5);
        expect((await DB.getRealRelationshipGraph()).events.at(-1)?.updates[0].direction.axes.RI).toBeUndefined();
        expect(container.textContent).toContain('核对角色经历');
        await edit('FL 当前数值', '');
        await click(findButton('保存这个方向'));
        expect((await DB.getRealRelationshipGraph()).directions[realRelationshipKey(b.id, a.id)].axes.FL).toBeUndefined();
        graph = await DB.getRealRelationshipGraph();
        await act(async () => { await DB.editRealRelationship({ fromId: b.id, toId: a.id, identity: '新的认识', cognition: '新事实', axes: { FL: 45 }, reason: '另一窗口' }, graph.revision); });
        await flush();
        await click(findButton('保存这个方向'));
        expect(container.querySelector('[role="alert"]')?.textContent).toContain('别处更新');
        expect(input('FL 当前数值').value).toBe('');
        expect((await DB.getRealRelationshipGraph()).directions[realRelationshipKey(b.id, a.id)].axes.FL?.score).toBe(45);
        await click(findButton('读取最新关系'));
        expect(input('FL 当前数值').value).toBe('45');
        await click(container.querySelector<HTMLButtonElement>('[aria-label="关闭关系详情"]')!);
        await act(async () => root.unmount());
        root = createRoot(container); await render();
        await vi.waitFor(async () => { await flush(); expect(mocks.flow.defaultViewport?.zoom).toBe(0.7); });
        expect(mocks.flow.nodes.find((node: any) => node.id === a.id).position).toEqual({ x: 43, y: 87 });
        await click(container.querySelector<HTMLButtonElement>('[aria-label="返回剧情"]')!);
        expect(back).toHaveBeenCalledTimes(1);
        expect(fetch).not.toHaveBeenCalled();
    } finally {
        await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
    }
});
