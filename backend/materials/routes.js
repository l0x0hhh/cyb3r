const express = require('express');
const crypto = require('node:crypto');
const multer = require('multer');
const { rateLimit } = require('express-rate-limit');
const { MaterialError } = require('./store');

function createMaterialsRouter({ store, requireAdminPermission, upload, validateUploadedImage, optimizeUploadedImage, demo }) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}`) {
      return res.status(403).json({ success: false, message: '请在本站页面提交操作' });
    }
    req.materialOwner = req.siteVisitorHash;
    next();
  });
  const publicLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: '操作过于频繁，请稍后再试' } });
  const imageLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: '图片上传次数较多，请稍后再试' } });
  const lookupLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false,
    message: { success: false, message: '查询过于频繁，请稍后再试' } });
  const handle = fn => async (req, res, next) => { try { const data = await fn(req, res); if (!res.headersSent) res.json({ success: true, data }); } catch (error) { next(error); } };
  const devices = requireAdminPermission('materials-inventory'), records = requireAdminPermission('materials-records');
  const actor = req => req.session.adminUserId;
  router.get('/catalog', handle(() => ({ materials: store.listMaterials(), demo: Boolean(demo) })));
  router.get('/records', publicLimit, handle(req => store.loanRecords(req.materialOwner)));
  router.post('/records/lookup', lookupLimit, handle(req => store.lookupRecords(req.materialOwner, req.body)));
  router.post('/borrow', publicLimit, handle(req => store.borrow(req.materialOwner, req.body)));
  router.post('/restore', publicLimit, handle(req => store.restore(req.materialOwner, req.body.receipt)));
  router.post('/returns', publicLimit, handle(req => store.submitReturn(req.materialOwner, req.body)));
  router.post('/returns/:id/confirm-normal', publicLimit, handle(req => store.confirmNormalReturn(req.materialOwner, req.params.id)));
  router.get('/entries', publicLimit, handle(req => store.entries(req.materialOwner)));
  router.post('/entries', publicLimit, handle(req => store.submitEntry(req.materialOwner, req.body)));
  router.post('/images', imageLimit, upload.single('image'), validateUploadedImage, optimizeUploadedImage, handle(req => {
    if (!req.optimizedImage) throw new MaterialError('请选择拍摄或已有的图片');
    store.registerImage(req.materialOwner, req.optimizedImage.image);
    return req.optimizedImage;
  }));
  router.get('/admin/overview', devices, records, handle(() => ({
    materials: store.listMaterials(true), loans: store.loanRecords(null, true), entries: store.entries(null, true), returns: store.adminReturns(), ledger: store.ledger(), demo: Boolean(demo)
  })));
  // 统一后台按已有权限分别读取，库存管理员不获得借用人的完整资料。
  router.get('/admin/inventory', devices, handle(() => ({
    materials: store.listMaterials(true), entries: store.entries(null, true), ledger: store.ledger(), demo: Boolean(demo)
  })));
  router.get('/admin/records', records, handle(() => ({
    loans: store.loanRecords(null, true), returns: store.adminReturns(), demo: Boolean(demo)
  })));
  router.post('/admin/materials', devices, handle(req => store.addMaterial(req.materialOwner, req.body, actor(req))));
  router.post('/admin/materials/:id/adjust', devices, handle(req => store.adjust(req.params.id, req.body.delta, req.body.reason, actor(req))));
  router.post('/admin/materials/:id/consumption-policy', devices, handle(req => store.setConsumptionPolicy(req.params.id, req.body.percent, actor(req))));
  router.post('/admin/materials/:id/status', devices, handle(req => store.setStatus(req.params.id, req.body.status, actor(req))));
  router.post('/admin/entries/:id/review', devices, handle(req => store.reviewEntry(req.params.id, req.body.decision, req.body.note, actor(req), req.body.targetId)));
  router.post('/admin/returns/:id/review', records, handle(req => store.reviewReturn(req.params.id, req.body.decision, req.body.note, actor(req))));
  router.get('/admin/export', devices, handle(async (req, res) => {
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet('物资库存');
    sheet.columns = [ ['name','名称',24], ['category','分类',16], ['model','规格',24], ['unit','单位',10], ['location','存放地点',28],
      ['quantity','可借数量',14], ['outstanding','在借数量',14], ['quarantine','隔离数量',14], ['consumableText','消耗品',12], ['statusText','状态',12] ].map(([key, header, width]) => ({ key, header, width }));
    for (const material of store.listMaterials(true)) sheet.addRow({ ...material, consumableText: material.consumable ? '是' : '否', statusText: material.status === 'active' ? '启用' : '停用' });
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF215849' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.attachment('materials-inventory.xlsx');
    res.send(Buffer.from(await workbook.xlsx.writeBuffer()));
  }));
  const workbookUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  router.post('/admin/import/preview', devices, workbookUpload.single('file'), handle(async req => {
    const ExcelJS = require('exceljs');
    if (!req.file || !/\.xlsx$/i.test(req.file.originalname)) throw new MaterialError('请选择不超过2MB的xlsx文件');
    const workbook = new ExcelJS.Workbook();
    try { await workbook.xlsx.load(req.file.buffer); } catch { throw new MaterialError('无法读取此工作簿'); }
    const sheet = workbook.worksheets[0];
    if (!sheet || sheet.rowCount > 501) throw new MaterialError('模板应为首行表头，最多500条物资');
    const headings = sheet.getRow(1).values;
    const required = ['名称','分类','规格','单位','存放地点','入库数量','消耗品','备注'];
    const indexes = required.map(label => headings.indexOf(label));
    if (indexes.some(index => index < 1)) throw new MaterialError(`请使用表头：${required.join('、')}`);
    const rows = [], errors = [];
    sheet.eachRow((row, number) => {
      if (number === 1) return;
      const cells = indexes.map(index => row.getCell(index));
      if (cells.every(cell => cell.value === null || cell.value === '')) return;
      if (cells.some(cell => cell.type === 6)) { errors.push(`第${number}行含公式，请先转为实际值`); return; }
      const [name, category, model, unit, location, qty, consumable, notes] = cells.map(cell => cell.value);
      if (typeof qty !== 'number' || !Number.isSafeInteger(qty) || qty <= 0 || qty > 1000000 || !name || !unit || !location || !['是','否'].includes(String(consumable))) {
        errors.push(`第${number}行：检查名称、单位、地点、正整数数量及消耗品（是／否）`); return;
      }
      rows.push({ name: String(name), category: String(category || '其他物资'), model: String(model || ''), unit: String(unit), location: String(location), quantity: qty, consumable: String(consumable) === '是', notes: String(notes || ''), images: [] });
    });
    return { rows, errors, batchId: crypto.randomUUID(), warning: '仅导入文字和数量，图片请在网页录入时上传。确认后生成正式入库流水；相同批次重复确认不会重复入库。' };
  }));
  router.post('/admin/import', devices, handle(req => store.importMaterials(req.materialOwner, req.body.rows, actor(req), req.body.batchId)));
  router.use((error, req, res, next) => {
    if (error instanceof MaterialError) return res.status(error.status).json({ success: false, message: error.message });
    if (error instanceof multer.MulterError || ['INVALID_IMAGE_TYPE', 'IMAGE_PROCESSING_FAILED'].includes(error.code)) return res.status(400).json({ success: false, message: error.code === 'LIMIT_FILE_SIZE' ? '文件大小超出限制' : error.message });
    console.error('Materials operation failed:', error.message);
    res.status(500).json({ success: false, message: '操作未完成，请稍后重试' });
  });
  return router;
}
module.exports = { createMaterialsRouter };
