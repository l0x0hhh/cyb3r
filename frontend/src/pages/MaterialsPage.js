import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import '../styles/materials.css';
import '../styles/materials-public.css';
import '../styles/materials-admin.css';
import { preference, savePreference } from '../services/preferences.js';

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  bag: '<path d="M5 7h14l1 14H4L5 7Z"/><path d="M8 8V6a4 4 0 0 1 8 0v2"/>',
  add: '<path d="M12 5v14M5 12h14"/>',
  box: '<path d="m12 3 9 5-9 5-9-5 9-5ZM3 8v10l9 5 9-5V8M12 13v10M7.5 5.5l9 5"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="7"/><path d="m16 16 5 5"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  camera: '<path d="M4 6h4l2-3h4l2 3h4v15H4V6Z"/><circle cx="12" cy="13" r="4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 4-4 4 5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  shield: '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  list: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.1M3 12h.1M3 19h.1"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  leaf: '<path d="M20 3C9 2 3 7 5 15s15 6 15-12ZM4 21 15 10"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4M9 12h12"/>'
};
const Icon = { props: ['name'], template: '<svg class="mm-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="content"></svg>', computed: { content() { return ICONS[this.name] || ICONS.box; } } };
const EMPTY_IMAGE = '/assets/materials/placeholder.svg';
const STATUS = { pending: '待管理员确认', approved: '已确认', rejected: '已驳回' };

