// 图片选区展示契约：编辑器保存的比例与位置必须进入借用卡片和详情页。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(
  path.resolve(__dirname, '../frontend/src/main.js'),
  'utf8'
);
const documentSource = fs.readFileSync(
  path.resolve(__dirname, '../frontend/index.html'),
  'utf8'
);

const borrowPageSource = source.slice(
  source.indexOf('const BorrowPage'),
  source.indexOf('const AdminPage')
);

test('unified portal uses the public available list and shared device-status detail', () => {
  assert.match(borrowPageSource, /\/api\/devices\/available/);
  assert.match(borrowPageSource, /\/api\/devices\/' \+ deviceId \+ '\/status'/);
  assert.doesNotMatch(borrowPageSource, /\/api\/records\/active/);
  assert.match(borrowPageSource, /currentBorrower/);
  assert.doesNotMatch(borrowPageSource, /activeRecord\?\.borrowerId/);
  assert.doesNotMatch(borrowPageSource, /activeRecord\?\.notes/);
});

test('administrator UI exposes archive lifecycle actions', () => {
  assert.match(source, /archiveRecord/);
  assert.match(source, /restoreRecord/);
  assert.match(source, /deleteRecordPermanently/);
  assert.match(source, /archivedRecords/);
  assert.match(source, /key: 'archived'/);
});

test('administrator history views retain complete borrower details', () => {
  const historySource = source.slice(
    source.indexOf('<!-- 全部记录 -->'),
    source.indexOf('<!-- 添加/编辑设备弹窗 -->')
  );

  assert.match(historySource, /rec\.borrowerId/);
  assert.match(historySource, /rec\.borrowerPhone/);
  assert.match(historySource, /rec\.major/);
  assert.match(historySource, /rec\.purpose/);
});

test('device image picker advertises only safe raster formats', () => {
  assert.match(source, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.doesNotMatch(source, /accept="image\/\*"/);
});

// 图片上传契约：客户端提前拦截超过 20 MB 的文件，减少无效网络传输。
test('device image picker rejects files larger than 20 MB before upload', () => {
  assert.match(source, /MAX_IMAGE_UPLOAD_BYTES\s*=\s*20\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /file\.size\s*>\s*MAX_IMAGE_UPLOAD_BYTES/);
  assert.match(source, /图片不能超过 20 MB/);
});

// 编辑设备契约：已有图片也必须提供明确的替换入口。
test('administrator can explicitly replace an existing device image', () => {
  assert.match(source, /image-crop-editor__replace/);
  assert.match(source, /更换图片/);
  assert.match(source, /@click\.stop="triggerUpload"/);
});

// 构建契约：ExcelJS 只在管理端工作簿操作发生时动态加载。
test('ExcelJS is dynamically loaded instead of entering the initial bundle', () => {
  assert.doesNotMatch(source, /import\s+ExcelJS\s+from\s+['"]exceljs['"]/);
  assert.match(source, /import\(['"]exceljs['"]\)/);
});

test('return page queries by exact name and full phone before returning', () => {
  assert.match(borrowPageSource, /returnLookup\.borrowerName/);
  assert.match(borrowPageSource, /returnLookup\.borrowerPhone/);
  assert.match(borrowPageSource, /完整手机号/);
  assert.match(borrowPageSource, /\/api\/records\/return-lookup/);
  assert.match(borrowPageSource, /returnToken/);
  assert.match(borrowPageSource, /\/api\/records\/return/);
});

test('borrowing form requires professional major and purpose fields', () => {
  assert.match(borrowPageSource, /form\.major/);
  assert.match(borrowPageSource, /form\.purpose/);
  assert.match(borrowPageSource, /专业/);
  assert.match(borrowPageSource, /用途/);
  assert.match(borrowPageSource, /placeholder="如：网络空间安全"/);
  assert.doesNotMatch(borrowPageSource, /数字媒体技术/);
  assert.doesNotMatch(borrowPageSource, /院系 \/ 实验室/);
});

test('public and administrator pages identify the JNU Cyber Security School', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');

  assert.match(borrowPageSource, /portal-affiliation[^>]*>暨南大学网络空间安全学院</);
  assert.match(borrowPageSource, /page-footer[^>]*>[\s\S]*?暨南大学网络空间安全学院 · 设备借还系统</);
  assert.match(source, /nav-affiliation[^>]*>暨南大学网络空间安全学院</);
  assert.match(source, /login-subtitle[^>]*>暨南大学网络空间安全学院</);
  assert.match(source, /admin-footer[^>]*>[\s\S]*?暨南大学网络空间安全学院 · 设备管理系统</);
  assert.match(source, /redirect-affiliation[^>]*>暨南大学网络空间安全学院</);
  assert.match(document, /<title>暨南大学网络空间安全学院 · 设备管理系统<\/title>/);
});

// ICP备案号与运行时长合并为底栏元信息行，备案号仍链接到工信部备案官网。
test('public and administrator footers expose the service ICP filing number', () => {
  const filingMeta = source.match(/class="page-footer__meta"/g) || [];
  const filingLinks = source.match(/href="https:\/\/beian\.miit\.gov\.cn\/"/g) || [];
  const filingSeparators = source.match(/class="page-footer__meta-separator"/g) || [];
  assert.equal(filingMeta.length, 2);
  assert.equal(filingLinks.length, 2);
  assert.equal(filingSeparators.length, 2);
  assert.equal((source.match(/豫ICP备2026040615号-1/g) || []).length, 2);
  assert.match(source, /page-footer__filing-link[\s\S]*?page-footer__meta-separator[\s\S]*?page-footer__runtime/);
  assert.doesNotMatch(source, /class="page-footer__filing"/);

  assert.match(documentSource, /\.page-footer__meta\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/s);
  assert.match(documentSource, /\.page-footer__meta-separator\s*\{/);
  assert.match(documentSource, /\.page-footer__filing-link\s*\{/);
  assert.match(documentSource, /page-footer__filing-link:hover[\s\S]*?page-footer__filing-link:focus-visible/);
});

test('college emblem is placed in the public header, administrator navigation and login card', () => {
  assert.match(borrowPageSource, /class="portal-emblem"[^>]*src="\/assets\/jnu-cyber-security-emblem\.png"[^>]*width="52"[^>]*height="52"/);
  assert.match(source, /class="nav-emblem"[^>]*src="\/assets\/jnu-cyber-security-emblem\.png"[^>]*width="38"[^>]*height="38"/);
  assert.match(source, /class="login-emblem"[^>]*src="\/assets\/jnu-cyber-security-emblem\.png"[^>]*width="88"[^>]*height="88"/);
  assert.match(source, /alt="暨南大学网络空间安全学院院徽"/);
});

test('frontend theme uses the emblem cyan palette without replacing device status colors', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');

  assert.match(document, /--brand:\s*#0080a0/i);
  assert.match(document, /--brand-bright:\s*#00a0b0/i);
  assert.match(document, /--brand-soft:/i);
  assert.doesNotMatch(document, /--amber:/i);
  assert.match(document, /--moss:/i);
  assert.match(document, /--clay:/i);
});

test('frontend source no longer bundles the obsolete single-device borrowing component', () => {
  assert.doesNotMatch(source, /const LegacyBorrowPage/);
  assert.doesNotMatch(source, /原借用人手机号后四位/);
  assert.doesNotMatch(source, /院系 \/ 实验室/);
});

test('unified portal exposes borrow and return navigation and preserves old device links', () => {
  assert.match(borrowPageSource, /借设备/);
  assert.match(borrowPageSource, /还设备/);
  assert.match(borrowPageSource, /new URLSearchParams\(window\.location\.search\)\.get\('id'\)/);
  assert.match(borrowPageSource, /history\.pushState/);
});

// 瀑布流使用显式响应式列，避免列高平衡把少量设备全部推到第一列。
test('portal waterfall distributes devices across responsive columns', () => {
  assert.match(source, /const waterfallColumnCount = Vue\.ref\(getWaterfallColumnCount\(\)\)/);
  assert.match(source, /const deviceColumns = Vue\.computed\(\(\) =>/);
  assert.match(source, /columnIndex = index % columnCount/);
  assert.match(source, /class="portal-device-list__column"/);
  assert.match(source, /v-for="column in deviceColumns"/);

  assert.match(documentSource, /\.portal-device-list--waterfall\s*\{[^}]*display:\s*flex/s);
  assert.match(documentSource, /\.portal-device-list__column\s*\{[^}]*display:\s*flex/s);
  assert.doesNotMatch(documentSource, /\.portal-device-list--waterfall\s*\{[^}]*column-count:/s);
});

test('borrow page renders the public device image with a fallback', () => {
  assert.match(borrowPageSource, /device\.image/);
  assert.match(borrowPageSource, /portal-detail__media/);
  assert.match(borrowPageSource, /portal-image-placeholder/);
  assert.match(borrowPageSource, /markImageFailed/);
});

// PC 详情恢复普通文档流，返回时不做向上离场并恢复进入前的滚动位置。
test('desktop portal detail restores the original layout without an upward leave animation', () => {
  const desktopStyles = documentSource.slice(
    documentSource.indexOf('@media (min-width: 561px)'),
    documentSource.indexOf('@media (max-width: 700px)')
  );
  assert.match(borrowPageSource, /detailScrollY/);
  assert.match(borrowPageSource, /detailScrollY\.value = window\.scrollY/);
  assert.match(borrowPageSource, /window\.scrollTo\(\{ top: savedDetailScrollY/);
  assert.match(borrowPageSource, /!isMobileDetailLayout\(\)[\s\S]*window\.scrollTo\(\{ top: 0, behavior: 'auto' \}\)/);
  assert.match(desktopStyles, /\.portal-detail-view\s*\{[^}]*position:\s*static/s);
  assert.match(desktopStyles, /\.portal-device-list-view--covered\s*\{[^}]*display:\s*none/s);
  assert.match(borrowPageSource, /'portal-page--feed':\s*activeMode === 'borrow'\s*,/);
  assert.match(desktopStyles, /\.portal-detail-slide-leave-active\s*\{[^}]*transition:\s*none/s);
  assert.match(desktopStyles, /\.portal-detail-slide-leave-to\s*\{[^}]*transform:\s*none[^}]*opacity:\s*1/s);
  assert.doesNotMatch(documentSource, /portal-detail-slide-leave-to\s*\{[^}]*translateY\(-/);
});

test('image loading strategy prioritizes the scan page and lazy-loads admin lists', () => {
  assert.match(borrowPageSource, /loading="eager"/);
  assert.match(borrowPageSource, /fetchpriority="high"/);
  assert.match(source, /<img v-if="hasAdminImage\(dev\)"[^>]*loading="lazy"/);
  assert.match(source, /decoding="async"/);
});

test('images use a fixed-color blurred fade-in placeholder without shimmer', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /hasAdminImage\(dev\)/);
  assert.match(source, /markAdminImageLoaded\(adminImageSource\(dev\)\)/);
  assert.match(document, /\.portal-device-row__media\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.portal-detail__media\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.portal-return-card__media\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.device-card-img\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.portal-image-placeholder\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.borrow-device-image-placeholder\s*\{[^}]*background:\s*#f0ece4[^}]*\}/s);
  assert.match(document, /\.portal-media-image\s*\{[^}]*opacity:\s*0[^}]*filter:\s*blur\(15px\)[^}]*transform:\s*scale\(1\.03\)[^}]*transition:\s*opacity \.3s ease, filter \.6s ease, transform \.6s ease/s);
  assert.match(document, /\.portal-media-image\.is-loaded\s*\{[^}]*opacity:\s*1[^}]*filter:\s*blur\(0\)[^}]*transform:\s*scale\(1\)/s);
  assert.match(document, /\.device-card-img img\s*\{[^}]*opacity:\s*0[^}]*filter:\s*blur\(15px\)[^}]*transform:\s*scale\(1\.03\)[^}]*transition:\s*opacity \.3s ease, filter \.6s ease, transform \.6s ease/s);
  assert.doesNotMatch(document, /image-shimmer|animation:\s*image-shimmer/);
});

test('available devices render as a responsive waterfall using optimized thumbnails', () => {
  assert.match(borrowPageSource, /portal-page--feed/);
  assert.match(borrowPageSource, /portal-device-list--waterfall/);
  assert.match(borrowPageSource, /entry\.item\.imageThumb \|\| entry\.item\.image/);
  assert.match(borrowPageSource, /imageDisplayAspectRatio\(entry\.item\)/);
  assert.match(borrowPageSource, /markImageLoaded\(entry\.item\.imageThumb \|\| entry\.item\.image, \$event\)/);
  assert.match(borrowPageSource, /imageRatios/);
  assert.match(borrowPageSource, /naturalWidth/);
  assert.match(borrowPageSource, /entry\.index < 2 \? 'eager' : 'lazy'/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.portal-device-list--waterfall\s*\{[^}]*display:\s*flex/s);
  assert.match(document, /\.portal-device-list__column\s*\{[^}]*flex-direction:\s*column/s);
  assert.doesNotMatch(document, /\.portal-device-list--waterfall\s*\{[^}]*column-count:/s);
  assert.doesNotMatch(document, /break-inside:\s*avoid/);
});

test('available device cards apply the saved display aspect ratio and vertical position', () => {
  assert.match(borrowPageSource, /imageDisplayAspectRatio\(entry\.item\)/);
  assert.match(borrowPageSource, /imageDisplayPositionY\(entry\.item\)/);
  assert.match(borrowPageSource, /aspectRatio:\s*imageDisplayAspectRatio\(entry\.item\)/);
  assert.match(borrowPageSource, /objectPosition:\s*'50% '\s*\+\s*imageDisplayPositionY\(entry\.item\)\s*\+\s*'%'/);
});

test('portal count follows the filtered device list and animates count changes', () => {
  assert.match(borrowPageSource, /:key="filteredDevices\.length" class="portal-count"/);
  assert.match(borrowPageSource, /<transition name="portal-count" mode="out-in">/);
  assert.match(borrowPageSource, /\{\{ filteredDevices\.length \}\} 台/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.portal-count-enter-active[^}]*transition:/s);
});

test('device detail applies the saved display ratio and vertical position', () => {
  assert.match(borrowPageSource, /<div class="portal-detail__media"[^>]*:style="detailMediaStyle\(device\)"/);
  assert.match(borrowPageSource, /detailImageAspectRatio\(device\)/);
  assert.match(borrowPageSource, /detailMediaStyle\(item\)/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.portal-detail__media\s*\{[^}]*width:\s*100%[^}]*display:\s*flex/s);
  assert.match(document, /\.portal-detail__media\s*\{[^}]*justify-content:\s*center/s);
  assert.match(document, /\.portal-detail__media--fixed\s*\{[^}]*aspect-ratio:\s*var\(--detail-media-aspect-ratio/s);
  assert.match(document, /object-position:\s*50% var\(--detail-media-position-y, 50%\)/);
});

test('administrator UI exposes active-record edit and force-return actions', () => {
  assert.match(source, /editActiveRecord/);
  assert.match(source, /forceReturnRecord/);
  assert.match(source, /\/api\/records\/.*force-return/);
});

test('offline confirmation happens before the optional reason prompt', () => {
  const toggleSource = source.slice(
    source.indexOf('async function toggleOperationalStatus'),
    source.indexOf('async function generatePortalQR')
  );
  assert.ok(toggleSource.indexOf('confirm(`确定将') < toggleSource.indexOf('prompt('));
});

test('administrator device deletion asks before cascading borrowing records', () => {
  assert.match(source, /deleteRecords=true/);
  assert.match(source, /借用记录/);
});

test('administrator manages operational status and the unified portal QR code', () => {
  assert.match(source, /operationalStatus/);
  assert.match(source, /offlineReason/);
  assert.match(source, /\/operational-status/);
  assert.match(source, /\/api\/qrcode\/portal/);
  assert.match(source, /统一二维码/);
});

// 批量下线使用设备选择、统一原因和管理员保护的整批接口。
test('administrator can select devices for atomic batch offline', () => {
  assert.match(source, /selectedDeviceIds/);
  assert.match(source, /toggleDeviceSelection/);
  assert.match(source, /batch-operational-status/);
  assert.match(source, /batchOfflineReason/);
  assert.match(source, /showBatchOffline/);
  assert.match(source, /openBatchOnline/);
  assert.match(source, /submitBatchOnline/);
  assert.match(source, /批量上线/);
  assert.match(source, /批量下线/);
  assert.match(source, /type="checkbox"/);
});

// 设备工具栏在窄屏与选择状态下保持单一操作上下文，避免按钮堆叠。
test('administrator device toolbar switches to a responsive selection context', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /device-toolbar__normal/);
  assert.match(source, /device-toolbar__selection/);
  assert.match(source, /mobile-device-more/);
  assert.match(source, /clearDeviceSelection/);
  assert.match(source, /v-if="!selectedDeviceIds\.length"/);
  assert.match(source, /v-else class="device-toolbar__selection"/);
  assert.match(document, /\.section-header--devices/);
  assert.match(document, /\.device-toolbar__mobile-actions/);
  assert.match(document, /\.mobile-device-more/);
  assert.match(document, /\.section-header--devices \.section-title\s*\{[^}]*white-space:\s*nowrap/s);
});

