const { assetUrl, formatDate, request } = require('../../services/api');

Page({
  data: {
    loading: true,
    error: '',
    device: null
  },

  onLoad(options) {
    this.deviceId = options.id || '';
    this.loadDetail();
  },

  onShow() {
    if (this.deviceId && this.data.device) this.loadDetail();
  },

  async loadDetail() {
    if (!this.deviceId) {
      this.setData({ loading: false, error: '设备编号缺失' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const response = await request('GET', `/api/devices/${encodeURIComponent(this.deviceId)}/status`);
      const device = response.data || {};
      const displayHeight = Number(device.imageDisplayHeight);
      const displayPosition = Number.isInteger(Number(device.imageDisplayPositionY))
        ? Number(device.imageDisplayPositionY)
        : 50;
      const fixedHeight = Number.isInteger(displayHeight) && displayHeight >= 120 && displayHeight <= 720;
      this.setData({
        device: {
          ...device,
          imageSrc: assetUrl(device.image),
          imageLoaded: false,
          displayHeight: fixedHeight ? displayHeight : 0,
          mediaClass: fixedHeight ? 'detail-media detail-media--fixed' : 'detail-media',
          imageClass: fixedHeight ? 'detail-image detail-image--fixed' : 'detail-image',
          mediaStyle: fixedHeight ? `height: ${displayHeight}px;` : '',
          imageStyle: `object-position: 50% ${displayPosition}%;`,
          statusText: device.operationalStatus === 'offline'
            ? '已下线'
            : device.status === 'borrowed' ? '已借出' : '可借用',
          statusClass: device.operationalStatus === 'offline'
            ? 'status status--offline'
            : device.status === 'borrowed' ? 'status status--borrowed' : 'status status--available',
          borrowedAtText: device.currentBorrower ? formatDate(device.currentBorrower.borrowedAt) : '',
          borrowerText: device.currentBorrower
            ? `借用人：${device.currentBorrower.name || '暂不可用'}${device.currentBorrower.major ? `\n专业：${device.currentBorrower.major}` : ''}${device.currentBorrower.borrowedAt ? `\n借用时间：${formatDate(device.currentBorrower.borrowedAt)}` : ''}`
            : '当前借用信息暂不可用'
        }
      });
    } catch (error) {
      this.setData({ error: error.message || '设备详情加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onImageLoad() {
    this.setData({ 'device.imageLoaded': true });
  },

  goBack() {
    wx.navigateBack();
  },

  startBorrow() {
    if (!this.data.device || this.data.device.status !== 'available' || this.data.device.operationalStatus === 'offline') return;
    wx.navigateTo({ url: `/pages/borrow-form/index?id=${encodeURIComponent(this.deviceId)}` });
  },

  retry() {
    this.loadDetail();
  }
});
