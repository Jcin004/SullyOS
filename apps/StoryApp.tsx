import React from 'react';
import StoryTheater from '../components/date/story/StoryTheater';
import { useOS } from '../context/OSContext';

export default function StoryApp() {
    const { closeApp } = useOS();
    return <StoryTheater onClose={closeApp} />;
}
