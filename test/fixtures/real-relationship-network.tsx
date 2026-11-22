import React from 'react';
import { createRoot } from 'react-dom/client';
import RealRelationshipNetwork from '../../components/date/story/RealRelationshipNetwork';
import { relationshipFixtureState } from './real-relationship-network-state';
import { DB } from '../../utils/db';
import { createStoryTheaterDraft, storyTheaterThreadId } from '../../utils/storyTheater';
import { buildStoryRelationshipPayload, parseStoryRelationshipContent, stripStoryRelationshipPanels } from '../../utils/storyTheaterRelationships';

async function start() {
    const actors = relationshipFixtureState.characters;
    for (const actor of actors) await DB.saveCharacter(actor);
    const story = { ...createStoryTheaterDraft(), id: 'mobile-relation-story', title: '归还旧信 · 验证剧情',
        characterIds: actors.map(actor => actor.id), writesToCharacterMemory: true };
    await DB.saveStoryTheater(story);
    const graph = await DB.getRealRelationshipGraph();
    if (!graph.events.length) {
        const response = '<story_text>旧信如约归还。</story_text><relationship_panel>' + JSON.stringify({ relationships: [
            { fromId: actors[0].id, toId: actors[1].id, identity: '可信赖的朋友', cognition: '我知道她会认真守住约定。',
                trigger: '我亲历她归还旧信', evidence: '她记得日期，也记得我的嘱托',
                axes: { FL: { score: 64, trigger: '如约归还旧信', evidence: '我接过信后向她道谢' } } },
            { fromId: actors[1].id, toId: actors[0].id, identity: '愿意继续了解的人', cognition: '我还想了解他的过去。',
                trigger: '他向我道谢', evidence: '我注意到他接信时松了口气',
                axes: { FL: { score: 42, trigger: '他认真收好信', evidence: '我注意到了他的珍惜' }, RI: { score: 0, trigger: '我的认识仍是友谊', evidence: '我没有产生恋爱性注意' } } },
        ] }) + '</relationship_panel>';
        const panel = parseStoryRelationshipContent(response, undefined, 'model');
        await DB.saveMessage({ charId: storyTheaterThreadId(story.id), role: 'assistant', type: 'text', content: stripStoryRelationshipPanels(response),
            metadata: { source: 'story_theater', theaterId: story.id, theaterRelationshipScope: 'real', theaterRealRelationshipProtocol: 1,
                theaterRealRelationshipEvent: buildStoryRelationshipPayload(panel, actors, reason => { throw new Error(reason); }) } });
    }
    const layout = await DB.getRealRelationshipLayout();
    if (!Object.keys(layout.positions).length) await DB.patchRealRelationshipLayout({ positions: {
        [actors[0].id]: { x: 20, y: 30 }, [actors[1].id]: { x: 285, y: 30 }, [actors[2].id]: { x: 150, y: 260 },
    }, viewport: { x: 20, y: 70, zoom: 0.8 } });
    (window as any).__relationshipFixture = { DB, actors, state: relationshipFixtureState, ready: true };
    createRoot(document.getElementById('root')!).render(<RealRelationshipNetwork onBack={() => relationshipFixtureState.addToast('返回剧情')} />);
}
void start().catch(error => { document.body.textContent = 'Fixture failed: ' + error.message; });
