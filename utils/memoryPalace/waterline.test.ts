import { describe, expect, it } from 'vitest';
import {
    DEFAULT_MEMORY_PALACE_WATERLINE,
    makeCustomMemoryPalaceWaterline,
    resolveMemoryPalaceWaterline,
} from './waterline';

describe('角色级记忆水位档位', () => {
    it('旧角色没有字段时保持历史默认 200/100', () => {
        expect(resolveMemoryPalaceWaterline(undefined)).toEqual(DEFAULT_MEMORY_PALACE_WATERLINE);
    });

    it.each([
        ['online', 200, 100],
        ['balanced', 100, 50],
        ['offline', 50, 20],
    ] as const)('%s 档解析为 %i/%i', (preset, hotZoneSize, bufferThreshold) => {
        expect(resolveMemoryPalaceWaterline({ preset })).toEqual({
            preset,
            hotZoneSize,
            bufferThreshold,
        });
    });

    it('自定义值会取整并限制在安全范围内', () => {
        expect(resolveMemoryPalaceWaterline({
            preset: 'custom',
            hotZoneSize: 9.8,
            bufferThreshold: 999,
        })).toEqual({
            preset: 'custom',
            hotZoneSize: 9,
            bufferThreshold: 200,
        });
    });

    it.each([
        [88.9, 88],
        [0, 0],
        [-10, 0],
    ])('自定义原文保留量 %s 保存为 %s 条', (value, expected) => {
        expect(makeCustomMemoryPalaceWaterline(value, 33.4)).toEqual({
            preset: 'custom',
            hotZoneSize: expected,
            bufferThreshold: 33,
        });
    });
});
