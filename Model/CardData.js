import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const htmlDir = fileURLToPath(new URL("../Resources/Code/", import.meta.url))

export function frameworkInfo() {
  try {
    const { name, version } = JSON.parse(readFileSync("package.json", "utf8"))
    return {
      yunzai_name: (name || "unknown").replace(/(^|-)([^-])/g, (_, prefix, char) => prefix + char.toUpperCase()),
      yunzai_version: version || "unknown"
    }
  } catch {
    return { yunzai_name: "unknown", yunzai_version: "unknown" }
  }
}

export function codeCardData(cmd, Code, baiduLatency) {
  return { htmlDir, tplFile: htmlDir + "Code.html", ...frameworkInfo(), cmd, Code, baidu_latency: baiduLatency }
}
