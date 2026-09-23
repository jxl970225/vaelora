import { THEMES } from '../../shared/themes';

interface ThemePickerProps {
  onPick: (themeIndex: number) => void;
  onClose: () => void;
}

/**
 * 在首页上传的是「一级图片」——某个主题的封面，所以要先选是哪个主题。
 * 在二级页上传则自动归入当前主题，不弹这个框。
 */
export function ThemePicker({ onPick, onClose }: ThemePickerProps) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="选择主题">
      <div className="modal__panel">
        <h2 className="modal__title">上传哪个主题的封面？</h2>

        <ul className="picker">
          {THEMES.map((theme, i) => (
            <li key={theme.id}>
              <button type="button" className="picker__item" onClick={() => onPick(i + 1)}>
                {theme.name}
              </button>
            </li>
          ))}
        </ul>

        <div className="modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}
