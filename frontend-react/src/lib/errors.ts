/**
 * A chunk of the app could not be loaded: most often the server was rebuilt
 * (git pull + build) while the tab still runs the previous bundle, whose file
 * names are gone; a dropped connection looks the same. A reload helps either
 * way. The texts are what Chromium, Firefox and Safari say for a failed
 * dynamic import; Safari under vite preview's SPA fallback receives
 * index.html instead of the missing chunk and reports its MIME type.
 */
export function isStaleBuild(e: unknown): boolean {
  const text = e instanceof Error ? e.message : String(e);
  return /dynamically imported module|Importing a module script failed|is not a valid JavaScript MIME type/i.test(
    text,
  );
}

/** One line for the user about any failure. */
export function describeError(e: unknown): string {
  if (isStaleBuild(e)) return "Не удалось загрузить часть приложения - обновите страницу";
  return e instanceof Error && e.message ? e.message : "Неизвестная ошибка";
}
