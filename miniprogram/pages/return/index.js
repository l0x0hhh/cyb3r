const { assetUrl, formatDate, request } = require('../../services/api');

Page({
  data: {
    borrowerName: '',
    borrowerPhone: '',
    loading: false,
    returningId: '',
    searched: false,
    records: [],
    returnToken: '',
    error: ''
  },

  onInput(event) {
    this.setData({ [event.currentTarget.dataset.field]: event.detail.value });
  },

  async lookup() {
    const borrowerName = this.data.borrowerName.trim();
    const borrowerPhone = this.data.borrowerPhone.trim();
    if (!borrowerName || !/^1\d{10}$/.test(borrowerPhone)) {
      wx.showToast({ title: '请输入姓名和 11 位手机号', icon: 'none' });
      return;
    }
    this.setData({ loading: true, searched: false, error: '' });
    try {
      const response = await request('POST', '/api/records/return-lookup', { borrowerName, borrowerPhone });
      const records = (response.data?.records || []).map(record => ({
        ...record,
        imageSrc: assetUrl(record.imageThumb || record.image),
        imageLoaded: false,
        borrowedAtText: formatDate(record.borrowedAt),
        returnNotes: ''
      }));
      this.setData({ records, returnToken: response.data?.returnToken || '', searched: true });
    } catch (error) {
      this.setData({ error: error.message || '查询失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onNotesInput(event) {
    const recordId = event.currentTarget.dataset.id;
    const records = this.data.records.map(record => record.recordId === recordId
      ? { ...record, returnNotes: event.detail.value }
      : record);
    this.setData({ records });
  },

  onImageLoad(event) {
    const recordId = event.currentTarget.dataset.id;
    const records = this.data.records.map(record => record.recordId === recordId
      ? { ...record, imageLoaded: true }
      : record);
    this.setData({ records });
  },

  async confirmReturn(event) {
    const record = this.data.records.find(item => item.recordId === event.currentTarget.dataset.id);
    if (!record) return;
    const modal = await new Promise(resolve => wx.showModal({
      title: '确认归还',
      content: `确定归还「${record.deviceName}」吗？`,
      success: resolve
    }));
    if (!modal.confirm) return;
    this.setData({ returningId: record.recordId });
    try {
      await request('POST', '/api/records/return', {
        recordId: record.recordId,
        returnToken: this.data.returnToken,
        notes: record.returnNotes || ''
      });
      const records = this.data.records.filter(item => item.recordId !== record.recordId);
      this.setData({ records, searched: true });
      wx.showToast({ title: '归还成功', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: error.message || '归还失败', icon: 'none' });
    } finally {
      this.setData({ returningId: '' });
    }
  }
});
