export interface GalleryItem {
  id: string;
  theme: string;
  bytes: number;
  width: number | null;
  height: number | null;
  createdAt: number;
  url: string;
}

export interface GalleryPage {
  items: GalleryItem[];
  nextCursor: string | null;
}

/** 首页信息流的一组：一个主题 + 该主题最新的一页图片 */
export interface FeedSection {
  theme: string;
  name: string;
  count: number;
  items: GalleryItem[];
  nextCursor: string | null;
}

export interface UploadSession {
  id: string;
  key: string;
  theme: string;
  uploadUrl: string;
}

export interface ApiError {
  error: string;
}