// 批量分类在桌面端直接显示，移动端保留分类并把状态操作收进选择菜单。
test('administrator batch categorization fits desktop and mobile selection toolbars', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /\/api\/devices\/batch-category/);
  assert.match(source, /showBatchCategory/);
  assert.match(source, /batchCategoryId/);
  assert.match(source, /openBatchCategory/);
  assert.match(source, /submitBatchCategory/);
  assert.match(source, /devices_batch_categorized/);
  assert.match(source, /device-toolbar__category/);
  assert.match(source, /device-toolbar__desktop-status-actions/);
  assert.match(source, /device-toolbar__mobile-batch-more/);
  assert.match(document, /\.device-toolbar__mobile-batch-more/);
  assert.match(document, /\.device-toolbar__desktop-label/);
  assert.match(document, /\.device-toolbar__mobile-label/);
});

test('administrator can generate a printable QR code for each individual device', () => {
  assert.match(source, /generateDeviceQR/);
  assert.match(source, /设备二维码/);
  assert.match(source, /\/api\/devices\/.*\/qrcode/);
});

test('frontend source and document use UTF-8 Chinese text without replacement characters', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /<meta charset="UTF-8">/i);
  assert.match(document, /设备管理系统/);
  assert.doesNotMatch(document, /�/);
  assert.doesNotMatch(source, /�/);
});

