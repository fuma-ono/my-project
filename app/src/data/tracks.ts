export type Category = 'sleep' | 'focus';

export type Track = {
  id: string;
  title: string;
  englishTitle: string;
  category: Category;
  description: string;
  duration: string;
  gradient: [string, string];
  source: number;
  premium: boolean;
};

export const CATEGORY_LABEL: Record<Category, string> = {
  sleep: '睡眠',
  focus: '集中',
};

export const CATEGORY_ICON: Record<Category, 'moon' | 'flash'> = {
  sleep: 'moon',
  focus: 'flash',
};

export const TRACKS: Track[] = [
  {
    id: 'sleep_deep_drone',
    title: '深海',
    englishTitle: 'Deep Sleep Drone',
    category: 'sleep',
    description: '低く緩やかに続くアンビエントパッドに、温かみのあるブラウンノイズを重ねた1曲。呼吸を合わせるように、ゆっくり深い眠りへ。',
    duration: '60分ループ',
    gradient: ['#1a2a6c', '#0d1638'],
    source: require('../../assets/audio/sleep_deep_drone.m4a'),
    premium: false,
  },
  {
    id: 'sleep_rain_focus',
    title: '夜雨',
    englishTitle: 'Rain & Soft Pad',
    category: 'sleep',
    description: 'こもった質感の雨音に、静かなアンビエントパッドをそっと重ねました。作業中の「ながら聴き」にも。',
    duration: '60分ループ',
    gradient: ['#245c66', '#0f2b30'],
    source: require('../../assets/audio/sleep_rain_focus.m4a'),
    premium: false,
  },
  {
    id: 'study_lofi_chill',
    title: '喫茶',
    englishTitle: 'Lo-Fi Chill Beats',
    category: 'focus',
    description: '温かみのあるローファイコードに、ヴァイナルの質感をまとわせた力の抜けるビート。作業用BGMの定番スタイルで。',
    duration: '60分ループ',
    gradient: ['#8a5a34', '#3d2a17'],
    source: require('../../assets/audio/study_lofi_chill.m4a'),
    premium: true,
  },
  {
    id: 'study_focus_binaural',
    title: '覚醒',
    englishTitle: 'Alpha Focus Binaural',
    category: 'focus',
    description: '10Hzのアルファ波バイノーラルビートを、穏やかなパッドの下に。ヘッドホン推奨、勉強・作業の集中セッション向け。',
    duration: '60分ループ',
    gradient: ['#5a2f8a', '#231143'],
    source: require('../../assets/audio/study_focus_binaural.m4a'),
    premium: true,
  },
];
