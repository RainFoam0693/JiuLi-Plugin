export async function getBaiduLatency() {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 3000)
  const startTime = performance.now()

  try {
    await fetch("https://baidu.com", {
      method: "HEAD",
      redirect: "manual",
      signal: controller.signal,
    })
    return `${Math.round(performance.now() - startTime)} ms`
  } catch {
    return "TIMEOUT"
  } finally {
    clearTimeout(timeout)
  }
}