test('cards use semantic article element with portal-device-row class', () => {
  assert.match(borrowPageSource, /<article/);
  assert.match(borrowPageSource, /class="portal-device-row"/);
  assert.doesNotMatch(borrowPageSource, /class="portal-device-button"/);
});

test('waterfall cards end after device metadata without a hidden action spacer', () => {
  assert.doesNotMatch(borrowPageSource, /portal-device-row__action/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.doesNotMatch(document, /portal-device-row__action/);
});

test('portal includes search input and category chips', () => {
  assert.match(borrowPageSource, /portal-search/);
  assert.match(borrowPageSource, /portal-chip/);
});

test('portal uses filteredDevices computed property', () => {
  assert.match(borrowPageSource, /filteredDevices/);
});

// 移动端详情覆盖列表但不锁根页面，返回时直接使用未曾改变的原滚动位置。
test('mobile device detail keeps native document scroll untouched behind a fixed detail layer', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  const openDeviceSource = borrowPageSource.slice(
    borrowPageSource.indexOf('function openDevice'),
    borrowPageSource.indexOf('function closeDevice')
  );
  const closeDeviceSource = borrowPageSource.slice(
    borrowPageSource.indexOf('function closeDevice'),
    borrowPageSource.indexOf('function finishCloseDevice')
  );
  const finishCloseDeviceSource = borrowPageSource.slice(
    borrowPageSource.indexOf('function finishCloseDevice'),
    borrowPageSource.indexOf('function switchMode')
  );

  assert.match(borrowPageSource, /transition name="portal-detail-slide"/);
  assert.doesNotMatch(borrowPageSource, /<transition name="portal-detail-slide"[^>]*mode="out-in"/);
  assert.match(borrowPageSource, /portal-device-list-view/);
  assert.match(borrowPageSource, /portal-detail-view/);
  assert.doesNotMatch(borrowPageSource, /listScrollY|restoreListScroll|setDetailOpenState/);
  assert.doesNotMatch(closeDeviceSource, /window\.scrollTo/);
  assert.match(finishCloseDeviceSource, /savedDetailScrollY !== null && !isMobileDetailLayout\(\)[\s\S]*window\.scrollTo/);
  assert.match(openDeviceSource, /history\.pushState\(\{\s*portalDeviceId:\s*deviceId[\s\S]*\}/);
  assert.match(closeDeviceSource, /history\.state\?\.portalDeviceId\s*===\s*selectedDeviceId\.value[\s\S]*history\.back\(\)/);
  assert.match(closeDeviceSource, /history\.replaceState\(\{\},\s*'',\s*'\/borrow'\)/);
  assert.match(borrowPageSource, /<transition name="portal-detail-slide" :css="isMobileDetailLayout\(\)" @after-leave="finishCloseDevice">/);
  assert.doesNotMatch(closeDeviceSource, /device\.value\s*=\s*null/);
  assert.match(finishCloseDeviceSource, /focus\(\{\s*preventScroll:\s*true\s*\}\)/);
  assert.doesNotMatch(finishCloseDeviceSource, /setDetailOpenState/);
  assert.doesNotMatch(closeDeviceSource, /loadAvailableDevices\(\)/);
  assert.match(document, /@media \(max-width: 560px\)[\s\S]*?\.portal-detail-view\s*\{[^}]*position:\s*fixed[^}]*overflow-y:\s*auto/s);
  // 只检查根元素选择器，避免把文档标签到普通组件 overflow 之间的文本误判为根滚动锁。
  assert.doesNotMatch(document, /portal-detail-open|(?:^|\})\s*(?:html|body)(?:\s*,\s*(?:html|body))*\s*\{[^}]*overflow:\s*hidden/ms);
  assert.match(document, /\.portal-page--detail \.modal-overlay\s*\{[^}]*z-index:\s*200/s);
  assert.match(document, /@media \(max-width: 560px\)[\s\S]*?\.portal-detail-slide-enter-active\s*\{\s*transition:\s*transform \.18s ease-out;\s*\}/s);
  assert.match(document, /@media \(max-width: 560px\)[\s\S]*?\.portal-detail-slide-leave-active\s*\{\s*transition:\s*none;\s*\}/s);
  assert.match(document, /@media \(max-width: 560px\)[\s\S]*?\.portal-detail-slide-enter-from\s*\{[^}]*opacity:\s*1/s);
  assert.match(document, /@media \(max-width: 560px\)[\s\S]*?\.portal-detail-slide-leave-to\s*\{[^}]*transform:\s*none[^}]*opacity:\s*1/s);
});

