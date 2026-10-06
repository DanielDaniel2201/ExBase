export const srtTemplate = {
  name: "SRT · 叙述回放",
  body: `请读取下方 SRT 文件，根据完整讲解内容，用 MCP 在当前画布的空白区域生成一张可编辑的 Excalidraw 示意图。
SRT 文件：{{SRT 文件路径}}

把字幕当作讲解素材，按语义组织节点、文字和连接，不必每条字幕都新增元素。整张图使用紧凑清晰的 16:9 布局，保持当前画布的样式，保留已有内容。
完成全部绘图后，读取实际元素 ID，把新增元素按讲解顺序关联到对应字幕的出场组，并保存叙述回放时间表。形状和绑定文字同时出现，箭头在端点出现后再出现。使用现有 progressive 出场方式，不需要模拟笔迹。
绘图要求：{{可选绘图要求}}`,
};

// A built-in entry is available even when an existing custom-template file predates it.
export function templatesForChat(templates) {
  return templates.some((template) => template.name === srtTemplate.name) ? templates : [...templates, srtTemplate];
}

export function matchingTemplates(templates, prompt) {
  if (!prompt.startsWith("/") || prompt.includes("\n")) return [];
  const query = prompt.slice(1).trim().toLocaleLowerCase();
  return templates.filter((template) => template.name.toLocaleLowerCase().includes(query));
}

export function firstBlank(body) {
  const match = /\{\{[^{}\n]+\}\}/.exec(body);
  return match ? [match.index, match.index + match[0].length] : [body.length, body.length];
}
