// @ts-check
// 借用清单集中管理设备摘要、数量上限和弹窗；提交结果仅移除快照中已确认借出的设备。
import { reactive, readonly, ref } from 'vue';

/** @typedef {import('../types/device').BorrowCartItem} BorrowCartItem */
/** @typedef {Pick<import('../types/device').PortalDevice, 'id' | 'name'> & { model?: string | null }} CartDevice */

export const MAX_BATCH_BORROW = 10;

export function useBorrowCart() {
  /** @type {BorrowCartItem[]} */
  const items = reactive([]);
  const showBorrowCart = ref(false);
  const showBatchBorrowForm = ref(false);

  function closeEmptyCart() {
    if (!items.length) {
      showBorrowCart.value = false;
      showBatchBorrowForm.value = false;
    }
  }

  /** @param {string} deviceId */
  function isInCart(deviceId) {
    return items.some(item => item.id === deviceId);
  }

  /** @param {CartDevice} device @returns {'added' | 'removed' | 'limit' | 'invalid'} */
  function toggleCartDevice(device) {
    if (!device || typeof device.id !== 'string' || !device.id.trim()) return 'invalid';
    const index = items.findIndex(item => item.id === device.id);
    if (index >= 0) {
      items.splice(index, 1);
      closeEmptyCart();
      return 'removed';
    }
    if (items.length >= MAX_BATCH_BORROW) return 'limit';
    items.push({ id: device.id, name: device.name, model: device.model || '' });
    return 'added';
  }

  /** @param {readonly string[]} deviceIds */
  function removeCartDevices(deviceIds) {
    const removedIds = new Set(deviceIds);
    for (let index = items.length - 1; index >= 0; index -= 1) {
      if (removedIds.has(items[index].id)) items.splice(index, 1);
    }
    closeEmptyCart();
  }

  function clearBorrowCart() {
    items.splice(0, items.length);
    closeEmptyCart();
  }

  function openBatchBorrowForm() {
    if (!items.length) return false;
    showBorrowCart.value = false;
    showBatchBorrowForm.value = true;
    return true;
  }

  function snapshotBorrowCart() {
    // 复制摘要，避免异步请求等待期间的增删影响已提交设备集合。
    return items.map(item => ({ ...item }));
  }

  /** @param {readonly string[]} submittedDeviceIds @param {readonly string[]} borrowedDeviceIds */
  function settleBatchBorrow(submittedDeviceIds, borrowedDeviceIds) {
    const submittedIds = new Set(submittedDeviceIds);
    removeCartDevices(borrowedDeviceIds.filter(deviceId => submittedIds.has(deviceId)));
  }

  return {
    MAX_BATCH_BORROW, borrowCart: readonly(items), showBorrowCart, showBatchBorrowForm,
    isInCart, toggleCartDevice, removeCartDevices, clearBorrowCart, openBatchBorrowForm,
    snapshotBorrowCart, settleBatchBorrow
  };
}
