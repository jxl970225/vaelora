/**
 * 八个固定主题。改这里即可，前端栏位顺序、上传选择、服务端校验都读同一份。
 *
 * id 用 ASCII 而不直接用中文名：中文作为数据库值和 URL 参数要处理编码，
 * 而且以后想把「风景」改成「自然风光」时，用 id 就不需要动已有数据。
 */
export const THEMES = [
  { id: 'landscape', name: '风景' },
  { id: 'portrait', name: '人像' },
  { id: 'food', name: '美食' },
  { id: 'architecture', name: '建筑' },
  { id: 'animal', name: '动物' },
  { id: 'street', name: '街拍' },
  { id: 'night', name: '夜景' },
  { id: 'still', name: '静物' },
] as const;

export type ThemeId = (typeof THEMES)[number]['id'];

export const THEME_IDS: readonly string[] = THEMES.map((t) => t.id);

export function themeName(id: string): string {
  return THEMES.find((t) => t.id === id)?.name ?? id;
}

export function isValidTheme(id: string): boolean {
  return THEME_IDS.includes(id);
}
