// 借还路由装配：复用同一个限流器，完整记录接口仍先执行 records 权限检查。
const express = require('express');

function createRecordRouter({ service, borrowReturnLimiter, requireAdminPermission, onBorrow = () => {} }) {
  const router = express.Router();
  router.post('/borrow', borrowReturnLimiter, (req, res) => {
    const result = service.borrow(req.body);
    if (result.body.success && result.body.data?.id) onBorrow(req, [result.body.data.id]);
    res.status(result.status).json(result.body);
  });

  router.post('/borrow-other', borrowReturnLimiter, (req, res) => {
    const result = service.borrowOther(req.body);
    if (result.body.success && result.body.data?.id) onBorrow(req, [result.body.data.id]);
    res.status(result.status).json(result.body);
  });

  router.post('/borrow-batch', borrowReturnLimiter, (req, res) => {
    const result = service.borrowBatch(req.body);
    if (result.body.success) onBorrow(req, (result.body.data?.borrowed || []).map(item=>item.recordId));
    res.status(result.status).json(result.body);
  });

  router.post('/return-lookup', borrowReturnLimiter, (req, res) => {
    const result = service.lookupReturns(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/return', borrowReturnLimiter, (req, res) => {
    const result = service.returnOne(req.body);
    res.status(result.status).json(result.body);
  });

  router.post('/return-batch', borrowReturnLimiter, (req, res) => {
    const result = service.returnBatch(req.body);
    res.status(result.status).json(result.body);
  });

  router.get('', requireAdminPermission('records'), (req, res) => {
    const result = service.list(req.query);
    res.status(result.status).json(result.body);
  });

  router.get('/active', requireAdminPermission('records'), (req, res) => {
    const result = service.listActive();
    res.status(result.status).json(result.body);
  });

  router.put('/:id', requireAdminPermission('records'), (req, res) => {
    const result = service.update(req.body, req.params);
    res.status(result.status).json(result.body);
  });

  router.post('/:id/force-return', requireAdminPermission('records'), (req, res) => {
    const result = service.forceReturn(req.body, req.params);
    res.status(result.status).json(result.body);
  });

  router.post('/force-return-batch', requireAdminPermission('records'), (req, res) => {
    const result = service.forceReturnBatch(req.body);
    res.status(result.status).json(result.body);
  });

  router.delete('/:id', requireAdminPermission('records'), (req, res) => {
    const result = service.archive(req.params);
    res.status(result.status).json(result.body);
  });

  router.post('/:id/restore', requireAdminPermission('records'), (req, res) => {
    const result = service.restore(req.params);
    res.status(result.status).json(result.body);
  });

  router.delete('/:id/permanent', requireAdminPermission('records'), (req, res) => {
    const result = service.removePermanently(req.params);
    res.status(result.status).json(result.body);
  });

  return router;
}

module.exports = { createRecordRouter };
