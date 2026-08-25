const { assetUrl, request } = require('../../services/api');

Page({
  data: {
    loading: true,
    submitting: false,
    error: '',
    device: null,
    borrowerName: '',
    borrowerId: '',
    borrowerPhone: '',
    major: '',
    purpose: ''
  },

  onLoad(options) {
    this.deviceId = options.id || '';
    this.loadDevice();
  },

  onBack() {
    wx.navigateBack();
  },

  async loadDevice() {
    try {
      const response = await request('GET', `/api/devices/${encodeURIComponent(this.deviceId)}/status`);
      const device = response.data || {};
      this.setData({
        device: {
          ...device,
          imageSrc: assetUrl(device.image),
          canBorrow: device.status === 'available' && device.operationalStatus !== 'offline'
        },
        loading: false
      });
    } catch (error) {
      this.setData({ loading: false, error: error.message || '设备信息加载失败' });
    }
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async submit() {
    const { borrowerName, borrowerPhone, major, purpose } = this.data;
    if (!borrowerName.trim() || !/^1\d{10}$/.test(borrowerPhone.trim()) || !major.trim() || !purpose.trim()) {
      wx.showToast({ title: '请填写所有必填项', icon: 'none' });
      return;
    }
    this.setData({ submitting: true });
    try {
      await request('POST', '/api/records/borrow', {
        deviceId: this.deviceId,
        borrowerName: borrowerName.trim(),
        borrowerId: this.data.borrowerId.trim(),
        borrowerPhone: borrowerPhone.trim(),
        major: major.trim(),
        purpose: purpose.trim()
      });
      wx.showToast({ title: '借用成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 900);
    } catch (error) {
      wx.showToast({ title: error.message || '借用失败', icon: 'none' });
    } finally {
      this.setData({ submitting: false });
    }
  }
});
