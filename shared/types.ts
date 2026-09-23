/** 一级：首页展示的主题封面。文件名固定为 {主题号}.jpg，没有对应文件就不返回。 */
export interface ThemeSummary {
  index: number;
  name: string;
  coverUrl: string;
  /** 该主题目录下有没有二级图片 */
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
  name: string;
  items: ThemeImage[];
}

export interface ApiError {
  error: string;
}
