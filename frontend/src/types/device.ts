// 用户端卡片契约：明确设备字段、展示状态和图片事件，不把父页面处理函数传入组件。
export interface PortalDevice {
  id: string;
  name: string;
  model: string;
  category: string;
  status: 'available' | 'borrowed';
  operationalStatus?: 'online' | 'offline';
  location?: string;
  image?: string | null;
  imageThumb?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  imageDisplayAspectRatio?: number | null;
  imageDisplayPositionY?: number | null;
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
