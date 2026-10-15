/** 一级：首页的一个固定位置。coverUrl 为 null 表示该位置暂无封面。 */
export interface ThemeSummary {
  index: number;
  coverUrl: string | null;
  /** 该位置目录下有没有二级图片 */
  hasImages: boolean;
}

/** 二级：主题目录下的一张图片 */
export interface ThemeImage {
  seq: number;
  key: string;
  url: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface ThemeImages {
  index: number;
  /** 该位置的描述文字，上传封面时填写，展示在二级页底部 */
  description: string | null;
  items: ThemeImage[];
}

export interface ApiError {
  error: string;
}
