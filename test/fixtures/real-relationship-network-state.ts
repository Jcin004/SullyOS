import type { CharacterProfile } from '../../types';
export const relationshipFixtureState = {
    characters: [
        { id: 'mobile-ko', name: '狛治', avatar: '', systemPrompt: '独立人物' },
        { id: 'mobile-ka', name: '香奈乎', avatar: '', systemPrompt: '独立人物' },
        { id: 'mobile-ren', name: '炼狱', avatar: '', systemPrompt: '独立人物' },
    ] as CharacterProfile[],
    theme: {},
    toasts: [] as string[],
    addToast(message: string) { relationshipFixtureState.toasts.push(message); },
};
export const useOS = () => relationshipFixtureState;
