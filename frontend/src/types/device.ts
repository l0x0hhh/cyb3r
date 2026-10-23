// 用户端数据契约：共享图片展示字段，借用清单只保存设备摘要，不保存借用人信息。
export interface DeviceImageFields {
  image?: string | null;
  imageThumb?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageDisplayHeight?: number | null;
  imageDisplayAspectRatio?: number | null;
  imageDisplayPositionY?: number | null;
}

export interface PortalDevice extends DeviceImageFields {
  id: string;
  name: string;
  model: string;
  category: string;
  status: 'available' | 'borrowed';
  operationalStatus?: 'online' | 'offline';
  location?: string;
}

export interface DeviceCategory {
  id: string;
  name: string;
  icon?: string | null;
}

export interface BorrowCartItem {
  id: string;
  name: string;
  model: string;
}

export interface DeviceCardEntry {
  item: PortalDevice;
  index: number;
}

export interface DeviceCardPresentation {
  categoryClass: string;
  // SVG 只来自页面内置图标表，不接受接口提供的任意 HTML。
  categoryIcon: string;
  imageSource: string;
  hasImage: boolean;
  imageLoaded: boolean;
  aspectRatio: string | number;
  positionY: number;
}

export interface CardImageLoadPayload {
  source: string;
  event: Event;
}
