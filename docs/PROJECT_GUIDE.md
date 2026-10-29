# 项目规则与代码导航

业务功能与目录结构见 README.md。设备与物资分别维护库存及记录，共用管理员登录；物资库存和借用记录权限独立，设备权限不授予物资权限。

普通用户免账户、直接借用。物资卡片可直接增减借用数量，减到零取消选择；长按加号选满，长按减号清空该物资选择。清单可继续修改数量，详情页可取消选择。选择不占库存，服务端提交时校验并按数量扣减，支持部分归还。手机号用于查询索引，每笔借用保留独立 ID。公开接口脱敏；本人查询需要姓名与完整手机号。

正常归还自动完成。单次申报消耗超过原借出数量 30% 时审核，可按物资调整阈值；损坏、丢失需要处理。上传支持选图和手机拍照。

环境变量见 .env.example、deploy/device-management.env.example。ADMIN_PASSWORD_HASH 用于初始管理员凭证，数据库已有管理员时不要将更换环境变量视为重置密码。会话与访客关联存储在 site-state.sqlite，物资库和设备库分别保存；不可提交任何运行时数据库。

生产必须独立配置 ADMIN_PASSWORD_HASH、EMAIL_CONFIG_KEY 和 HTTPS，关闭 MATERIALS_DEMO。更多部署步骤见 DEPLOY.md。没有预置服务器、真实账号或自动发布目标。

物资用户端视觉层为 frontend/src/styles/materials-public.css，全部规则限定于 .mm-app--public，只有非嵌入的 MaterialsPage 使用此根类。请勿将该视觉层改为 body、全局 button 等选择器，避免改变设备系统或统一管理后台。原 materials.css 继续提供物资页面基础布局与后台嵌入样式。物资公共页的动效遵守 prefers-reduced-motion，毛玻璃提供实色回退；表单维持 16px 文字，避免手机端输入时缩放。

设备与物资公共页的双向入口由 portal-links.css 提供：设备页的“物资借用”位于借还导航中，物资页的“设备借还”位于页头。物资后台视觉层为 materials-admin.css，限定 .mm-app--embedded 与 .admin-page--materials；后者仅在登录后选中物资区域时生效。后台输入框和正文至少 16px，辅助信息保持 14px；表格在窄屏横向滚动，交互目标至少 44px，动画遵守减少动态效果偏好。

实盘盘点使用 POST /api/v2/admin/materials/:id/stocktake，填写 counted、expected、reason、requestId；只改变完好在库量，重复请求不重复调整，库存变化返回409。累计消耗提醒仅对借用记录管理员显示。运维只读报告与恢复演练流程见 OPERATIONS.md。