test('portal category chips are text only', () => {
  assert.match(borrowPageSource, /<button v-for="cat in categories"[\s\S]*>\s*\{\{ cat\.name \}\}\s*<\/button>/);
  assert.doesNotMatch(borrowPageSource, /portal-chip__icon/);
  assert.doesNotMatch(borrowPageSource, /categoryIcon\(cat\.icon\)/);
});

test('admin image upload keeps the original aspect ratio without a cropper flow', () => {
  assert.match(source, /pendingImageFile/);
  assert.match(source, /URL\.createObjectURL\(file\)/);
  assert.match(source, /formData\.append\('image', pendingImageFile/);
  assert.doesNotMatch(source, /Cropper|cropImage|showCropModal|confirmCrop|setCropRatio/);
  assert.doesNotMatch(source, /裁剪图片|确认裁剪/);
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.image-crop-editor\s*\{/);
  assert.doesNotMatch(document, /cropper-shell|cropper-image/);
});

test('administrator device categories are required and detail images fill the container width naturally', () => {
  assert.match(source, /<label>设备分类 <span class="required">\*<\/span><\/label>/);
  assert.match(source, /alert\('请选择设备分类'\)/);
  assert.match(source, /formData\.append\('category', editingDevice\.category\)/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.portal-detail__media img\s*\{[^}]*width:\s*100%[^}]*height:\s*auto/s);
  assert.doesNotMatch(document, /\.portal-detail__media img\s*\{[^}]*max-height:/s);
});

