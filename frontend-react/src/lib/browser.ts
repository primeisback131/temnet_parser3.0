/** "Chrome 153, Windows" from a User-Agent string; the raw string when nothing matches. */
export function browserName(userAgent: string): string {
  if (!userAgent) return "-";
  const browsers: [string, RegExp][] = [
    ["Edge", /Edg\/(\d+)/],
    ["Opera", /OPR\/(\d+)/],
    ["Yandex", /YaBrowser\/(\d+)/],
    ["Firefox", /Firefox\/(\d+)/],
    ["Chrome", /Chrome\/(\d+)/],
    ["Safari", /Version\/(\d+).*Safari/],
  ];
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad/.test(userAgent)
        ? "iOS"
        : /Mac OS/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "";
  for (const [name, re] of browsers) {
    const m = re.exec(userAgent);
    if (m) return os ? `${name} ${m[1]}, ${os}` : `${name} ${m[1]}`;
  }
  return userAgent.length > 40 ? `${userAgent.slice(0, 40)}…` : userAgent;
}
