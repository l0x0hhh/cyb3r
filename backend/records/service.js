// 借还记录业务：注入同步仓储与邮件队列，保持事务顺序、响应内容和错误状态。
const { normalizePhone, isFullPhone, withRecordCompatibility } = require('./validation');
const { createReturnAuthorizationStore } = require('./return-authorization');

// HTTP 映射只携带既有状态与 JSON；不把 Express 请求或响应传入业务层。
function reply(status, body) {
  return { status, body };
}

function createRecordService({
  store: DATA_STORE,
  collections: { devices: DEVICES_FILE, records: RECORDS_FILE },
  email: { queueEmailNotification, queueBatchEmailNotification },
  appendOperationLog, getDeviceImageFields, getOperationalStatus,
  returnAuthorization = createReturnAuthorizationStore()
}) {
  const { createReturnAuthorization, getReturnAuthorization, removeReturnAuthorization } = returnAuthorization;
  const readJSON = filePath => DATA_STORE.readCollection(filePath);
  const writeJSON = (filePath, data) => DATA_STORE.writeCollection(filePath, data);

  // 单台库存借用：两份快照在同一事务提交后才通知。
  function borrow(body) {
    try {
      const deviceId = String(body?.deviceId || '').trim();
      const borrowerName = String(body?.borrowerName || '').trim();
      const borrowerId = String(body?.borrowerId || '').trim();
      const borrowerPhone = normalizePhone(body?.borrowerPhone);
      const major = String(body?.major ?? body?.department ?? '').trim();
      const purpose = String(body?.purpose ?? body?.notes ?? '').trim();
      if (!deviceId || !borrowerName || !borrowerPhone || !major || !purpose) {
        return reply(400, { success: false, message: '姓名、完整手机号、专业和用途均为必填项' });
      }
      if (!isFullPhone(borrowerPhone)) {
        return reply(400, { success: false, message: '请输入 11 位完整手机号' });
      }

      const devices = readJSON(DEVICES_FILE);
      const device = devices.find(d => d.id === deviceId);
      if (!device) return reply(404, { success: false, message: '设备不存在' });
      if (getOperationalStatus(device) === 'offline') {
        return reply(409, { success: false, message: '该设备当前已下线，无法借用' });
      }
      if (device.status === 'borrowed') {
        return reply(409, { success: false, message: '该设备已被借用，请先归还' });
      }

      const records = readJSON(RECORDS_FILE);
      const record = {
        id: 'REC' + Date.now().toString(36).toUpperCase(),
        deviceId,
        deviceName: device.name,
        deviceModel: device.model,
        type: 'borrow',
        borrowerName,
        borrowerId,
        borrowerPhone,
        major,
        purpose,
        // 保留旧字段，便于旧部署脚本和历史前端平滑读取。
        department: major,
        notes: purpose,
        createdAt: new Date().toISOString()
      };
      device.status = 'borrowed';
      records.push(record);
      DATA_STORE.transaction(() => {
        writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
      });

      queueEmailNotification('borrow', record);
      return reply(200, { success: true, message: '借用成功', data: record });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 其他设备只写借用记录，不创建或修改库存。
  function borrowOther(body) {
    try {
      const otherDeviceName = String(body?.otherDeviceName || '').trim();
      const borrowerName = String(body?.borrowerName || '').trim();
      const borrowerId = String(body?.borrowerId || '').trim();
      const borrowerPhone = normalizePhone(body?.borrowerPhone);
      const major = String(body?.major ?? body?.department ?? '').trim();
      const purpose = String(body?.purpose ?? body?.notes ?? '').trim();
      if (!otherDeviceName || !borrowerName || !borrowerPhone || !major || !purpose) {
        return reply(400, { success: false, message: '设备名称、姓名、完整手机号、专业和用途均为必填项' });
      }
      if (!isFullPhone(borrowerPhone)) {
        return reply(400, { success: false, message: '请输入 11 位完整手机号' });
      }

      const records = readJSON(RECORDS_FILE);
      const record = {
        id: 'REC' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
        deviceId: null,
        deviceName: otherDeviceName,
        deviceModel: '',
        isOtherDevice: true,
        otherDeviceName,
        type: 'borrow',
        borrowerName,
        borrowerId,
        borrowerPhone,
        major,
        purpose,
        // 保留旧字段，便于旧部署脚本和历史前端平滑读取。
        department: major,
        notes: purpose,
        createdAt: new Date().toISOString()
      };
      records.push(record);
      writeJSON(RECORDS_FILE, records);

      queueEmailNotification('borrow', record);
      return reply(200, { success: true, message: '借用成功', data: record });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 批量借用逐台收集冲突，保留部分成功与一封汇总邮件。
  function borrowBatch(body) {
    try {
      const rawIds = Array.isArray(body?.deviceIds) ? body.deviceIds : [];
      const deviceIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))];
      const borrowerName = String(body?.borrowerName || '').trim();
      const borrowerId = String(body?.borrowerId || '').trim();
      const borrowerPhone = normalizePhone(body?.borrowerPhone);
      const major = String(body?.major ?? body?.department ?? '').trim();
      const purpose = String(body?.purpose ?? body?.notes ?? '').trim();

      if (!deviceIds.length) {
        return reply(400, { success: false, message: '请选择要借用的设备' });
      }
      if (deviceIds.length > 10) {
        return reply(400, { success: false, message: '单次最多可批量借用 10 台设备' });
      }
      if (!borrowerName || !borrowerPhone || !major || !purpose) {
        return reply(400, { success: false, message: '姓名、完整手机号、专业和用途均为必填项' });
      }
      if (!isFullPhone(borrowerPhone)) {
        return reply(400, { success: false, message: '请输入 11 位完整手机号' });
      }

      const devices = readJSON(DEVICES_FILE);
      const records = readJSON(RECORDS_FILE);
      const borrowed = [];
      const conflicts = [];
      const createdRecords = [];
      const now = new Date().toISOString();

      for (const deviceId of deviceIds) {
        const device = devices.find(d => d.id === deviceId);
        if (!device) {
          conflicts.push({ deviceId, deviceName: '(未知设备)', reason: '设备不存在' });
          continue;
        }
        if (getOperationalStatus(device) === 'offline') {
          conflicts.push({ deviceId, deviceName: device.name, reason: '该设备当前已下线，无法借用' });
          continue;
        }
        if (device.status === 'borrowed') {
          conflicts.push({ deviceId, deviceName: device.name, reason: '该设备已被借用，请先归还' });
          continue;
        }

        device.status = 'borrowed';
        const record = {
          // 批量借出同毫秒内产生多条记录，追加随机后缀避免记录 ID 冲突。
          id: 'REC' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase(),
          deviceId,
          deviceName: device.name,
          deviceModel: device.model,
          type: 'borrow',
          borrowerName,
          borrowerId,
          borrowerPhone,
          major,
          purpose,
          // 保留旧字段，便于旧部署脚本和历史前端平滑读取。
          department: major,
          notes: purpose,
          createdAt: now
        };
        records.push(record);
        createdRecords.push(record);
        borrowed.push({ deviceId, deviceName: device.name, recordId: record.id });
      }

      DATA_STORE.transaction(() => {
        writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
      });

      // 批量借出只发一封汇总邮件，不再逐台发送。
      queueBatchEmailNotification('borrow', createdRecords);

      if (borrowed.length) {
        const message = '成功借出 ' + borrowed.length + ' 台设备'
          + (conflicts.length ? '，' + conflicts.length + ' 台设备暂时无法借用' : '');
        return reply(200, { success: true, message, data: { borrowed, conflicts } });
      }
      return reply(200, { success: false, message: '所有设备暂时无法借用', data: { borrowed: [], conflicts } });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 姓名与完整电话匹配本人记录，只返回归还所需字段和短期凭证。
  function lookupReturns(body) {
    try {
      const borrowerName = String(body?.borrowerName || '').trim();
      const borrowerPhone = normalizePhone(body?.borrowerPhone);
      if (!borrowerName || !isFullPhone(borrowerPhone)) {
        return reply(400, { success: false, message: '请输入姓名和 11 位完整手机号' });
      }

      const devices = readJSON(DEVICES_FILE);
      const records = readJSON(RECORDS_FILE);
      const matchedRecords = records.filter(record =>
        record.type === 'borrow'
        && !record.returnedAt
        && !record.deletedAt
        && String(record.borrowerName || '').trim() === borrowerName
        && normalizePhone(record.borrowerPhone) === borrowerPhone
      );

      const publicRecords = matchedRecords
        .map(record => {
          const device = devices.find(item => item.id === record.deviceId);
          if (record.isOtherDevice === true) {
            return {
              recordId: record.id,
              deviceId: null,
              deviceName: record.deviceName,
              deviceModel: record.deviceModel || '',
              isOtherDevice: true,
              borrowedAt: record.createdAt
            };
          }
          if (!device || device.status !== 'borrowed') return null;
          return {
            recordId: record.id,
            deviceId: device.id,
            deviceName: device.name,
            deviceModel: device.model,
            ...getDeviceImageFields(device),
            location: device.location || '',
            borrowedAt: record.createdAt
          };
        })
        .filter(Boolean);

      const returnToken = publicRecords.length
        ? createReturnAuthorization(publicRecords.map(record => record.recordId))
        : null;
      return reply(200, { success: true, data: { records: publicRecords, returnToken } });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 单台归还在事务成功后消费凭证。
  function returnOne(body) {
    try {
      const recordId = String(body?.recordId || '').trim();
      const returnToken = String(body?.returnToken || '').trim();
      const authorization = getReturnAuthorization(returnToken);
      if (!recordId || !authorization || !authorization.recordIds.includes(recordId)) {
        return reply(403, { success: false, message: '归还验证已失效，请重新查询' });
      }

      const records = readJSON(RECORDS_FILE);
      const activeRecord = records.find(record =>
        record.id === recordId && record.type === 'borrow' && !record.returnedAt && !record.deletedAt
      );
      if (!activeRecord) {
        return reply(409, { success: false, message: '未找到当前借用记录' });
      }

      const devices = readJSON(DEVICES_FILE);
      const device = devices.find(item => item.id === activeRecord.deviceId);
      if (activeRecord.isOtherDevice !== true && !device) {
        return reply(404, { success: false, message: '设备不存在' });
      }
      if (activeRecord.isOtherDevice !== true && device.status === 'available') {
        return reply(409, { success: false, message: '该设备当前未借出' });
      }

      activeRecord.returnedAt = new Date().toISOString();
      activeRecord.returnNotes = String(body?.notes || '').trim();
      if (device) device.status = 'available';
      DATA_STORE.transaction(() => {
        if (device) writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
      });

      authorization.recordIds = authorization.recordIds.filter(id => id !== recordId);
      if (!authorization.recordIds.length) removeReturnAuthorization(returnToken);

      queueEmailNotification('return', activeRecord);
      return reply(200, { success: true, message: '归还成功' });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 沿用基线批量凭证消费时点；事务失败时不擅自改变内存凭证行为。
  function returnBatch(body) {
    try {
      const rawIds = Array.isArray(body?.recordIds) ? body.recordIds : [];
      const recordIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))];
      const returnToken = String(body?.returnToken || '').trim();
      const notes = String(body?.notes || '').trim();
      const authorization = getReturnAuthorization(returnToken);

      if (!recordIds.length) {
        return reply(400, { success: false, message: '请选择要归还的设备' });
      }
      if (recordIds.length > 10) {
        return reply(400, { success: false, message: '单次最多可批量归还 10 台设备' });
      }
      if (!authorization) {
        return reply(403, { success: false, message: '归还验证已失效，请重新查询' });
      }

      const devices = readJSON(DEVICES_FILE);
      const records = readJSON(RECORDS_FILE);
      const returned = [];
      const conflicts = [];
      const returnedRecords = [];
      const now = new Date().toISOString();

      for (const recordId of recordIds) {
        if (!authorization.recordIds.includes(recordId)) {
          conflicts.push({ recordId, reason: '归还验证已失效，请重新查询' });
          continue;
        }
        const record = records.find(item => item.id === recordId && item.type === 'borrow' && !item.returnedAt && !item.deletedAt);
        if (!record) {
          conflicts.push({ recordId, reason: '未找到当前借用记录' });
          continue;
        }
        const device = devices.find(item => item.id === record.deviceId);
        if (record.isOtherDevice !== true && !device) {
          conflicts.push({ recordId, reason: '设备不存在' });
          continue;
        }
        if (record.isOtherDevice !== true && device.status === 'available') {
          conflicts.push({ recordId, reason: '该设备当前未借出' });
          continue;
        }

        record.returnedAt = now;
        record.returnNotes = notes;
        if (device) device.status = 'available';
        returned.push({ recordId, deviceId: record.deviceId, deviceName: record.deviceName });
        returnedRecords.push(record);
        authorization.recordIds = authorization.recordIds.filter(id => id !== recordId);
      }

      DATA_STORE.transaction(() => {
        if (returned.some(item => item.deviceId)) writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
      });
      if (!authorization.recordIds.length) removeReturnAuthorization(returnToken);

      // 批量归还只发一封汇总邮件，不再逐台发送。
      queueBatchEmailNotification('return', returnedRecords);

      if (returned.length) {
        const message = '成功归还 ' + returned.length + ' 台设备'
          + (conflicts.length ? '，' + conflicts.length + ' 台设备无法归还' : '');
        return reply(200, { success: true, message, data: { returned, conflicts } });
      }
      return reply(200, { success: false, message: '所选设备均无法归还', data: { returned: [], conflicts } });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 完整联系人仅由受 records 权限保护的路由调用。
  function list(query) {
    try {
      const records = readJSON(RECORDS_FILE);
      const includeDeleted = query.includeDeleted === 'true';
      const visibleRecords = includeDeleted
        ? records
        : records.filter(record => !record.deletedAt);
      return reply(200, { success: true, data: [...visibleRecords].reverse().map(withRecordCompatibility) });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 当前借出记录排除归档和已归还记录。
  function listActive() {
    try {
      const records = readJSON(RECORDS_FILE);
      const active = records
        .filter(r => r.type === 'borrow' && !r.returnedAt && !r.deletedAt)
        .reverse()
        .map(withRecordCompatibility);
      return reply(200, { success: true, data: active });
    } catch (e) {
      return reply(200, { success: false, message: e.message });
    }
  }

  // 管理员修改信息仍保留旧字段和原有校验顺序。
  function update(body, params) {
    try {
      const records = readJSON(RECORDS_FILE);
      const record = records.find(item => item.id === params.id);
      if (!record) return reply(404, { success: false, message: '记录不存在' });
      if (record.deletedAt) return reply(409, { success: false, message: '已归档记录不能直接修改' });

      const borrowerName = String(body?.borrowerName || '').trim();
      const borrowerId = String(body?.borrowerId || '').trim();
      const borrowerPhone = normalizePhone(body?.borrowerPhone);
      const major = String(body?.major ?? body?.department ?? '').trim();
      const purpose = String(body?.purpose ?? body?.notes ?? '').trim();
      if (!String(borrowerName || '').trim() || !String(borrowerPhone || '').trim()) {
        return reply(400, { success: false, message: '姓名和联系电话不能为空' });
      }
      if (!isFullPhone(borrowerPhone)) {
        return reply(400, { success: false, message: '请输入 11 位完整手机号' });
      }
      if (!major || !purpose) {
        return reply(400, { success: false, message: '专业和用途不能为空' });
      }

      record.borrowerName = borrowerName;
      record.borrowerId = borrowerId;
      record.borrowerPhone = borrowerPhone;
      record.major = major;
      record.purpose = purpose;
      record.department = major;
      record.notes = purpose;
      writeJSON(RECORDS_FILE, records);
      return reply(200, { success: true, data: withRecordCompatibility(record), message: '借用信息已更新' });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 管理员归还把库存、记录和操作日志放在同一事务。
  function forceReturn(body, params) {
    try {
      const records = readJSON(RECORDS_FILE);
      const record = records.find(item => item.id === params.id);
      if (!record) return reply(404, { success: false, message: '记录不存在' });
      if (record.returnedAt) return reply(409, { success: false, message: '该记录已经归还' });

      const devices = readJSON(DEVICES_FILE);
      const device = devices.find(item => item.id === record.deviceId);
      if (record.isOtherDevice !== true && !device) {
        return reply(404, { success: false, message: '设备不存在' });
      }

      record.returnedAt = new Date().toISOString();
      record.returnNotes = String(body?.notes || '管理员确认归还').trim();
      // 其他设备没有库存对象，日志使用记录快照构造虚拟目标。
      const logDevice = device || {
        id: record.deviceId || `other:${record.id}`,
        name: record.deviceName,
        model: record.deviceModel || ''
      };
      if (device) device.status = 'available';
      DATA_STORE.transaction(() => {
        if (device) writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
        appendOperationLog('admin_returned', logDevice, `管理员归还设备：${logDevice.name}（${logDevice.model}）`);
      });
      queueEmailNotification('adminReturn', record);
      return reply(200, { success: true, data: withRecordCompatibility(record), message: '设备已由管理员归还' });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 批量管理员归还只写一条汇总日志并发一封汇总邮件。
  function forceReturnBatch(body) {
    try {
      const rawIds = Array.isArray(body?.recordIds) ? body.recordIds : [];
      const recordIds = [...new Set(rawIds.map(id => String(id || '').trim()).filter(Boolean))];
      const notes = String(body?.notes || '管理员确认归还').trim();

      if (!recordIds.length) {
        return reply(400, { success: false, message: '请选择要归还的记录' });
      }
      if (recordIds.length > 50) {
        return reply(400, { success: false, message: '单次最多可批量归还 50 台设备' });
      }

      const records = readJSON(RECORDS_FILE);
      const devices = readJSON(DEVICES_FILE);
      const returned = [];
      const conflicts = [];
      const returnedRecords = [];
      const now = new Date().toISOString();

      for (const recordId of recordIds) {
        const record = records.find(item => item.id === recordId);
        if (!record) {
          conflicts.push({ recordId, reason: '记录不存在' });
          continue;
        }
        if (record.returnedAt) {
          conflicts.push({ recordId, deviceName: record.deviceName, reason: '该记录已经归还' });
          continue;
        }
        const device = devices.find(item => item.id === record.deviceId);
        if (record.isOtherDevice !== true && !device) {
          conflicts.push({ recordId, deviceName: record.deviceName, reason: '设备不存在' });
          continue;
        }

        record.returnedAt = now;
        record.returnNotes = notes;
        if (device) device.status = 'available';
        returned.push({ recordId, deviceId: record.deviceId, deviceName: record.deviceName, isOtherDevice: record.isOtherDevice === true });
        returnedRecords.push(record);
      }

      // 批量归还只写一条汇总日志（对齐批量上下线），日志不含借用人隐私。
      DATA_STORE.transaction(() => {
        if (returned.some(item => item.deviceId)) writeJSON(DEVICES_FILE, devices);
        writeJSON(RECORDS_FILE, records);
        if (returned.length) {
          appendOperationLog(
            'admin_returned',
            { id: 'batch', name: '批量归还设备' },
            `批量管理员归还 ${returned.length} 台设备${notes && notes !== '管理员确认归还' ? `；备注：${notes}` : ''}`
          );
        }
      });
      // 批量归还只发一封汇总邮件，不再逐台发送。
      queueBatchEmailNotification('adminReturn', returnedRecords);

      if (returned.length) {
        const message = '成功归还 ' + returned.length + ' 台设备'
          + (conflicts.length ? '，' + conflicts.length + ' 台设备无法归还' : '');
        return reply(200, { success: true, message, data: { returned, conflicts } });
      }
      return reply(200, { success: false, message: '所选记录均无法归还', data: { returned: [], conflicts } });
    } catch (e) {
      return reply(500, { success: false, message: '批量归还失败: ' + e.message });
    }
  }

  // 仅已归还记录可以归档。
  function archive(params) {
    try {
      const records = readJSON(RECORDS_FILE);
      const record = records.find(item => item.id === params.id);
      if (!record) {
        return reply(404, { success: false, message: '记录不存在' });
      }
      if (!record.returnedAt) {
        return reply(409, { success: false, message: '当前借用记录不能删除' });
      }

      if (!record.deletedAt) {
        record.deletedAt = new Date().toISOString();
        record.deletedBy = 'admin';
        writeJSON(RECORDS_FILE, records);
      }

      return reply(200, { success: true, message: '记录已归档' });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 恢复仅清除原有归档标记。
  function restore(params) {
    try {
      const records = readJSON(RECORDS_FILE);
      const record = records.find(item => item.id === params.id);
      if (!record) {
        return reply(404, { success: false, message: '记录不存在' });
      }

      delete record.deletedAt;
      delete record.deletedBy;
      writeJSON(RECORDS_FILE, records);
      return reply(200, { success: true, message: '记录已恢复' });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  // 永久删除必须先归档。
  function removePermanently(params) {
    try {
      const records = readJSON(RECORDS_FILE);
      const record = records.find(item => item.id === params.id);
      if (!record) {
        return reply(404, { success: false, message: '记录不存在' });
      }
      if (!record.deletedAt) {
        return reply(409, { success: false, message: '请先归档该记录' });
      }

      writeJSON(RECORDS_FILE, records.filter(item => item.id !== params.id));
      return reply(200, { success: true, message: '记录已永久删除' });
    } catch (e) {
      return reply(500, { success: false, message: e.message });
    }
  }

  return { borrow, borrowOther, borrowBatch, lookupReturns, returnOne, returnBatch, list, listActive, update, forceReturn, forceReturnBatch, archive, restore, removePermanently };
}

module.exports = { createRecordService };