test('administrator image preview exposes a drag-only crop height handle', () => {
  assert.match(source, /class="image-crop-editor"/);
  assert.match(source, /H: \{\{ cropDisplayHeight \}\}px/);
  assert.match(source, /class="image-crop-editor__handle"/);
  assert.match(source, /@pointerdown\.stop\.prevent="startCropMove"/);
  assert.match(source, /startCropMove/);
  assert.match(source, /startCropResize/);
  assert.match(source, /moveCropResize/);
  assert.match(source, /imageDisplayHeight/);
  assert.match(source, /imageDisplayPositionY/);
  assert.match(source, /imageDisplayAspectRatio/);
  assert.match(source, /cropDisplayPositionY/);
  assert.doesNotMatch(source, /type="number"[^>]*imageDisplayHeight/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.image-crop-editor__shade/);
  assert.match(document, /\.image-crop-editor__selection[^}]*cursor:\s*grab/s);
  assert.match(document, /\.image-crop-editor__handle[^}]*cursor:\s*ns-resize/s);
  assert.match(document, /object-position:\s*50% var\(--detail-media-position-y, 50%\)/);
});

test('administrator categories render a compact drag-sort list including cat-other', () => {
  assert.match(source, /class="category-sort-item"/);
  assert.match(source, /transition-group v-else name="category-sort"/);
  assert.match(source, /draggable="true"/);
  assert.match(source, /startCategoryDrag/);
  assert.match(source, /dragOverCategory/);
  assert.match(source, /dropCategory/);
  assert.match(source, /\/api\/categories\/reorder/);
  assert.match(source, /cat\.id !== 'cat-other'/);
  assert.doesNotMatch(source, /newCategoryIcon|newCategorySort|categoryIconEmoji/);
});

test('administrator tabs fill desktop navigation and scroll horizontally on narrow screens', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  const baseTabRule = document.match(/\.tab-btn\s*\{([^}]*)\}/)?.[1] || '';

  assert.match(baseTabRule, /flex:\s*1\s+0\s+auto/);
  assert.match(baseTabRule, /white-space:\s*nowrap/);
  assert.match(baseTabRule, /min-width:\s*max-content/);
  assert.match(document, /\.tab-btn\s*\{\s*flex:\s*0\s+0\s+auto/);
  assert.match(document, /\.tab-badge\s*\{[^}]*flex:\s*none/s);
});

// 管理端设备视图切换契约：卡片与紧凑列表共用设备操作，并记住管理员选择。
test('administrator can switch between persistent card and list device views', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /class="device-view-toggle"/);
  assert.match(source, /setDeviceViewMode\('card'\)/);
  assert.match(source, /setDeviceViewMode\('list'\)/);
  assert.match(source, /deviceViewMode === 'list'/);
  assert.match(source, /localStorage\.getItem\('adminDeviceViewMode'\)/);
  assert.match(source, /localStorage\.setItem\('adminDeviceViewMode', mode\)/);
  assert.match(document, /\.device-grid--list\s*\{/);
  assert.match(document, /\.device-view-toggle\s*\{/);
});

// 列表模式布局契约：文字可收缩，操作区不会把设备内容推出视口。
test('administrator list device rows constrain media and action columns', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.device-grid--list \.device-card-body\s*\{[^}]*min-width:\s*0/s);
  assert.match(document, /\.device-grid--list \.device-card-actions\s*\{[^}]*min-width:\s*0/s);
  assert.match(document, /\.device-grid--list \.device-card-img\s*\{[^}]*width:\s*88px/s);
  assert.match(document, /\.device-grid--list \.device-card-actions\s*\{[^}]*flex-wrap:\s*wrap/s);
});

// 列表缩略图与信息区使用固定方形比例和统一行高，避免字段数量造成留白不齐。
test('administrator list device rows keep square thumbnails and aligned content heights', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.device-grid--list \.device-card\s*\{[^}]*grid-template-rows:\s*minmax\(112px, auto\) auto/s);
  assert.match(document, /\.device-grid--list \.device-card-img\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1[^}]*align-self:\s*center/s);
  assert.match(document, /@media \(max-width:\s*700px\)[\s\S]*?\.device-grid--list \.device-card\s*\{[^}]*grid-template-rows:\s*minmax\(96px, auto\) auto/s);
});

