import type { Message } from '../types';
import type { RealRelationshipGraph } from './realRelationshipModel';
import { storyCandidateResolver } from './storyTheaterCast';
import { getStoryRelationshipBaseline, STORY_RELATIONSHIP_AXES, STORY_RELATIONSHIP_LABELS, type StoryRelationshipActor,
    type StoryRelationshipAxis, type StoryRelationshipDirection } from './storyTheaterRelationships';

const relationshipTopic = /关系|好感|信任|熟(?:悉|络|起来)|亲近|疏远|冷淡|心动|喜欢|在意|扰动|\b(?:FL|RI|DI)\b/i;
const relationshipQuestion = /查|看看|为什么|怎么|为何|何时|什么时候|发生|变化|变得|历史|记录|多少|突然|[吗呢？?]/;
const draftingTopic = /台词|文风|措辞|节奏|怎么写|如何写|改写|写得|口语|叙述/;
const explicitLookup = /查(?:一?下|阅|找|看)?[^。？！\n]{0,12}关系|关系(?:网|历史|记录|账本)/;
const escapePattern = (text: string) => text.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&');

export function resolveStoryRelationshipLookup(
    question: string, candidates: readonly StoryRelationshipActor[], latestCast: readonly string[],
) {
    if (draftingTopic.test(question) && !explicitLookup.test(question)) return undefined;
    const axes = STORY_RELATIONSHIP_AXES.filter(value => new RegExp('\\b' + value + '\\b|' + STORY_RELATIONSHIP_LABELS[value], 'i').test(question));
    if (!(axes.length || relationshipTopic.test(question)) || !relationshipQuestion.test(question)) return undefined;
    const axis = axes.length === 1 ? axes[0] : undefined;

    const resolve = storyCandidateResolver(candidates);
    const names = [...new Set(candidates.flatMap(({ id, name }) => [id, name]).filter(Boolean))]
        .sort((a, b) => b.length - a.length);
    const matches = names.length ? [...question.matchAll(new RegExp(names.map(name => {
        const pattern = escapePattern(name);
        return /^[a-z0-9_-]+$/i.test(name) ? '(?<![a-zA-Z0-9_-])' + pattern + '(?![a-zA-Z0-9_-])' : pattern;
    }).join('|'), 'g'))] : [];
    let ids: string[];
    try { ids = [...new Set(matches.map(match => resolve(match[0])))]; }
    catch { return { actors: [], directed: false, axis }; }

    if (!ids.length && /他们|她们|它们|TA们|两人|两位|这俩|这对|彼此/.test(question)) ids = [...new Set(latestCast)];
    const actors = ids.flatMap(id => candidates.filter(actor => actor.id === id));
    const between = matches.length === 2
        ? question.slice(matches[0].index! + matches[0][0].length, matches[1].index) : '';
    const directed = /→|->/.test(between) || (!/被|互相|彼此/.test(between)
        && /对|信任|喜欢|在意|疏远|冷淡/.test(between));
    return { actors: actors.length === 2 ? actors : [], directed, axis };
}

type AxisChange = { axis: StoryRelationshipAxis; before?: number; after?: number };

export function formatStoryRelationshipLookup(
    lookup: NonNullable<ReturnType<typeof resolveStoryRelationshipLookup>>,
    graph: RealRelationshipGraph | undefined, rows: readonly Message[], theaterTitle: string,
): string {
    const [from, to] = lookup.actors;
    if (!from || !to) return '这次未能唯一确定人物对。讨论时如果需要关系账本，请用户写清两个人物的名字。';

    const recent = new Map<string, string[]>();
    const collect = (row: StoryRelationshipDirection, changes: AxisChange[], source: string) => {
        const direction = row.fromId === from.id && row.toId === to.id ? from.name + ' → ' + to.name
            : !lookup.directed && row.fromId === to.id && row.toId === from.id ? to.name + ' → ' + from.name : '';
        if (!direction) return;
        const details = changes.filter(change => !lookup.axis || change.axis === lookup.axis).map(change => {
            const value = row.axes[change.axis];
            return [change.axis + ' ' + (change.before ?? '未初始化') + ' → ' + (change.after ?? '未初始化'),
                value?.trigger, value?.evidence].filter(Boolean).join(' · ');
        });
        if (!lookup.axis) {
            const text = [row.identity, row.cognition, row.relation_note, ...(row.relation_fragments ?? [])].filter(Boolean).join(' · ');
            if (text) details.push(text);
        }
        if (!details.length) return;
        const records = recent.get(row.fromId) ?? [];
        records.push([direction + ' · ' + source, ...details, row.trigger, row.evidence]
            .filter(Boolean).map(value => value?.slice(0, 220)).join('｜').slice(0, 500));
        recent.set(row.fromId, records.slice(-3));
    };

    if (graph) {
        for (const event of graph.events) {
            const { source } = event;
            const label = source.kind === 'manual' ? '用户手动修正'
                : source.title + (source.messageId === undefined ? '' : ' · 楼层 ' + source.messageId);
            for (const { direction } of event.updates) {
                collect(direction, event.changes?.filter(change => change.fromId === direction.fromId && change.toId === direction.toId) ?? [], label);
            }
        }
    } else {
        getStoryRelationshipBaseline(rows, lookup.actors, (message, update, before, after) => {
            const changes = STORY_RELATIONSHIP_AXES.flatMap(axis => {
                const oldScore = before.axes[axis]?.score;
                const newScore = after.axes[axis]?.score;
                return oldScore === newScore ? [] : [{ axis, before: oldScore, after: newScore }];
            });
            collect(update.direction, changes, theaterTitle + ' · 楼层 ' + message.id);
        });
    }

    const records = [...recent.values()].flatMap(entries => [...entries].reverse());
    return records.join('\n') || '这对人物暂无符合问题的关系变化记录。';
}
