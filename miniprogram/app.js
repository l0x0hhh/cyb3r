const config = require('./config');

App({
  globalData: {
    appId: config.appId,
    apiBase: config.apiBase
  }
});
