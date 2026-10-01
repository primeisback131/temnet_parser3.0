import { describeError, isStaleBuild } from "./errors";

/** One titled table; a sheet can stack several of them. */
export interface TableSpec {
  title?: string;
  rows: object[];
}

export interface SheetSpec {
  name: string;
  /** Single table without a title (the common case). */
  rows?: object[];
  /** Several titled tables on one sheet, separated by blank rows. */
  sections?: TableSpec[];
}

/** Builds one .xlsx workbook in memory and returns its file contents. */
async function buildWorkbook(sheets: SheetSpec[]): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  for (const { name, rows, sections } of sheets) {
    const sheet = workbook.addWorksheet(name);
    const tables = sections ?? (rows ? [{ rows }] : []);
    let columns = 0;
    for (const table of tables) {
      if (sheet.rowCount > 0) {
        sheet.addRow([]);
      }
      if (table.title) {
        sheet.addRow([table.title]).font = { bold: true, size: 12 };
      }
      if (table.rows.length === 0) {
        continue;
      }
      const keys = Object.keys(table.rows[0]);
      columns = Math.max(columns, keys.length);
      sheet.addRow(keys).font = { bold: true };
      for (const row of table.rows) {
        sheet.addRow(keys.map((key) => (row as Record<string, unknown>)[key]));
      }
    }
    for (let i = 1; i <= columns; i++) {
      sheet.getColumn(i).width = 20;
    }
  }

  return workbook.xlsx.writeBuffer();
}

/** Triggers a browser download of the given blob. */
function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Export several sheets of flat objects to one .xlsx file and trigger a
 * download. Column headers are taken from the keys of each table's first row.
 */
export async function exportWorkbook(sheets: SheetSpec[], fileName: string): Promise<void> {
  const buffer = await loaded(buildWorkbook(sheets));
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  download(blob, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

/**
 * The result, or an error that says which action failed: the ExcelJS and
 * JSZip chunks load on first use and are gone after a redeploy, and their own
 * message is English browser text.
 */
async function loaded<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (e) {
    throw new Error(
      isStaleBuild(e)
        ? "Не удалось выгрузить Excel - обновите страницу"
        : `Не удалось выгрузить Excel: ${lowerFirst(describeError(e))}`,
    );
  }
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** One .xlsx file inside a zip archive. */
export interface WorkbookFile {
  name: string;
  sheets: SheetSpec[];
}

/** Build several .xlsx workbooks and download them as a single .zip archive. */
export async function exportWorkbooksZip(files: WorkbookFile[], zipName: string): Promise<void> {
  const JSZip = (await loaded(import("jszip"))).default;
  const zip = new JSZip();
  for (const file of files) {
    const name = file.name.endsWith(".xlsx") ? file.name : `${file.name}.xlsx`;
    zip.file(name, await loaded(buildWorkbook(file.sheets)));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  download(blob, zipName.endsWith(".zip") ? zipName : `${zipName}.zip`);
}

/**
 * Make a string usable as an Excel sheet name: strip the characters Excel
 * forbids and cut to the 31-character limit.
 */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*[\]:]/g, " ").trim();
  return (cleaned || "Лист").slice(0, 31);
}

/**
 * A safe sheet name not in `used` yet, which it is then added to. Excel sheet
 * names are case-INsensitive: "Altair" and "altair" would collide, so `used`
 * holds lower-case names.
 */
export function uniqueSheetName(name: string, used: Set<string>): string {
  let result = safeSheetName(name);
  for (let i = 2; used.has(result.toLowerCase()); i++) {
    result = `${safeSheetName(name).slice(0, 28)}~${i}`;
  }
  used.add(result.toLowerCase());
  return result;
}

/** Export one array of flat objects to an .xlsx file (single sheet). */
export async function exportToExcel<T extends object>(
  rows: T[],
  fileName: string,
  sheetName = "Sheet1",
): Promise<void> {
  await exportWorkbook([{ name: sheetName, rows }], fileName);
}
