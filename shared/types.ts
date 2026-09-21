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

export interface ThemeCover {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
}

export interface ThemeSummary {
  id: string;
  name: string;
  count: number;
  cover: ThemeCover | null;
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
