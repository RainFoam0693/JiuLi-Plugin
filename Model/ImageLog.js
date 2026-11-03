/** 解析可选行数和关键词，每次请求独立；最多输出 1000 行。 */
export function parseLogCommand(message) {
  const match = /^#(运行|错误)?图片日志\s*(\d+)?\s*([\s\S]*)$/.exec(message);
  if (!match) return null;
  return {
    isError: match[1] === "错误",
    limit: match[2] ? Math.min(1000, Math.max(1, Number(match[2]))) : 100,
    keyword: match[3].trim()
  };
}

export function selectLogLines(raw, { limit, keyword }) {
  return raw.split("\n")
    .map(line => line.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\r/g, ""))
    .filter(line => line && (!keyword || line.includes(keyword)))
    .slice(-limit);
}