// 管理端统计面板契约：独立 Tab 加载受保护的聚合接口并提供三个时间范围。
test('administrator dashboard exposes borrowing statistics with range controls', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /\{ key: 'statistics', label: '借用统计'/);
  assert.match(source, /activeTab === 'statistics'/);
  assert.match(source, /const range = statisticsRange\.value/);
  assert.match(source, /apiCall\('GET', '\/api\/statistics\/borrowing\?range=' \+ range\)/);
  assert.match(source, /setStatisticsRange\('7d'\)/);
  assert.match(source, /setStatisticsRange\('30d'\)/);
  assert.match(source, /setStatisticsRange\('all'\)/);
  assert.match(source, /statisticsDisplay\.summary\.borrowCount/);
  assert.match(source, /statistics\.popularDevices/);
  assert.match(source, /statistics\.trend/);
  assert.match(document, /\.statistics-summary\s*\{/);
  assert.match(document, /\.statistics-trend\s*\{/);
});

// 管理端统计动效契约：三个范围统一入场，密集日期可横向浏览且数值贴近柱顶。
test('administrator statistics animate data changes without replacing the panel', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /statisticsLoading\s*&&\s*!statisticsReady/);
  assert.match(source, /statistics-panel/);
  assert.match(source, /statisticsDisplay\.summary\.borrowCount/);
  assert.match(source, /<transition name="portal-count" mode="out-in"><strong :key="statisticsDisplay\.summary\.borrowCount">/);
  assert.match(source, /function updateStatisticsSummary\(summary\)/);
  assert.doesNotMatch(source, /function animateStatisticsSummary\(summary\)/);
  assert.match(source, /trendBarHeight\(point\.borrowCount\)/);
  assert.match(source, /statisticsTrendAnimationKey/);
  assert.match(source, /:key="statisticsTrendAnimationKey" class="statistics-trend"/);
  assert.match(source, /statisticsTrendAnimationKey\.value \+= 1/);
  assert.match(source, /const requestId = \+\+statisticsRequestId/);
  assert.match(source, /if \(requestId !== statisticsRequestId\) return/);
  assert.match(source, /'--trend-height'\s*:\s*trendBarHeight\(point\.borrowCount\)/);
  assert.match(document, /\.statistics-panel--updating\s*\{[^}]*opacity:\s*\.88/s);
  assert.match(document, /\.statistics-range__button\s*\{[^}]*transition:[^}]*\.12s/s);
  assert.match(source, /'--trend-count'\s*:\s*statistics\.trend\.length/);
  assert.match(document, /\.statistics-trend\s*\{[^}]*column-gap:\s*8px/s);
  assert.match(document, /\.statistics-trend\s*\{[^}]*overflow-y:\s*hidden/s);
  assert.match(document, /\.statistics-trend\s*\{[^}]*scrollbar-width:\s*thin/s);
  assert.match(document, /\.statistics-trend--dense\s*\{[^}]*grid-template-columns:\s*repeat\(var\(--trend-count,\s*1\),\s*44px\)/s);
  assert.match(document, /\.statistics-trend__bar\s*\{[^}]*width:\s*min\(100%,\s*32px\)/s);
  assert.match(document, /\.statistics-trend__value\s*\{[^}]*margin-bottom:\s*4px/s);
  assert.match(document, /\.statistics-trend__bar\s*\{[^}]*height:\s*var\(--trend-height,\s*2px\)/s);
  assert.match(document, /\.statistics-section__header h3\s*\{[^}]*font-family:\s*var\(--sans\)/s);
  assert.match(document, /\.statistics-trend__bar--animated\s*\{[^}]*animation:\s*statistics-bar-rise\s*\.22s/s);
  assert.match(document, /@keyframes statistics-bar-rise\s*\{[\s\S]*?from\s*\{\s*height:\s*2px;?\s*\}[\s\S]*?to\s*\{\s*height:\s*var\(--trend-height,\s*2px\)/);
  assert.match(document, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.statistics-trend__bar[^}]*transition:\s*none/s);
});

// 管理端操作日志契约：独立 Tab 加载受保护日志，并按四类动作进行本地筛选。
test('administrator dashboard exposes filterable operation logs', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /\{ key: 'operation-logs', label: '操作日志'/);
  assert.match(source, /activeTab === 'operation-logs'/);
  assert.match(source, /apiCall\('GET', '\/api\/operation-logs'\)/);
  assert.match(source, /operationLogFilter/);
  assert.match(source, /filteredOperationLogs/);
  assert.match(source, /device_created/);
  assert.match(source, /device_updated/);
  assert.match(source, /device_offlined/);
  assert.match(source, /admin_returned/);
  assert.match(document, /\.operation-log-list\s*\{/);
  assert.match(document, /\.operation-log-item\s*\{/);
});

// 管理端邮件通知设置契约：SMTP 凭据只作为密码输入提交，不在页面回显。
test('administrator can configure encrypted SMTP notifications and event rules', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(source, /email-notifications/);
  assert.match(source, /\/api\/admin\/email-settings/);
  assert.match(source, /\/api\/admin\/email-settings\/test/);
  assert.match(source, /emailSettings\.notifyBorrow/);
  assert.match(source, /emailSettings\.notifyReturn/);
  assert.match(source, /emailSettings\.notifyAdminReturn/);
  assert.match(source, /type="password"[^>]*autocomplete="new-password"/);
  assert.match(source, /secretConfigured/);
  assert.match(source, /emailSettings\.templates\[emailPreviewEvent\.value\]/);
  assert.match(source, /templates\[emailPreviewEvent\]\.subject/);
  assert.match(source, /templates\[emailPreviewEvent\]\.body/);
  assert.match(source, /设备借出：\{\{deviceName\}\}/);
  assert.match(source, /用户归还：\{\{deviceName\}\}/);
  assert.match(source, /管理员归还：\{\{deviceName\}\}/);
  assert.match(source, /templates:\s*\{\s*borrow:/);
  assert.match(source, /maskSensitiveData/);
  assert.match(source, /emailTemplateFields/);
  assert.match(source, /borrowerPhoneMasked/);
  assert.match(source, /insertEmailVariable/);
  assert.match(source, /emailTemplatePreview/);
  assert.match(source, /previewEvent/);
  assert.match(source, /发送当前模板测试邮件/);
  assert.match(document, /\.email-settings-layout\s*\{/);
  assert.match(document, /\.email-template-editor-grid\s*\{/);
  assert.match(document, /\.email-variable-button\s*\{/);
  assert.match(document, /\.email-template-preview\s*\{/);
  assert.match(document, /\.email-settings-message--error\s*\{/);
});

// 管理员分级前端契约：登录身份和功能管理入口必须由服务端返回的角色驱动。
test('administrator UI supports username login, role-aware management, and password changes', () => {
  assert.match(source, /username/);
  assert.match(source, /\/api\/admin\/users/);
  assert.match(source, /super_admin/);
  assert.match(source, /admin-management/);
  assert.match(source, /permissions/);
  assert.match(source, /\/api\/admin\/password/);
  assert.match(source, /原密码/);
  assert.match(source, /确认新密码/);
  assert.match(source, /删除管理员/);
});

// 管理员数据加载契约：没有对应权限时不应请求受保护的日志和邮件接口。
test('administrator data loading gates protected requests by permission', () => {
  assert.match(source, /hasAdminPermission\('operation-logs'\)\s*\?/);
  assert.match(source, /hasAdminPermission\('email-settings'\)\s*\?/);
});

test('administrator navigation groups management areas and supports a mobile drawer', () => {
  assert.match(source, /admin-sidebar/);
  assert.match(source, /运营管理/);
  assert.match(source, /配置管理/);
  assert.match(source, /数据分析/);
  assert.match(source, /系统设置/);
  assert.match(source, /admin-drawer/);
  assert.match(source, /toggleAdminNavigation/);
  assert.doesNotMatch(source, /class="tab-bar"/);
});

test('administrator desktop device toolbar keeps data tools and QR action visible', () => {
  const desktopToolbar = source.match(/<div class="device-toolbar__desktop-actions">([\s\S]*?)<\/div>/)?.[1] || '';
  assert.match(desktopToolbar, />下载模板</);
  assert.match(desktopToolbar, />导入设备</);
  assert.match(desktopToolbar, />导出设备</);
  assert.match(desktopToolbar, /device-toolbar__separator/);
  assert.match(desktopToolbar, />统一二维码</);
  assert.match(desktopToolbar, /\+ 添加设备/);
  assert.doesNotMatch(desktopToolbar, /更多设备操作/);
  assert.match(source, /class="mobile-device-more"/);
});

// 管理端短内容页面仍将页脚推到页面底部，长内容不改变自然滚动。
test('administrator footer stays at the bottom for short content', () => {
  assert.match(documentSource, /\.admin-layout\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*flex:\s*1/s);
  assert.match(documentSource, /\.admin-shell\s*\{[^}]*flex:\s*1/s);
  assert.match(documentSource, /\.admin-main\s*\{[^}]*min-height:\s*0/s);
  assert.match(documentSource, /\.page-footer\s*\{[^}]*margin-top:\s*auto;/s);
  assert.match(source, /<div v-else class="admin-layout">[\s\S]*<footer class="page-footer admin-footer">/);
});

// 侧栏数字徽标使用弹性布局，确保数字在徽标内部水平、垂直居中。
test('administrator sidebar count badges center their numbers', () => {
  assert.match(documentSource, /\.admin-menu__item \.tab-badge\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*line-height:\s*1;/s);
});

// 收起侧栏的箭头和菜单图标使用固定几何盒居中，避免字体基线和窄栏列宽造成视觉偏移。
test('collapsed administrator sidebar centers its arrow and menu icons', () => {
  assert.match(source, /class="admin-sidebar__chevron"/);
  assert.match(documentSource, /\.admin-sidebar__collapse\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*font-size:\s*0;[^}]*line-height:\s*0;/s);
  assert.match(documentSource, /\.admin-sidebar__chevron\s*\{[^}]*width:\s*9px;[^}]*height:\s*9px;[^}]*display:\s*block;[^}]*border-left:[^}]*border-bottom:[^}]*transform:\s*rotate\(45deg\)/s);
  assert.match(documentSource, /\.admin-sidebar--collapsed \.admin-menu__item\s*\{[^}]*min-height:\s*42px;[^}]*padding:\s*0;/s);
  assert.match(documentSource, /\.admin-sidebar--collapsed \.admin-menu__icon\s*\{[^}]*width:\s*42px;[^}]*height:\s*42px;[^}]*flex:\s*0 0 42px;[^}]*display:\s*grid;[^}]*place-items:\s*center;/s);
});

