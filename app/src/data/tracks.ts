export type Track = {
  id: string;
  title: string;
  category: 'Sleep' | 'Focus';
  description: string;
  color: string;
  source: number;
  premium: boolean;
};

export const TRACKS: Track[] = [
  {
    id: 'sleep_deep_drone',
    title: 'Deep Sleep Drone',
    category: 'Sleep',
    description: 'Low, slow-moving ambient pad with a brown-noise bed for deep sleep.',
    color: '#1a2a6c',
    source: require('../../assets/audio/sleep_deep_drone.m4a'),
    premium: false,
  },
  {
    id: 'sleep_rain_focus',
    title: 'Rain & Soft Pad',
    category: 'Sleep',
    description: 'Filtered rain texture layered with a gentle ambient pad.',
    color: '#203a43',
    source: require('../../assets/audio/sleep_rain_focus.m4a'),
    premium: false,
  },
  {
    id: 'study_lofi_chill',
    title: 'Lo-Fi Chill Beats',
    category: 'Focus',
    description: 'Warm lo-fi chords with vinyl texture and a laid-back pulse.',
    color: '#6f4e37',
    source: require('../../assets/audio/study_lofi_chill.m4a'),
    premium: true,
  },
  {
    id: 'study_focus_binaural',
    title: 'Alpha Focus Binaural',
    category: 'Focus',
    description: '10Hz alpha-range binaural beat under a soft pad for study focus.',
    color: '#3a1b5a',
    source: require('../../assets/audio/study_focus_binaural.m4a'),
    premium: true,
  },
];
