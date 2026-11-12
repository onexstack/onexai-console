OneX AI 智能体平台。

对应的后端：/Users/colin/workspace/golang/src/github.com/onexstack/onexai
后端对应的配置文件目录：/Users/colin/.onexai
oai-agent-apiserver 的API路由函数目录：/Users/colin/workspace/golang/src/github.com/onexstack/onexai/internal/agent/handler
oai-agent-apiserver 的API路由函数目录：/Users/colin/workspace/golang/src/github.com/onexstack/onexai/internal/chat/handler


## 注意事项

- 请用中文回答
- 本机可能已经运行了某些服务，如果你需要连线测试，可以kill掉已运行的服务，启动你自己的服务进行测试
- 要求整个方案、实现从性能、扩展能力、功能、易用性、简洁性等方面做到极致，符合最佳实践
- 更新配置时，要同时更新 /Users/colin/.onexai/<服务名字>.yaml 中的YAML文件和onex/configs/<服务名字>.yaml 下的YAML文件。不要遗漏或者只更新其中一个
- 我目前是采用本地部署，不需要构建和更新kubernees服务
- 所有改动，都要review前后端代码，确保有类似问题或者相同问题的页面、按钮等都同步更新，不要有遗漏
- 所有功能，都要确保前后端完全接线成功。

## 列表页表格规范

唯一真源：`src/ui/components/ProTable/layout.ts`。新增/修改任何列表页表格都必须遵守：

1. **整表铺满内容区**：`<Table>` 展开 `RESOURCE_TABLE_LAYOUT`（`scroll.x='max-content'` + `tableLayout='auto'`）。**禁止**用 `min-width: 0 !important` 之类的手段把表缩成内容宽度——那会让操作列停在页面中途、内容超宽时又被挤出卡片。
2. **操作列贴内容区右缘**：永远是最后一列，展开 `RESOURCE_ACTION_COLUMN`（固定宽度 + `fixed:'right'` + `align:'right'`）。内容超宽时表格在卡片内部横向滚动，操作列不移动、不被裁切。
3. **ID/名称列给足宽度**：`width: RESOURCE_ID_COLUMN_WIDTH`；列内无界文本用 `EllipsisText maxWidth={RESOURCE_ID_TEXT_MAX_WIDTH}`，不要写 190/220 之类的魔数。
4. **其余列按内容自动计算宽度**：交给 auto 布局，优先保证内容展示全；只有内容有界的语义列（状态/时间/开关）可给偏好宽度，不要为了撑满而给文本列固定宽度。不要用列级 `ellipsis` 截断，无界长文本（URL、长 ID）在单元格内部用 `EllipsisText` 限宽。
5. **移动端**：自绘表格用 `ResponsiveTable`（`<768px` 自动切卡片），`ResourcePage` 已内置。