// 低频统计与日志入口排在分类管理之后，并使用与其他 Tab 一致的彩色图标。
test('administrator places low-frequency tabs after categories with matching icons', () => {
  assert.match(source, /\{ key: 'categories', label: '分类管理', icon: '🏷️'[^}]*\},\s*\{ key: 'statistics', label: '借用统计', icon: '📊'[^}]*\},\s*\{ key: 'operation-logs', label: '操作日志', icon: '🧾'[^}]*\}/s);
});

// 批量导入导出统一使用真实 XLSX、多列中文表头和提交前预览。
test('administrator device batch import and export uses an XLSX preview workflow', () => {
  assert.match(source, /loadExcelJS/);
  assert.match(source, /import\('exceljs'\)/);
  assert.match(source, /设备名称[\s\S]*设备型号[\s\S]*设备分类[\s\S]*存放位置[\s\S]*设备说明/);
  assert.match(source, /accept="\.xlsx"/);
  assert.match(source, /downloadDeviceImportTemplate/);
  // 模板内置当前分类清单，并把分类列配置为可直接选择的 Excel 下拉框。
  assert.match(source, /addWorksheet\('分类选项'\)/);
  assert.match(source, /dataValidation\s*=\s*\{/);
  assert.match(source, /type:\s*'list'/);
  assert.match(source, /'分类选项'!\$A\$2:/);
  assert.match(source, /handleDeviceImportFile/);
  assert.match(source, /deviceImportPreview/);
  assert.match(source, /\/api\/devices\/batch-import/);
  assert.match(source, /exportDevices/);
  assert.match(source, />下载模板</);
  assert.match(source, />导入设备</);
  assert.match(source, />导出设备</);
});

test('document loads Noto Sans SC from the local stylesheet', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\/fonts\/noto-sans-sc\.css/);
  assert.match(document, /Noto Sans SC/);
  assert.doesNotMatch(document, /fonts\.googleapis\.com/);
  assert.doesNotMatch(document, /fonts\.gstatic\.com/);
});

test('document includes prefers-reduced-motion override', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /@media \(prefers-reduced-motion: reduce\)/);
});

// 点击粒子特效只属于用户端，并保持依赖顺序、交互过滤和卸载清理。
test('borrow portal loads and isolates the click particle effect', () => {
  const fireworks = fs.readFileSync(path.resolve(__dirname, '../public/js/fireworks.js'), 'utf8');
  const anime = fs.readFileSync(path.resolve(__dirname, '../public/js/anime.min.js'), 'utf8');
  const borrowPageSource = source.slice(source.indexOf('const BorrowPage'), source.indexOf('const AdminPage'));

  assert.ok(anime.length > 1000);
  assert.match(borrowPageSource, /<canvas class="fireworks" aria-hidden="true"><\/canvas>/);
  assert.match(borrowPageSource, /loadBorrowFireworks\(canvasEl\)/);
  assert.match(source, /loadScript\('\/js\/anime\.min\.js'\)[\s\S]*?loadScript\('\/js\/fireworks\.js'\)/);
  assert.match(fireworks, /window\.initBorrowFireworks/);
  assert.match(fireworks, /prefers-reduced-motion/);
  assert.match(fireworks, /pointerdown/);
  assert.match(fireworks, /a, button, input, textarea, select/);
  assert.match(fireworks, /removeEventListener\('pointerdown'/);
  assert.match(fireworks, /pause\(\)/);
  assert.match(documentSource, /\.fireworks\s*\{[^}]*pointer-events:\s*none[^}]*z-index:\s*90/s);
  assert.doesNotMatch(source.slice(source.indexOf('const AdminPage')), /class="fireworks"/);
});

