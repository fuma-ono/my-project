import EmojiGridPicker from './EmojiGridPicker';
import { useT } from '../i18n';
import { AVATAR_EMOJI_OPTIONS, avatarColor } from '../theme';

type Props = {
  visible: boolean;
  name: string; // 選択肢の背景色を、既存のアバター配色と揃えるために使う
  selected: string | null;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

export default function AvatarPicker({ visible, name, selected, onSelect, onClose }: Props) {
  const t = useT();
  return (
    <EmojiGridPicker
      visible={visible}
      title={t.avatarPicker.title}
      options={AVATAR_EMOJI_OPTIONS}
      selected={selected}
      cellBackground={avatarColor(name)}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
