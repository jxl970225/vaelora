/**
 * 首页是 8 个固定「位置」（槽位），不是 8 个预设分类。
 *
 * 位置只有内部编号 1-8（用于存储路径 {n}.jpg、{n}/、{n}.json），
 * 页面上不展示编号，也不展示任何预设名字 —— 内容由图片和描述体现。
 */
export const THEME_COUNT = 8;

/** 位置编号是否合法（1-8） */
export function isValidThemeIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 1 && index <= THEME_COUNT;
}