// 约束用户端与管理端吸顶导航保持统一的半透明玻璃层表现。
test('sticky navigation uses a translucent glass treatment on both portals', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.portal-tabs\s*\{[^}]*background:\s*rgba\(/s);
  assert.match(document, /\.portal-tabs\s*\{[^}]*backdrop-filter:\s*blur\(/s);
  assert.match(document, /\.admin-nav\s*\{[^}]*background:\s*rgba\(/s);
  assert.match(document, /\.admin-nav\s*\{[^}]*backdrop-filter:\s*blur\(/s);
});

// 管理端与用户端顶部入口都使用宽版容器，内容区仍保留可读宽度。
test('admin AppBar and user portal tabs use stable full-width containers', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.admin-page\s*\{[^}]*overflow-x:\s*(?:clip|hidden)/s);
  assert.match(document, /\.admin-nav\s*\{[^}]*width:\s*calc\(100%\s*\+\s*36px\)[^}]*margin-inline:\s*-18px[^}]*padding:\s*18px/s);
  assert.match(document, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.admin-nav\s*\{[^}]*width:\s*calc\(100%\s*\+\s*24px\)[^}]*margin-inline:\s*-12px[^}]*padding:\s*12px/s);
  assert.match(document, /\.portal-page\s*\{[^}]*max-width:\s*1180px/s);
  assert.match(document, /\.portal-page:not\(\.portal-page--feed\)\s+\.portal-main\s*\{[^}]*max-width:\s*720px[^}]*margin-inline:\s*auto/s);
  assert.match(document, /\.portal-tabs\s*\{[^}]*width:\s*100%[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)[^}]*padding:\s*8px\s+20px/s);
});

// 根页面始终预留滚动条槽位，避免在不同高度的管理页面之间切换时横向跳动。
test('root page reserves a stable scrollbar gutter', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /html\s*\{[^}]*scrollbar-gutter:\s*stable/s);
});

// 约束图片选区使用独立玻璃层，不直接模糊正在编辑的原图。
test('image editor exposes a glass overlay without blurring the source image', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.image-crop-editor__glass\s*\{[^}]*backdrop-filter:\s*blur\(/s);
  assert.match(document, /\.image-crop-editor__glass\s*\{[^}]*background:\s*rgba\(/s);
  assert.doesNotMatch(document, /\.image-crop-editor__image\s*\{[^}]*filter:\s*blur\(/s);
});

test('portal tabs do not render a sliding blue indicator line', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.doesNotMatch(source, /portal-tab__indicator/);
  assert.doesNotMatch(document, /portal-tab__indicator/);
});

test('old portal-subtitle is removed from the document', () => {
  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.doesNotMatch(document, /portal-subtitle/);
});

test('public and administrator footers expose the local site runtime clock', () => {
  const runtimeFooters = source.match(/class="page-footer__runtime"/g) || [];
  assert.equal(runtimeFooters.length, 2);
  assert.match(source, /2026-07-21T12:00:00\+08:00/);
  assert.match(source, /本站已运行 \$\{days\} 天 \$\{hours\} 小时 \$\{minutes\} 分 \$\{seconds\} 秒/);
  assert.match(source, /window\.clearInterval\(timerId\)/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.page-footer__runtime\s*\{/);
});

// 一言应仅使用诗词和哲学两类内容，并在两个网页底栏中提供安全降级。
test('public and administrator footers load one hitokoto sentence per refresh', () => {
  const hitokotoFooters = source.match(/class="page-footer__hitokoto"/g) || [];
  assert.equal(hitokotoFooters.length, 2);
  assert.match(source, /https:\/\/v1\.hitokoto\.cn\/\?c=i&c=k&max_length=40&encode=json/);
  assert.match(source, /Vue\.onMounted\(loadHitokoto\)/);
  assert.match(source, /AbortController/);
  assert.match(source, /window\.setTimeout\([\s\S]*?2500/);
  assert.match(source, /山高水长，行稳致远。/);
  assert.match(source, /https:\/\/hitokoto\.cn\/\?uuid=/);
  assert.match(source, /rel="noopener noreferrer"/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.page-footer__hitokoto\s*\{/);
  assert.match(document, /\.page-footer__hitokoto\s*\{[^}]*font-family:\s*var\(--sans\)[^}]*font-size:\s*14px/);
  assert.match(document, /\.page-footer__hitokoto-link\s*\{/);
});

// 一言打字机应逐字显示、完整清理定时器，并尊重减少动态效果设置。
test('hitokoto footer uses an accessible reduced-motion-aware typewriter effect', () => {
  const cursors = source.match(/class="page-footer__hitokoto-cursor"/g) || [];
  assert.equal(cursors.length, 2);
  assert.match(source, /Array\.from\(text\)/);
  assert.match(source, /window\.setInterval\([\s\S]*?60/);
  assert.match(source, /window\.setTimeout\([\s\S]*?1000/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /window\.clearInterval\(typingTimerId\)/);
  assert.match(source, /window\.clearTimeout\(cursorTimerId\)/);
  assert.match(source, /isHitokotoTyping/);

  const document = fs.readFileSync(path.resolve(__dirname, '../frontend/index.html'), 'utf8');
  assert.match(document, /\.page-footer__hitokoto-cursor\s*\{/);
  assert.match(document, /@keyframes hitokoto-cursor-blink/);
  assert.match(document, /prefers-reduced-motion:\s*reduce[\s\S]*?\.page-footer__hitokoto-cursor/);
});