export default {
  name: 'MaterialsPage', components: { MIcon: Icon },
  props: { embedded: Boolean, section: { type: String, default: 'inventory' }, adminUser: { type: Object, default: null } },
  emits: ['navigate', 'session-expired'],
  setup(props, { emit }) {
    const adminRoute = props.embedded;
    const page = ref(adminRoute ? props.section : preference('materialPage','catalog')), loading = ref(true), busy = ref(false), toast = ref(null), demo = ref(false);
    const materials = ref([]), loans = ref([]), entries = ref([]), reviews = ref([]), ledger = ref([]), alerts = ref([]);
    const admin = computed(() => props.adminUser), query = ref(''), category = ref(adminRoute?'全部':preference('materialCategory','全部')), type = ref(adminRoute?'all':preference('materialType','all')), cart = ref([]), modal = ref(null);
    const canInventory = computed(() => admin.value?.role === 'super_admin' || admin.value?.permissions?.includes('materials-inventory'));
    const canRecords = computed(() => admin.value?.role === 'super_admin' || admin.value?.permissions?.includes('materials-records'));
    const photos = ref([]), uploadBusy = ref(false), entryResult = ref(false), onlyAvailable = ref(adminRoute?false:preference('materialOnlyAvailable',false));
    const action = reactive({ note: '', delta: 0, decision: 'approved', targetId: '', percent:30, counted:0, requestId:'' });
    const importData = ref(null);
    const lookupForm = reactive({ name: '', phone: '' }), activeLookup = ref(null), lookupCompleted = ref(false);
    const borrowForm = reactive({ name: '', phone: '', organization: '', purpose: '', dueDate: '' });
    const entry = reactive({ name: '', model: '', category: '活动器材', unit: '个', location: '', quantity: 1, consumable: false, submitter: '', notes: '' });
    const returnLines = ref([]), returnNotes = ref('');
    const returnNeedsReview = computed(() => returnLines.value.some(line => Number(line.damaged)>0 || Number(line.lost)>0 || (Number(line.consumed)>0 && Number(line.consumed)*100 > line.borrowed*line.consumption_review_percent)));
    const categoryChoices = ['活动器材', '电子设备', '办公用品', '消耗品', '其他物资'];
    let toastTimer, holdTimer, activeHold = null, heldClick = null, borrowRequest = null, returnRequest = null, entryRequest = null;
    const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    function notify(message, error = false) { clearTimeout(toastTimer); toast.value = { message, error }; toastTimer = setTimeout(() => { toast.value = null; }, 5500); }
    function headers() { const sessionId = adminRoute ? localStorage.getItem('sessionId') : ''; return sessionId ? { 'x-session-id': sessionId } : {}; }
    async function api(path, options = {}) {
      const formData = options.body instanceof FormData;
      const response = await fetch(path.startsWith('/api/') ? path : `/api/v2${path}`, {
        ...options, credentials: 'same-origin', headers: { ...headers(), ...(options.body && !formData ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
        body: options.body ? (formData ? options.body : JSON.stringify(options.body)) : undefined
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('服务暂时无法响应，请稍后重试'); }
      if (response.status === 401 && adminRoute) emit('session-expired');
      if (!response.ok || !result.success) throw new Error(result.message || '操作未完成');
      return result.data ?? result;
    }
    async function attempt(fn) { if (busy.value) return; busy.value = true; try { return await fn(); } catch (error) { notify(error.message, true); } finally { busy.value = false; } }
    async function load() {
      loading.value = true;
      try {
        if (adminRoute && admin.value) {
          const [inventory, records] = await Promise.all([
            canInventory.value ? api('/admin/inventory') : null,
            canRecords.value ? api('/admin/records') : null
          ]);
          materials.value = inventory?.materials || []; entries.value = inventory?.entries || []; ledger.value = inventory?.ledger || [];
          alerts.value = records?.alerts || []; loans.value = records?.loans || []; reviews.value = records?.returns || []; demo.value = inventory?.demo || records?.demo || false;
        } else if (!adminRoute) {
          // 首次先建立浏览器关联Cookie，避免并行请求分别生成不同关联标识。
          const catalog = await api('/catalog');
          const [records, entryRecords] = await Promise.all([
            page.value === 'mine' && activeLookup.value ? api('/records/lookup', { method:'POST', body:activeLookup.value }) : api('/records'),
            api('/entries')
          ]);
          materials.value = catalog.materials; demo.value = catalog.demo; loans.value = records; entries.value = entryRecords;
          for (const item of cart.value) item.max = materials.value.find(m => m.id === item.materialId)?.quantity ?? 0;
        }
      } catch (error) { notify(error.message, true); } finally { loading.value = false; }
    }
    onMounted(async () => {
      if (!adminRoute) document.title = '物资借用 · 网络空间安全学院团委';
      await load();
    });
    watch(() => props.section, value => { if (adminRoute && value !== page.value) { page.value = value; query.value = ''; category.value = '全部'; type.value = 'all'; modal.value = null; load(); } });
    watch([page,category,type,onlyAvailable], () => { if(!adminRoute) { savePreference('materialPage',page.value); savePreference('materialCategory',category.value); savePreference('materialType',type.value); savePreference('materialOnlyAvailable',onlyAvailable.value); } });
    onBeforeUnmount(() => { clearTimeout(toastTimer); clearTimeout(holdTimer); for (const photo of photos.value) if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview); });
    const categories = computed(() => ['全部', ...new Set(materials.value.map(m => m.category))]);
    const filtered = computed(() => materials.value.filter(m => (category.value === '全部' || m.category === category.value) && (type.value === 'all' || m.consumable === (type.value === 'consumable')) && (!onlyAvailable.value || m.quantity > 0) && `${m.name} ${m.model} ${m.location}`.toLowerCase().includes(query.value.toLowerCase())));
    const stats = computed(() => ({ types: materials.value.length, available: materials.value.filter(m => m.status === 'active' && m.quantity > 0).length, consumable: materials.value.filter(m => m.consumable).length, active: loans.value.filter(l => l.remaining > 0).length, pending: reviews.value.filter(r => r.status === 'pending').length + entries.value.filter(e => e.status === 'pending').length }));
    const nav = computed(() => adminRoute ? [ ['inventory','grid','物资库存'], ['loans','bag','借用记录'], ['returns','check','归还与核销'], ['entries','add','入库审核'], ['ledger','list','库存流水'] ] : [ ['catalog','grid','物资大厅'], ['mine','bag','我的借用'], ['entry','add','录入物资'] ]);
    const title = computed(() => ({ catalog:'物资大厅', mine:'我的借用', entry:adminRoute?'新增物资':'录入物资', inventory:'物资库存', loans:'借用记录', returns:'归还与核销', entries:'入库审核', ledger:'库存流水' }[page.value]));
    function switchPage(value) { if (adminRoute) { emit('navigate', value); return; } page.value = value; query.value = ''; category.value = '全部'; type.value = 'all'; if (value !== 'entry') entryResult.value = false; load(); }
    function addToCart(m) {
      if (isInCart(m.id)) return;
      if (!m.quantity) return;
      cart.value.push({ materialId: m.id, name: m.name, unit: m.unit, location: m.location, image: m.images[0] || EMPTY_IMAGE, max: m.quantity, quantity: 1 });
      borrowRequest = null; notify(`已加入借用清单：${m.name}`);
    }
    function isInCart(id) { return cart.value.some(item => item.materialId === id); }
    function cartItem(id) { return cart.value.find(item => item.materialId === id); }
    const cartQuantity = computed(() => cart.value.reduce((total, item) => total + (Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : 0), 0));
    function removeCart(id) { cart.value = cart.value.filter(item => item.materialId !== id); borrowRequest = null; }
    function setCartQuantity(m, value) {
      const item = cartItem(m.id), quantity = Number(value);
      if (!item) return;
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > m.quantity) {
        notify(`请输入0至${m.quantity}的整数，0表示取消选择`, true); return;
      }
      if (!quantity) removeCart(m.id);
      else { item.quantity=quantity; item.max=m.quantity; borrowRequest=null; }
    }
    function changeCartQuantity(m, delta) {
      const item = cartItem(m.id);
      if (!item || ![1, -1].includes(delta)) return;
      const quantity = Number(item.quantity);
      const current = Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 1;
      if (delta < 0 && current === 1) { removeCart(m.id); notify(`已取消选择：${m.name}`); return; }
      if (delta > 0 && current >= m.quantity) return;
      item.quantity = current + delta;
      item.max = m.quantity;
      borrowRequest = null;
    }
    function startQuantityHold(event, m, delta) {
      if (event.button !== 0 || event.isPrimary === false) return;
      clearTimeout(holdTimer);
      heldClick = null;
      const hold = { pointerId:event.pointerId, materialId:m.id, delta };
      activeHold = hold;
      holdTimer = setTimeout(() => {
        if (activeHold !== hold) return;
        heldClick = { materialId:m.id, delta };
        if (delta < 0) {
          if (isInCart(m.id)) { removeCart(m.id); notify(`已取消选择：${m.name}`); }
        } else if (Number.isSafeInteger(m.quantity) && m.quantity > 0) {
          if (!isInCart(m.id)) addToCart(m);
          const item = cartItem(m.id);
          if (item) { item.quantity = m.quantity; item.max = m.quantity; borrowRequest = null; notify(`已选满：${m.name} ${m.quantity}${m.unit}`); }
        }
      }, 600);
    }
    function endQuantityHold(event) {
      if (!activeHold || event.pointerId !== activeHold.pointerId) return;
      clearTimeout(holdTimer);
      activeHold = null;
    }
    function quantityClick(event, m, delta) {
      if (event.detail !== 0 && heldClick?.materialId === m.id && heldClick.delta === delta) { heldClick = null; return; }
      heldClick = null;
      if (delta > 0 && !isInCart(m.id)) addToCart(m);
      else changeCartQuantity(m, delta);
    }
    function toggleCart(m) {
      if (isInCart(m.id)) { removeCart(m.id); notify(`已取消选择：${m.name}`); }
      else addToCart(m);
    }
    function openBorrow() {
      if (!cart.value.length) return;
      if (!borrowForm.dueDate) { const d = new Date(Date.now() + 7 * 86400000); borrowForm.dueDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
      modal.value = { kind: 'borrow' };
    }
    function borrow() { attempt(async () => {
      const payload = { ...borrowForm, dueAt: new Date(`${borrowForm.dueDate}T23:59:59+08:00`).toISOString(), items: cart.value.map(item => ({ materialId: item.materialId, quantity: Number(item.quantity) })) };
      const fingerprint = JSON.stringify(payload);
      if (!borrowRequest || borrowRequest.fingerprint !== fingerprint) borrowRequest = { id: uid(), fingerprint };
      const result = await api('/borrow', { method: 'POST', body: { ...payload, requestId: borrowRequest.id } });
      Object.assign(lookupForm, { name: borrowForm.name, phone: borrowForm.phone }); activeLookup.value = null; lookupCompleted.value = false;
      cart.value = []; borrowRequest = null;
      modal.value = { kind: 'success', id: result.id }; await load();
    }); }
    function openReturn(loan) {
      returnRequest = null; returnNotes.value = '';
      const pending = loan.returns.filter(r => r.status === 'pending').flatMap(r => r.lines.map(line => line.lineId));
      returnLines.value = loan.lines.filter(line => line.remaining > 0 && !pending.includes(line.id)).map(line => ({ ...line, alreadyConsumed:line.consumed, good: 0, damaged: 0, consumed: 0, lost: 0 }));
      if (!returnLines.value.length) return notify('这张借用单的归还已提交，请等待管理员确认');
      modal.value = { kind: 'return', loan };
    }
    function submitReturn() { attempt(async () => {
      const lines = returnLines.value.map(l => ({ lineId: l.id, good: Number(l.good), damaged: Number(l.damaged), consumed: Number(l.consumed), lost: Number(l.lost) })).filter(l => l.good+l.damaged+l.consumed+l.lost > 0);
      if (!lines.length) throw new Error('请填写至少一项归还或核销数量');
      const payload = { loanId: modal.value.loan.id, notes: returnNotes.value, lines }, fingerprint = JSON.stringify(payload);
      if (!returnRequest || returnRequest.fingerprint !== fingerprint) returnRequest = { id: uid(), fingerprint };
      if (activeLookup.value) await api('/records/lookup', { method:'POST', body:activeLookup.value });
      const result = await api('/returns', { method: 'POST', body: { ...payload, requestId: returnRequest.id } });
      modal.value = null; returnRequest = null;
      notify(result.status === 'approved' ? '归还成功，库存和待处理数量已更新' : '已提交审核，确认后结算对应数量'); await load();
    }); }
    function resetLookup() { activeLookup.value = null; lookupCompleted.value = false; loans.value = []; }
    function confirmNormalReturn(request) { attempt(async () => {
      if (activeLookup.value) await api('/records/lookup', { method:'POST', body:activeLookup.value });
      await api('/returns/' + request.id + '/confirm-normal', { method:'POST' });
      notify('正常归还已完成，库存和待处理数量已更新'); await load();
    }); }
    function lookupBorrowings() { attempt(async () => {
      const identity = { name: lookupForm.name.trim(), phone: lookupForm.phone.trim() };
      const records = await api('/records/lookup', { method:'POST', body:identity });
      if (identity.name !== lookupForm.name.trim() || identity.phone !== lookupForm.phone.trim()) return;
      activeLookup.value = identity; lookupCompleted.value = true; loans.value = records;
      notify(records.length ? `找到 ${records.length} 张未结清借用单` : '未找到匹配的未结清记录，请核对借用时填写的姓名和手机号');
    }); }
    async function uploadPhoto(photo) {
      photo.status = 'uploading'; photo.error = '';
      const data = new FormData(); data.append('image', photo.file);
      try { const result = await api('/images', { method: 'POST', body: data }); photo.url = result.image; photo.status = 'done'; }
      catch (error) { photo.status = 'error'; photo.error = error.message; }
    }
    async function choosePhotos(event) {
      const files = [...event.target.files]; event.target.value = '';
      if (!files.length) return;
      if (photos.value.length + files.length > 6) return notify('最多添加6张图片', true);
      uploadBusy.value = true;
      try {
        for (const file of files) {
          if (file.size > 20 * 1024 * 1024) { notify('单张图片不能超过20MB', true); continue; }
          const photo = reactive({ id: uid(), file, preview: URL.createObjectURL(file), url: '', status:'uploading', error:'' });
          photos.value.push(photo); await uploadPhoto(photo);
        }
      } finally { uploadBusy.value = false; }
    }
    function retryPhoto(photo) { if (!uploadBusy.value) { uploadBusy.value = true; uploadPhoto(photo).finally(() => { uploadBusy.value = false; }); } }
    function removePhoto(photo) { URL.revokeObjectURL(photo.preview); photos.value = photos.value.filter(p => p.id !== photo.id); entryRequest = null; }
    function makeCover(index) { const [photo] = photos.value.splice(index,1); photos.value.unshift(photo); entryRequest = null; }
    function submitEntry() { attempt(async () => {
      if (uploadBusy.value || photos.value.some(p => p.status !== 'done')) throw new Error('请等待图片上传完成，失败图片可重试或删除');
      const payload = { ...entry, quantity: Number(entry.quantity), images: photos.value.map(p => p.url) }, fingerprint = JSON.stringify(payload);
      if (!entryRequest || entryRequest.fingerprint !== fingerprint) entryRequest = { id: uid(), fingerprint };
      await api(adminRoute ? '/admin/materials' : '/entries', { method: 'POST', body: { ...payload, requestId: entryRequest.id } });
      for (const photo of photos.value) URL.revokeObjectURL(photo.preview); photos.value = [];
      Object.assign(entry, { name:'', model:'', category:'活动器材', unit:'个', location:'', quantity:1, consumable:false, submitter:'', notes:'' });
      entryResult.value = true; entryRequest = null; notify(adminRoute ? '物资已正式入库' : '录入已提交，等待管理员验收入库'); await load();
    }); }
    function openReview(kind, item, decision) { Object.assign(action, { note:'', targetId:'', decision }); modal.value = { kind:'review', reviewKind:kind, item }; }
    function review() { attempt(async () => { await api(`/admin/${modal.value.reviewKind}/${modal.value.item.id}/review`, { method:'POST', body:action }); modal.value = null; notify('处理成功，库存与记录已同步'); await load(); }); }
    function openAdjust(m) { Object.assign(action, { delta:0, counted:m.quantity, requestId:uid(), note:'' }); modal.value = { kind:'adjust', item:m }; }
    function openPolicy(m) { action.percent=m.consumption_review_percent; modal.value={kind:'policy',item:m}; }
    function savePolicy() { attempt(async () => {
      await api('/admin/materials/'+modal.value.item.id+'/consumption-policy',{method:'POST',body:{percent:Number(action.percent)}});
      modal.value=null; notify('消耗审核阈值已更新，后续提交按新阈值判断'); await load();
    }); }
    function adjust() { attempt(async () => { await api(`/admin/materials/${modal.value.item.id}/stocktake`, { method:'POST', body:{ counted:Number(action.counted), expected:modal.value.item.quantity, requestId:action.requestId, reason:action.note } }); modal.value = null; notify('盘点调整已记录流水'); await load(); }); }
    function toggleMaterial(m) { attempt(async () => { await api(`/admin/materials/${m.id}/status`, { method:'POST', body:{ status:m.status === 'active' ? 'inactive' : 'active' } }); notify(m.status === 'active' ? '已停用' : '已启用'); await load(); }); }
    async function exportInventory() { await attempt(async () => { const response = await fetch('/api/v2/admin/export', { headers:headers() }); if (!response.ok) throw new Error('导出失败，请检查登录状态'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href=url; link.download='物资库存.xlsx'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }); }
    function importFile(event) { const file=event.target.files[0]; event.target.value=''; if(!file)return; attempt(async () => { const body=new FormData(); body.append('file',file); importData.value=await api('/admin/import/preview',{method:'POST',body}); modal.value={kind:'import'}; }); }
    function confirmImport() { attempt(async () => { await api('/admin/import',{method:'POST',body:{ rows:importData.value.rows,batchId:importData.value.batchId }}); modal.value=null; notify('导入入库完成'); await load(); }); }
    function showEntryRecords() { modal.value = { kind:'entryRecords' }; }
    function matchingMaterials(data) { return materials.value.filter(m => m.name===data.name && m.model===data.model && m.unit===data.unit && m.location===data.location && Number(m.consumable)===Number(data.consumable)); }
    const formatDate = value => value ? new Date(value).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}) : '—';
    const overdue = loan => loan.remaining > 0 && new Date(loan.due_at) < new Date();
    const statusText = value => STATUS[value] || value;
    const today = new Date().toLocaleDateString('zh-CN', { year:'numeric',month:'long',day:'numeric',weekday:'long' });
    function fallbackImage(event) { if (!event.target.src.endsWith('placeholder.svg')) event.target.src=EMPTY_IMAGE; }
    function closeModal() { if (!busy.value) modal.value = null; }
    return { adminRoute,canInventory,canRecords,page,loading,busy,toast,demo,materials,loans,entries,reviews,ledger,alerts,admin,query,category,type,cart,cartQuantity,modal,photos,uploadBusy,entryResult,onlyAvailable,action,importData,lookupForm,activeLookup,lookupCompleted,borrowForm,entry,returnLines,returnNotes,returnNeedsReview,categoryChoices,categories,filtered,stats,nav,title,today,
      notify,load,switchPage,addToCart,isInCart,cartItem,setCartQuantity,changeCartQuantity,startQuantityHold,endQuantityHold,quantityClick,removeCart,toggleCart,openBorrow,borrow,openReturn,submitReturn,confirmNormalReturn,resetLookup,lookupBorrowings,choosePhotos,retryPhoto,removePhoto,makeCover,submitEntry,openReview,review,openAdjust,adjust,openPolicy,savePolicy,toggleMaterial,exportInventory,importFile,confirmImport,showEntryRecords,matchingMaterials,formatDate,overdue,statusText,fallbackImage,closeModal };
  },
  template: `
  <div class="mm-app" :class="{'mm-app--embedded':embedded,'mm-app--public':!embedded}">
    <aside v-if="!embedded" class="mm-sidebar">
      <a class="mm-brand" href="/materials"><img src="/assets/jnu-cyber-security-emblem.webp" alt="学院院徽" width="42" height="42"><span>网络空间安全学院<small>团委物资管理系统</small></span></a>
      <div class="mm-sidebar-caption">{{adminRoute?'管理工作台':'物资服务'}}</div>
      <nav aria-label="主要导航"><button v-for="item in nav" :key="item[0]" :class="{active:page===item[0]}" :aria-current="page===item[0]?'page':undefined" @click="switchPage(item[0])"><MIcon :name="item[1]"/>{{item[2]}}<span v-if="item[0]==='mine' && stats.active" class="mm-nav-count">{{stats.active}}</span><span v-if="item[0]==='returns' && reviews.filter(r=>r.status==='pending').length" class="mm-nav-count">{{reviews.filter(r=>r.status==='pending').length}}</span></button></nav>
      <div class="mm-sidebar-bottom"><div class="mm-service-note"><MIcon name="shield"/><strong>{{adminRoute?'账目清楚，交接有据':'免登录，直接借用'}}</strong><p>{{adminRoute?'每次数量变化均有流水可查。':'选择需要的物资，填写信息即可借用。'}}</p></div><a :href="adminRoute?'/materials':'/admin?tab=materials-inventory'"><MIcon :name="adminRoute?'grid':'shield'"/>{{adminRoute?'返回用户端':'管理员入口'}}<MIcon name="arrow"/></a></div>
    </aside>
    <main class="mm-main">
      <header v-if="!embedded" class="mm-topbar"><div><span>团委物资</span><b>/</b><strong>{{title}}</strong></div><div class="mm-topbar-right"><a class="system-portal-link" href="/borrow"><span>设备借还</span><span aria-hidden="true">↗</span></a><span class="mm-date">{{today}}</span><span class="mm-online"><i></i>{{demo?'本地演示':'物资服务'}}</span></div></header>

      <div class="mm-content" :key="page">
        <div v-if="demo" class="mm-demo"><span>本地预览</span>当前物资为虚构演示数据，可放心体验借用、录入和归还流程。</div>
        <template v-if="page==='catalog'">
          <section class="mm-hero">
            <div class="mm-hero-copy"><span class="mm-kicker"><span class="mm-kicker-line"></span>CAMPUS SUPPLIES · 团委物资</span><h1>让好物，<br>在校园里流动。</h1><p>一次活动，一份心意。<br class="mm-mobile-break">找到需要的物资，把准备变得简单。</p><div class="mm-hero-pills"><span><MIcon name="check"/>免登录借用</span><span><MIcon name="check"/>按需取用</span><span><MIcon name="check"/>分批归还</span></div></div>
            <div class="mm-hero-art" aria-hidden="true"><div class="mm-art-orbit"></div><div class="mm-art-sheet mm-art-sheet--back"></div><div class="mm-art-sheet mm-art-sheet--front"><div class="mm-art-sheet-heading"><span>CAMPUS / 物资共享</span><MIcon name="arrow"/></div><div class="mm-art-object"><MIcon name="box"/></div><div class="mm-art-sheet-footer"><span>让每一份物资<br><strong>各尽其用。</strong></span><span class="mm-art-stamp"><MIcon name="check"/></span></div></div><div class="mm-art-tag"><span class="mm-art-tag-icon"><MIcon name="leaf"/></span><span>循环使用<small>把资源留给下一次精彩</small></span></div><div class="mm-art-spark">✳</div></div>
          </section>
          <section class="mm-stats" aria-label="物资概况"><div><span class="mm-stat-icon"><MIcon name="box"/></span><div><small>物资种类</small><strong>{{stats.types}}<em>种</em></strong></div></div><div><span class="mm-stat-icon mm-lime"><MIcon name="check"/></span><div><small>当前可借种类</small><strong>{{stats.available}}<em>种</em></strong></div></div><div><span class="mm-stat-icon mm-sand"><MIcon name="leaf"/></span><div><small>消耗品种类</small><strong>{{stats.consumable}}<em>种</em></strong></div></div></section>
          <div class="mm-section-heading"><div><span class="mm-kicker">EXPLORE THE COLLECTION</span><h2>找到你需要的物资<span class="mm-result-count">{{filtered.length}}</span></h2><p>加入借用清单，一次填写，轻松出发。</p></div><label class="mm-search"><MIcon name="search"/><input v-model="query" placeholder="搜索名称、规格或地点" aria-label="搜索物资"></label></div>
          <div class="mm-filters"><div class="mm-category"><button v-for="c in categories" :key="c" :class="{active:category===c}" :aria-pressed="category===c" @click="category=c">{{c}}</button></div><label class="mm-check"><input type="checkbox" v-model="onlyAvailable">只看可借</label></div>
          <div v-if="loading" class="mm-empty">正在读取库存…</div><div v-else-if="!filtered.length" class="mm-empty"><MIcon name="search"/><h3>暂无符合条件的物资</h3><p>试试其他关键词，或从“录入物资”提交新物资。</p></div>
          <div v-else class="mm-grid"><article class="mm-material" v-for="m in filtered" :key="m.id"><button class="mm-material-picture" @click="modal={kind:'detail',item:m}" :aria-label="'查看'+m.name"><img :src="m.images[0]||'/assets/materials/placeholder.svg'" :alt="m.name" loading="lazy" @error="fallbackImage"><span class="mm-badge" :class="m.consumable?'mm-badge-sand':'mm-badge-white'">{{m.consumable?'消耗品':'可重复使用'}}</span><span v-if="!m.quantity" class="mm-unavailable">暂时借完</span></button><div class="mm-material-info"><div class="mm-material-title"><h3>{{m.name}}</h3><span>{{m.category}}</span></div><p class="mm-model">{{m.model||'标准规格'}}</p><p class="mm-location"><MIcon name="pin"/>{{m.location}}</p><div class="mm-material-bottom"><div class="mm-stock"><small>可借</small><strong>{{m.quantity}}</strong><span>{{m.unit}}</span><small v-if="m.outstanding" class="mm-outstanding">在借 {{m.outstanding}}{{m.unit}}</small></div><button v-if="!isInCart(m.id)" type="button" class="mm-add mm-add--label" :disabled="!m.quantity" :aria-label="'将'+m.name+'加入借用清单，长按选满'" title="点击加入，长按选满" @pointerdown="startQuantityHold($event,m,1)" @pointerup="endQuantityHold($event)" @pointercancel="endQuantityHold($event)" @pointerleave="endQuantityHold($event)" @contextmenu.prevent @click="quantityClick($event,m,1)"><MIcon name="add"/><span>加入</span></button><div v-else class="mm-quantity" role="group" :aria-label="m.name+'借用数量'"><button type="button" :aria-label="Number(cartItem(m.id).quantity)<=1?'取消选择'+m.name:'减少'+m.name+'借用数量'" title="点击减少，长按取消选择" @pointerdown="startQuantityHold($event,m,-1)" @pointerup="endQuantityHold($event)" @pointercancel="endQuantityHold($event)" @pointerleave="endQuantityHold($event)" @contextmenu.prevent @click="quantityClick($event,m,-1)"><span aria-hidden="true">−</span></button><input class="mm-card-quantity-input" type="number" inputmode="numeric" min="0" :max="m.quantity" step="1" :value="cartItem(m.id).quantity" :aria-label="m.name+'借用数量，输入零取消'" @change="setCartQuantity(m,$event.target.value);$event.target.value=cartItem(m.id)?.quantity||0"><button type="button" :disabled="Number(cartItem(m.id).quantity)>=m.quantity" :aria-label="'增加'+m.name+'借用数量'" title="点击增加，长按选满" @pointerdown="startQuantityHold($event,m,1)" @pointerup="endQuantityHold($event)" @pointercancel="endQuantityHold($event)" @pointerleave="endQuantityHold($event)" @contextmenu.prevent @click="quantityClick($event,m,1)"><MIcon name="add"/></button><small class="mm-quantity-hint">长按＋选满 · 长按－取消</small></div></div></div></article></div>
        </template>
        <template v-else-if="page==='mine'">
          <div class="mm-page-heading"><div><span class="mm-kicker">MY BORROWINGS</span><h1>我的借用</h1><p>用借用时填写的姓名＋手机号查询，选择物资和数量提交归还。</p></div><button class="mm-button mm-secondary" @click="load" :disabled="loading||busy"><MIcon name="clock"/>刷新记录</button></div>
          <form class="mm-restore mm-lookup mm-panel" @submit.prevent="lookupBorrowings"><div class="mm-lookup-heading"><strong>查询未结清的借用记录</strong><p>无需登录，换手机或电脑也能查询；请填写借用时的完整信息。</p></div><label>借用人姓名<input v-model="lookupForm.name" @input="resetLookup" placeholder="借用时填写的姓名" maxlength="40" autocomplete="name" required></label><label>手机号码<input v-model="lookupForm.phone" @input="resetLookup" placeholder="借用时填写的完整手机号" maxlength="30" autocomplete="tel" inputmode="tel" required></label><button class="mm-button mm-primary" :disabled="busy||loading"><MIcon name="search"/>{{busy?'正在查询…':'查询借用记录'}}</button></form>
          <div v-if="!loans.length && !loading" class="mm-empty"><MIcon name="bag"/><h3>{{lookupCompleted?'未找到未结清的借用记录':'暂无本浏览器的借用记录'}}</h3><p>{{lookupCompleted?'请核对姓名和手机号；全部结清后，借用单不再出现在查询结果中。':'可在上方输入姓名＋手机号查询其他设备的借用，或前往物资大厅借用。'}}</p><button class="mm-button mm-primary" @click="switchPage('catalog')">去借物资<MIcon name="arrow"/></button></div>
          <article v-for="loan in loans" :key="loan.id" class="mm-loan mm-panel"><div class="mm-loan-heading"><div><strong>{{loan.purpose}}</strong><small>{{loan.id}} · {{formatDate(loan.created_at)}}</small></div><span class="mm-badge" :class="loan.remaining?(overdue(loan)?'mm-badge-red':'mm-badge-sand'):'mm-badge-green'">{{loan.remaining?(overdue(loan)?'已逾期':'借用中'):'已结清'}}</span></div><div class="mm-loan-line" v-for="line in loan.lines" :key="line.id"><img :src="line.image||'/assets/materials/placeholder.svg'" :alt="line.name" @error="fallbackImage"><div><strong>{{line.name}}</strong><small>借出 {{line.borrowed}}{{line.unit}} · 已归还 {{line.returned+line.damaged}}{{line.unit}} · 已核销 {{line.consumed+line.lost}}{{line.unit}}</small></div><span>待处理 <b>{{line.remaining}}</b>{{line.unit}}</span></div><div v-for="r in loan.returns" :key="r.id" class="mm-request-state"><span class="mm-dot" :class="r.status"></span>{{statusText(r.status)}} · {{formatDate(r.created_at)}}<span v-if="r.review_note"> · {{r.review_note}}</span><button v-if="r.status==='pending' && r.lines.every(l=>!l.consumed&&!l.damaged&&!l.lost)" class="mm-normal-confirm" :disabled="busy" @click="confirmNormalReturn(r)">按新规则确认归还</button></div><div class="mm-loan-footer"><span><MIcon name="clock"/>预计归还 {{formatDate(loan.due_at)}}</span><button v-if="loan.remaining" class="mm-button mm-primary" @click="openReturn(loan)">归还／消耗申报<MIcon name="arrow"/></button></div></article>
        </template>
        <template v-else-if="page==='entry'">
          <div class="mm-page-heading"><div><span class="mm-kicker">MATERIAL REGISTRATION</span><h1>{{adminRoute?'新增物资':'录入物资'}}</h1><p>{{adminRoute?'填写实收物资资料，提交后直接入库。':'拍照、填写资料，提交后由管理员验收入库。'}}</p></div><button v-if="!adminRoute" class="mm-button mm-secondary" @click="showEntryRecords"><MIcon name="list"/>我的录入记录</button></div>
          <div v-if="entryResult" class="mm-success-inline"><MIcon name="check"/>{{adminRoute?'物资已入库，可继续添加下一项。':'提交成功，请在“我的录入记录”查看验收结果。'}}</div>
          <form class="mm-entry-form" @submit.prevent="submitEntry"><section class="mm-panel mm-entry-main"><div class="mm-panel-title"><span>01</span><h2>物资基本信息</h2></div><div class="mm-form-grid"><label class="mm-span2">物资名称 <em>*</em><input v-model="entry.name" required maxlength="80" placeholder="例如：便携插线板"></label><label>物资分类<select v-model="entry.category"><option v-for="c in categoryChoices" :key="c">{{c}}</option></select></label><label>规格型号<input v-model="entry.model" maxlength="100" placeholder="例如：6位 / 3米"></label><label>入库数量 <em>*</em><input v-model.number="entry.quantity" type="number" min="1" max="1000000" step="1" required></label><label>计量单位 <em>*</em><input v-model="entry.unit" required maxlength="10" placeholder="个、把、卷"></label><label class="mm-span2">存放地点 <em>*</em><input v-model="entry.location" required maxlength="100" placeholder="例如：团委物资室 / A柜 / 第2层"></label><label class="mm-span2 mm-type-select"><input v-model="entry.consumable" type="checkbox"><span><strong>这是消耗品</strong><small>允许申报使用消耗，管理员确认后核销相应数量。</small></span><MIcon name="leaf"/></label><label v-if="!adminRoute" class="mm-span2">录入人姓名 <em>*</em><input v-model="entry.submitter" required maxlength="40" placeholder="方便管理员核对，无需注册账号"></label><label class="mm-span2">备注说明<textarea v-model="entry.notes" maxlength="1000" rows="3" placeholder="来源、使用注意事项或物资状况"></textarea></label></div></section><aside class="mm-entry-aside"><section class="mm-panel"><div class="mm-panel-title"><span>02</span><h2>物资图片</h2><small>{{photos.length}} / 6</small></div><div class="mm-photo-empty" v-if="!photos.length"><MIcon name="camera"/><strong>给物资拍张照片</strong><p>实物照片更方便查找和交接。</p></div><div class="mm-photo-grid" v-else><div class="mm-photo" v-for="(photo,index) in photos" :key="photo.id"><img :src="photo.preview" alt="待录入物资照片"><span v-if="index===0" class="mm-photo-cover">主图</span><button type="button" class="mm-photo-remove" :disabled="photo.status==='uploading'" @click="removePhoto(photo)" aria-label="删除照片">×</button><span v-if="photo.status==='uploading'" class="mm-photo-state">上传中…</span><div v-else-if="photo.status==='error'" class="mm-photo-state error"><span>{{photo.error}}</span><button type="button" @click="retryPhoto(photo)" :disabled="uploadBusy">重试上传</button></div><button v-else-if="index>0" type="button" class="mm-photo-set-cover" @click="makeCover(index)">设为主图</button></div></div><div class="mm-photo-actions"><label class="mm-button mm-primary" :class="{disabled:uploadBusy||photos.length>=6}"><MIcon name="camera"/>拍照上传<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" :disabled="uploadBusy||photos.length>=6" @change="choosePhotos" hidden></label><label class="mm-button mm-secondary" :class="{disabled:uploadBusy||photos.length>=6}"><MIcon name="image"/>相册／文件<input type="file" accept="image/jpeg,image/png,image/webp" multiple :disabled="uploadBusy||photos.length>=6" @change="choosePhotos" hidden></label></div><p class="mm-help">支持 JPG、PNG、WebP，单张不超过20MB。可预览、重新拍摄或删除；取消拍照会保留表单内容。</p></section><section class="mm-entry-tip"><MIcon name="shield"/><div><strong>{{adminRoute?'入库后即时可借':'提交后等待验收入库'}}</strong><p>{{adminRoute?'数量变化将记录到库存流水。':'提交录入不会直接增加可借库存，管理员确认实收后才生效。'}}</p></div></section><button class="mm-button mm-primary mm-submit-entry" :disabled="busy||uploadBusy">{{busy?'正在提交…':(adminRoute?'确认入库':'提交物资录入')}}<MIcon name="arrow"/></button></aside></form>
        </template>
        <template v-else-if="adminRoute && admin">
          <div class="mm-page-heading"><div><span class="mm-kicker">ADMINISTRATION</span><h1>{{title}}</h1><p>网络空间安全学院团委 · 管理工作台</p></div><div class="mm-admin-actions"><button class="mm-button mm-secondary" @click="load" :disabled="loading||busy"><MIcon name="clock"/>刷新</button><button v-if="canInventory" class="mm-button mm-primary" @click="switchPage('entry')"><MIcon name="add"/>新增物资</button></div></div>
          <section class="mm-stats mm-admin-stats"><div v-if="canInventory"><span class="mm-stat-icon"><MIcon name="box"/></span><div><small>物资种类</small><strong>{{stats.types}}<em>种</em></strong></div></div><div v-if="canRecords"><span class="mm-stat-icon mm-sand"><MIcon name="bag"/></span><div><small>未结清借用</small><strong>{{stats.active}}<em>单</em></strong></div></div><div><span class="mm-stat-icon mm-lime"><MIcon name="clock"/></span><div><small>待处理审核</small><strong>{{stats.pending}}<em>项</em></strong></div></div></section>
          <template v-if="page==='inventory'"><div class="mm-table-toolbar"><label class="mm-search"><MIcon name="search"/><input v-model="query" placeholder="搜索物资或存放地点"></label><div><label class="mm-button mm-secondary"><MIcon name="upload"/>导入<input type="file" accept=".xlsx" hidden @change="importFile" :disabled="busy"></label><button class="mm-button mm-secondary" @click="exportInventory" :disabled="busy"><MIcon name="download"/>导出库存</button></div></div><div class="mm-table-wrap mm-panel"><table class="mm-table"><thead><tr><th>物资名称</th><th>存放地点</th><th>可借</th><th>在借</th><th>隔离</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="m in filtered" :key="m.id"><td><div class="mm-table-item"><img :src="m.images[0]||'/assets/materials/placeholder.svg'" alt="" @error="fallbackImage"><div><strong>{{m.name}}</strong><small>{{m.model}} · {{m.consumable?'消耗品':m.category}}</small></div></div></td><td>{{m.location}}</td><td><b>{{m.quantity}}</b> {{m.unit}}</td><td>{{m.outstanding}} {{m.unit}}</td><td>{{m.quarantine}} {{m.unit}}</td><td><span class="mm-badge" :class="m.status==='active'?'mm-badge-green':'mm-badge-sand'">{{m.status==='active'?'启用':'停用'}}</span></td><td class="mm-table-actions"><button @click="openAdjust(m)">盘点调整</button><button v-if="m.consumable" @click="openPolicy(m)">审核阈值</button><button @click="toggleMaterial(m)" :disabled="busy">{{m.status==='active'?'停用':'启用'}}</button></td></tr><tr v-if="!filtered.length"><td colspan="7" class="mm-empty">暂无物资</td></tr></tbody></table></div></template>
          <template v-else-if="page==='loans'"><aside v-if="alerts.length" class="mm-info-note" role="status"><div><strong>累计消耗提醒（最多显示最近100条）</strong><p v-for="a in alerts" :key="a.line_id">{{a.name}}：累计消耗 {{a.consumed}} / 原借出 {{a.borrowed}}{{a.unit}}，超过 {{a.threshold}}%。借用单 {{a.loan_id}}</p><small>仅作核对提示，单次消耗审核规则不变。</small></div></aside><div class="mm-table-wrap mm-panel"><table class="mm-table"><thead><tr><th>借用单／用途</th><th>借用人</th><th>物资明细</th><th>预计归还</th><th>状态</th></tr></thead><tbody><tr v-for="loan in loans" :key="loan.id"><td><strong>{{loan.purpose}}</strong><small>{{loan.id}}<br>{{formatDate(loan.created_at)}}</small></td><td>{{loan.name}}<small>{{loan.phone}}<br>{{loan.organization}}</small></td><td><div v-for="line in loan.lines" :key="line.id" class="mm-cell-line">{{line.name}} <b>{{line.borrowed}}{{line.unit}}</b><small>待处理 {{line.remaining}}{{line.unit}}</small></div></td><td>{{formatDate(loan.due_at)}}</td><td><span class="mm-badge" :class="loan.remaining?(overdue(loan)?'mm-badge-red':'mm-badge-sand'):'mm-badge-green'">{{loan.remaining?(overdue(loan)?'逾期':'借用中'):'已结清'}}</span></td></tr><tr v-if="!loans.length"><td colspan="5" class="mm-empty">尚无借用记录</td></tr></tbody></table></div></template>
          <template v-else-if="page==='returns'"><div v-if="!reviews.length" class="mm-empty"><MIcon name="check"/><h3>暂无归还或核销申请</h3><p>用户提交后，会在这里显示。</p></div><article v-for="r in reviews" :key="r.id" class="mm-review-card mm-panel"><div class="mm-loan-heading"><div><strong>{{r.name}} · {{r.organization}}</strong><small>{{r.loan_id}} · {{formatDate(r.created_at)}}</small></div><span class="mm-badge" :class="r.status==='pending'?'mm-badge-sand':(r.status==='approved'?'mm-badge-green':'mm-badge-red')">{{statusText(r.status)}}</span></div><div class="mm-review-lines" v-for="l in r.lines" :key="l.lineId"><strong>{{l.name}}</strong><span>完好归还 <b>{{l.good}}</b>{{l.unit}}</span><span>破损 <b>{{l.damaged}}</b>{{l.unit}}</span><span>消耗 <b>{{l.consumed}}</b>{{l.unit}}</span><span>异常核销 <b>{{l.lost}}</b>{{l.unit}}</span><small v-if="l.reviewReason">{{l.reviewReason}}</small></div><p v-if="r.notes" class="mm-note">情况说明：{{r.notes}}</p><p v-if="r.review_note" class="mm-note">审核意见：{{r.review_note}}</p><div v-if="r.status==='pending'" class="mm-review-actions"><button class="mm-button mm-secondary" @click="openReview('returns',r,'rejected')">驳回并说明</button><button class="mm-button mm-primary" @click="openReview('returns',r,'approved')"><MIcon name="check"/>确认验收／核销</button></div></article></template>
          <template v-else-if="page==='entries'"><div v-if="!entries.length" class="mm-empty"><MIcon name="add"/><h3>暂无物资录入申请</h3><p>用户拍照录入后，会在这里显示。</p></div><article v-for="e in entries" :key="e.id" class="mm-review-card mm-panel"><div class="mm-loan-heading"><div><strong>{{e.data.name}} <span class="mm-muted">× {{e.data.quantity}}{{e.data.unit}}</span></strong><small>{{e.submitter}}提交 · {{formatDate(e.created_at)}}</small></div><span class="mm-badge" :class="e.status==='pending'?'mm-badge-sand':(e.status==='approved'?'mm-badge-green':'mm-badge-red')">{{statusText(e.status)}}</span></div><p>{{e.data.category}} · {{e.data.model||'标准规格'}} · {{e.data.consumable?'消耗品':'可重复使用'}}</p><p class="mm-location"><MIcon name="pin"/>{{e.data.location}}</p><div v-if="e.data.images.length" class="mm-review-photos"><a v-for="image in e.data.images" :key="image" :href="image" target="_blank" rel="noopener"><img :src="image" alt="物资录入照片" @error="fallbackImage"></a></div><p v-if="e.data.notes" class="mm-note">{{e.data.notes}}</p><p v-if="e.review_note" class="mm-note">审核意见：{{e.review_note}}</p><div v-if="e.status==='pending'" class="mm-review-actions"><button class="mm-button mm-secondary" @click="openReview('entries',e,'rejected')">驳回并说明</button><button class="mm-button mm-primary" @click="openReview('entries',e,'approved')"><MIcon name="check"/>确认入库</button></div></article></template>
          <template v-else-if="page==='ledger'"><div class="mm-table-wrap mm-panel"><table class="mm-table"><thead><tr><th>时间</th><th>物资／动作</th><th>可借变化</th><th>在借变化</th><th>隔离变化</th><th>可借结余</th><th>说明</th></tr></thead><tbody><tr v-for="l in ledger" :key="l.id"><td>{{formatDate(l.created_at)}}</td><td><strong>{{l.name}}</strong><small>{{l.type}}</small></td><td :class="l.delta>0?'mm-positive':''">{{l.delta>0?'+':''}}{{l.delta}}{{l.unit}}</td><td>{{l.outstanding_delta>0?'+':''}}{{l.outstanding_delta}}{{l.unit}}</td><td>{{l.quarantine_delta>0?'+':''}}{{l.quarantine_delta}}{{l.unit}}</td><td><b>{{l.balance}}</b>{{l.unit}}</td><td><small>{{l.note||'—'}}<br>单据 {{l.reference}}</small></td></tr><tr v-if="!ledger.length"><td colspan="7" class="mm-empty">暂无库存流水</td></tr></tbody></table></div></template>
        </template>
        <footer v-if="!embedded" class="mm-footer"><span>网络空间安全学院团委</span><span>按需借用 · 及时归还 · 共同维护</span></footer>
      </div>
    </main>
    <div class="mm-cart-bar" v-if="!adminRoute && cart.length && page==='catalog'"><span class="mm-cart-icon"><MIcon name="bag"/><b>{{cart.length}}</b></span><div><strong>已选 {{cart.length}} 种 · 数量合计 {{cartQuantity}}</strong><small>确认数量，填写信息即可借用</small></div><button class="mm-button mm-primary" @click="openBorrow">查看清单并借用<MIcon name="arrow"/></button></div>
    <Transition name="mm-toast"><div class="mm-toast-message" v-if="toast" :class="{error:toast.error}" role="status"><MIcon :name="toast.error?'clock':'check'"/>{{toast.message}}</div></Transition>
    <div v-if="modal" class="mm-overlay" @click.self="closeModal" @keydown.esc="closeModal"><section class="mm-modal" role="dialog" aria-modal="true" :aria-label="{borrow:'确认借用',return:'归还与消耗申报',detail:'物资详情',review:'确认处理',adjust:'盘点调整',success:'借用成功',entryRecords:'我的录入记录',import:'导入预览'}[modal.kind] || '消耗审核阈值'" :class="{'mm-modal-wide':['borrow','return','import','entryRecords'].includes(modal.kind)}"><button class="mm-modal-close" @click="closeModal" :disabled="busy" aria-label="关闭"><MIcon name="close"/></button>
      <template v-if="modal.kind==='borrow'"><span class="mm-kicker">BORROW MATERIALS</span><h2>确认借用</h2><p class="mm-modal-subtitle">无需审批，提交成功即记录借出。</p><form @submit.prevent="borrow"><div class="mm-cart-lines"><div class="mm-cart-line" v-for="item in cart" :key="item.materialId"><img :src="item.image" alt="" @error="fallbackImage"><div><strong>{{item.name}}</strong><small>{{item.location}}</small></div><input type="number" v-model.number="item.quantity" min="1" :max="item.max" step="1" required :aria-label="item.name+'借用数量'"><span>{{item.unit}}</span><button type="button" @click="removeCart(item.materialId)" aria-label="移除物资"><MIcon name="close"/></button></div></div><div class="mm-form-grid"><label>姓名 <em>*</em><input v-model="borrowForm.name" required maxlength="40" autocomplete="name" placeholder="借用人姓名"></label><label>手机号码 <em>*</em><input v-model="borrowForm.phone" required maxlength="30" autocomplete="tel" inputmode="tel" placeholder="用于联系及查询借用记录"></label><label>所属组织／专业 <em>*</em><input v-model="borrowForm.organization" required maxlength="80" placeholder="例如：团委组织部"></label><label>预计归还日期 <em>*</em><input v-model="borrowForm.dueDate" type="date" required></label><label class="mm-span2">活动／借用用途 <em>*</em><textarea v-model="borrowForm.purpose" required maxlength="300" rows="2" placeholder="例如：学院迎新活动"></textarea></label></div><div class="mm-modal-footer"><span><MIcon name="shield"/>无需注册或登录</span><button class="mm-button mm-primary" :disabled="busy||!cart.length">{{busy?'正在提交…':'确认借用'}}<MIcon name="arrow"/></button></div></form></template>
      <template v-else-if="modal.kind==='success'"><div class="mm-success-symbol"><MIcon name="check"/></div><h2>借用成功</h2><p class="mm-modal-subtitle">已登记借出，请按对应存放地点取用并按时归还。</p><div class="mm-receipt"><small>借用单号</small><strong>{{modal.id}}</strong></div><p class="mm-help">归还时进入“我的借用”，填写本次借用的姓名和手机号即可查询，无需保存或输入额外凭证。</p><button class="mm-button mm-primary mm-full" @click="modal=null;switchPage('mine')">查看我的借用<MIcon name="arrow"/></button></template>
      <template v-else-if="modal.kind==='return'"><span class="mm-kicker">RETURN & SETTLEMENT</span><h2>归还与消耗申报</h2><p class="mm-modal-subtitle">可以只归还一部分。消耗品全部用完，也可仅填写消耗量。</p><form @submit.prevent="submitReturn"><div class="mm-return-line" v-for="line in returnLines" :key="line.id"><div class="mm-return-line-title"><strong>{{line.name}}</strong><span>待处理 {{line.remaining}}{{line.unit}}</span></div><div class="mm-return-inputs"><label>完好归还<input type="number" v-model.number="line.good" min="0" :max="line.remaining" step="1" required></label><label>破损归还<input type="number" v-model.number="line.damaged" min="0" :max="line.remaining" step="1" required></label><label v-if="line.consumable">实际消耗<input type="number" v-model.number="line.consumed" min="0" :max="line.remaining" step="1" required></label><label>异常核销<input type="number" v-model.number="line.lost" min="0" :max="line.remaining" step="1" required></label></div><p class="mm-help">本次申报合计 {{Number(line.good)+Number(line.damaged)+Number(line.consumed)+Number(line.lost)}}{{line.unit}}，不能超过待处理量；完成后仍待处理 {{Math.max(0,line.remaining-Number(line.good)-Number(line.damaged)-Number(line.consumed)-Number(line.lost))}}{{line.unit}}。</p><p v-if="line.consumable" class="mm-help">本次消耗 {{Number(line.consumed)}} / 原借出 {{line.borrowed}}{{line.unit}}；自动核销上限 {{line.consumption_review_percent}}%，超过后需确认。</p></div><label>情况说明<textarea v-model="returnNotes" maxlength="1000" rows="3" placeholder="有消耗、破损或遗失时，请说明活动使用情况或原因"></textarea></label><div class="mm-info-note"><MIcon name="clock"/>{{returnNeedsReview?'本次消耗超出阈值或含破损、遗失，将交管理员确认；你也可以先单独提交正常归还。':'正常归还与阈值内消耗，提交后即时结算，无需管理员确认。'}}</div><button class="mm-button mm-primary mm-full" :disabled="busy">{{busy?'正在提交…':(returnNeedsReview?'提交管理员确认':'确认归还并结算')}}</button></form></template>
      <template v-else-if="modal.kind==='detail'"><img class="mm-detail-image" :src="modal.item.images[0]||'/assets/materials/placeholder.svg'" :alt="modal.item.name" @error="fallbackImage"><span class="mm-kicker">{{modal.item.category}}</span><h2>{{modal.item.name}}</h2><p>{{modal.item.model}}</p><div class="mm-detail-meta"><span><MIcon name="pin"/>{{modal.item.location}}</span><span>可借 <b>{{modal.item.quantity}}</b>{{modal.item.unit}}</span><span>{{modal.item.consumable?'消耗品，可归还剩余并申报消耗':'可重复使用，请保持完好归还'}}</span></div><p class="mm-note">{{modal.item.notes||'暂无补充说明'}}</p><div class="mm-review-photos" v-if="modal.item.images.length>1"><a v-for="image in modal.item.images" :key="image" :href="image" target="_blank" rel="noopener"><img :src="image" alt="物资照片" @error="fallbackImage"></a></div><button v-if="!adminRoute" type="button" class="mm-button mm-primary mm-full" :disabled="!modal.item.quantity && !isInCart(modal.item.id)" :aria-pressed="isInCart(modal.item.id)" @click="toggleCart(modal.item);modal=null"><MIcon :name="isInCart(modal.item.id)?'check':'add'"/>{{isInCart(modal.item.id)?'取消选择':'加入借用清单'}}</button></template>
      <template v-else-if="modal.kind==='review'"><span class="mm-kicker">REVIEW</span><h2>{{action.decision==='approved'?(modal.reviewKind==='entries'?'确认物资入库':'确认归还与核销'):'驳回申请'}}</h2><p class="mm-modal-subtitle">{{action.decision==='approved'?'请核实实收数量及申报情况，确认后会更新库存和流水。':'填写具体原因，方便提交者核对后重新提交。'}}</p><form @submit.prevent="review"><label v-if="modal.reviewKind==='entries' && action.decision==='approved'">入库方式<select v-model="action.targetId"><option value="">新建物资档案</option><option v-for="m in matchingMaterials(modal.item.data)" :key="m.id" :value="m.id">补充到已有档案：{{m.name}}（当前{{m.quantity}}{{m.unit}}）</option></select></label><label>审核意见{{action.decision==='rejected'?' *':''}}<textarea v-model="action.note" :required="action.decision==='rejected'" maxlength="1000" rows="3" placeholder="填写核对说明"></textarea></label><button class="mm-button mm-primary mm-full" :disabled="busy">{{busy?'正在处理…':'确认处理'}}</button></form></template>
      <template v-else-if="modal.kind==='adjust'"><span class="mm-kicker">STOCKTAKING</span><h2>盘点调整</h2><p class="mm-modal-subtitle">{{modal.item.name}} · 当前可借 {{modal.item.quantity}}{{modal.item.unit}}</p><form @submit.prevent="adjust"><label>实盘完好在库数量<input type="number" v-model.number="action.counted" min="0" max="1000000" step="1" required placeholder="填写现场清点的完好在库数量"></label><label>调整原因 *<textarea v-model="action.note" required maxlength="300" rows="3" placeholder="说明盘点差异或补录原因"></textarea></label><p class="mm-help">账面 {{modal.item.quantity}}，实盘 {{action.counted}}，差异 {{Number(action.counted)-modal.item.quantity}}。仅核对完好在库物资，不包含在借和损坏隔离数量；库存变化时请刷新后重新盘点。</p><button class="mm-button mm-primary mm-full" :disabled="busy">确认调整并记录流水</button></form></template>
      <template v-else-if="modal.kind==='entryRecords'"><span class="mm-kicker">MY REGISTRATIONS</span><h2>我的录入记录</h2><p class="mm-modal-subtitle">显示当前浏览器提交的物资。</p><div v-if="!entries.length" class="mm-empty">还没有录入记录</div><article v-for="e in entries" :key="e.id" class="mm-entry-record"><div><strong>{{e.data.name}} × {{e.data.quantity}}{{e.data.unit}}</strong><small>{{e.data.location}} · {{formatDate(e.created_at)}}</small><p v-if="e.review_note">{{e.review_note}}</p></div><span class="mm-badge" :class="e.status==='pending'?'mm-badge-sand':(e.status==='approved'?'mm-badge-green':'mm-badge-red')">{{statusText(e.status)}}</span></article></template>
      <template v-else-if="modal.kind==='import'"><span class="mm-kicker">IMPORT PREVIEW</span><h2>导入预览</h2><p class="mm-modal-subtitle">{{importData.warning}}</p><div v-if="importData.errors.length" class="mm-import-errors"><p v-for="error in importData.errors" :key="error">{{error}}</p></div><div class="mm-table-wrap"><table class="mm-table"><thead><tr><th>名称</th><th>规格／单位</th><th>地点</th><th>入库量</th></tr></thead><tbody><tr v-for="(row,index) in importData.rows" :key="index"><td>{{row.name}}</td><td>{{row.model}} / {{row.unit}}</td><td>{{row.location}}</td><td>{{row.quantity}}</td></tr></tbody></table></div><button class="mm-button mm-primary mm-full" :disabled="busy||importData.errors.length>0||!importData.rows.length" @click="confirmImport">确认导入 {{importData.rows.length}} 条物资</button></template>
      <template v-else-if="modal.kind==='policy'"><span class="mm-kicker">CONSUMPTION POLICY</span><h2>消耗审核阈值</h2><p class="mm-modal-subtitle">{{modal.item.name}} · 按本次申报消耗量占原借出数量的比例计算</p><form @submit.prevent="savePolicy"><label>自动核销上限（%）<input type="number" v-model.number="action.percent" min="0" max="100" step="1" required></label><p class="mm-help">单次消耗等于或低于该比例时自动结算，超过阈值才提交管理员确认。0%表示所有消耗都审核，100%表示允许有效数量内的全部消耗。更改后对后续提交生效，不自动处理历史待审核记录。</p><button class="mm-button mm-primary mm-full" :disabled="busy">保存审核阈值</button></form></template>
    </section></div>
  </div>`
};
