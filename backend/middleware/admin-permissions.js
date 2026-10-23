// 管理权限工厂：使用注入的账号查询，沿用既有会话、白名单和错误响应。
function createAdminPermissions({ getAdminUserById, normalizeAdminPermissions }) {
  function checkAdmin(req, res, next) {
    if (req.session?.isAdmin && req.session.adminUserId) return next();
    res.status(401).json({ success: false, message: '未登录管理后台' });
  }

  function requireAdminPermission(permission) {
    return (req, res, next) => {
      if (!req.session?.isAdmin || !req.session.adminUserId) {
        return res.status(401).json({ success: false, message: '未登录管理后台' });
      }
      const user = getAdminUserById(req.session.adminUserId);
      if (!user) return res.status(401).json({ success: false, message: '管理员账号不存在或已失效' });
      if (user.role === 'super_admin' || normalizeAdminPermissions(user.permissions).includes(permission)) return next();
      return res.status(403).json({ success: false, message: '当前管理员没有此功能权限' });
    };
  }

  function requireSuperAdmin(req, res, next) {
    if (!req.session?.isAdmin || !req.session.adminUserId) {
      return res.status(401).json({ success: false, message: '未登录管理后台' });
    }
    const user = getAdminUserById(req.session.adminUserId);
    if (user?.role === 'super_admin') return next();
    return res.status(403).json({ success: false, message: '仅超级管理员可以管理管理员账号' });
  }
  return { checkAdmin, requireAdminPermission, requireSuperAdmin };
}

module.exports = { createAdminPermissions };
