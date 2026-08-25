const { assetUrl, request } = require('../../services/api');

Page({
  data: {
    brandEmblem: assetUrl('/assets/jnu-cyber-security-emblem.webp'),
    loading: true,
    error: '',
    searchQuery: '',
    activeCategory: '',
    categories: [],
    devices: [],
    filteredDevices: []
  },

  onLoad() {
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    this.setData({ loading: true, error: '' });
    try {
      const [deviceResponse, categoryResponse] = await Promise.all([
        request('GET', '/api/devices/available'),
        request('GET', '/api/categories')
      ]);
      const categoryNames = {};
      (categoryResponse.data || []).forEach(category => { categoryNames[category.id] = category.name; });
      const devices = (deviceResponse.data || []).map(device => {
        const width = Number(device.imageWidth);
        const height = Number(device.imageHeight);
        const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '4 / 3';
        const imageSrc = assetUrl(device.imageThumb || device.image);
        return {
          ...device,
          imageSrc,
          imageLoaded: false,
          categoryName: categoryNames[device.category] || '其他',
          mediaStyle: `aspect-ratio: ${ratio};`
        };
      });
      this.setData({
        devices,
        categories: [{ id: '', name: '全部' }, ...(categoryResponse.data || [])]
      });
      this.applyFilters();
    } catch (error) {
      this.setData({ error: error.message || '设备列表加载失败' });
    } finally {
      this.setData({ loading: false });
    }
  },

  applyFilters() {
    const query = this.data.searchQuery.trim().toLowerCase();
    const filteredDevices = this.data.devices.filter(device => {
      const matchesCategory = !this.data.activeCategory || device.category === this.data.activeCategory;
      const matchesQuery = !query
        || String(device.name || '').toLowerCase().includes(query)
        || String(device.model || '').toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
    this.setData({ filteredDevices });
  },

  onSearchInput(event) {
    this.setData({ searchQuery: event.detail.value }, () => this.applyFilters());
  },

  onCategoryTap(event) {
    this.setData({ activeCategory: event.currentTarget.dataset.id }, () => this.applyFilters());
  },

  onImageLoad(event) {
    const id = event.currentTarget.dataset.id;
    const devices = this.data.devices.map(device => device.id === id ? { ...device, imageLoaded: true } : device);
    const filteredDevices = this.data.filteredDevices.map(device => device.id === id ? { ...device, imageLoaded: true } : device);
    this.setData({ devices, filteredDevices });
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(event.currentTarget.dataset.id)}` });
  },

  retry() {
    this.loadData();
  }
});
