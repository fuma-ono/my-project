import EmojiGridPicker from './EmojiGridPicker';
import { GROUP_ICON_EMOJI_OPTIONS, colors } from '../theme';

type Props = {
  visible: boolean;
  selected: string | null;
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

// 個人のアバター(AvatarPicker)とは別の絵文字セット・配色を使う。
// 「これは人ではなくグループのアイコン」と一目で区別できるようにするため。
export default function GroupIconPicker({ visible, selected, onSelect, onClose }: Props) {
  return (
    <EmojiGridPicker
      visible={visible}
      title="グループのアイコンを選ぶ"
      options={GROUP_ICON_EMOJI_OPTIONS}
      selected={selected}
      cellBackground={colors.accentSoft}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
