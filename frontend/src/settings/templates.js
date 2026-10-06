export function matchingTemplates(templates, prompt) {
  if (!prompt.startsWith("/") || prompt.includes("\n")) return [];
  const query = prompt.slice(1).trim().toLocaleLowerCase();
  return templates.filter((template) => template.name.toLocaleLowerCase().includes(query));
}

export function firstBlank(body) {
  const match = /\{\{[^{}\n]+\}\}/.exec(body);
  return match ? [match.index, match.index + match[0].length] : [body.length, body.length];
}
