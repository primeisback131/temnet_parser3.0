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
  const buffer = await buildWorkbook(sheets);
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  download(blob, fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`);
}

/** One .xlsx file inside a zip archive. */
export interface WorkbookFile {
  name: string;
  sheets: SheetSpec[];
}

/** Build several .xlsx workbooks and download them as a single .zip archive. */
export async function exportWorkbooksZip(files: WorkbookFile[], zipName: string): Promise<void> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const file of files) {
    const name = file.name.endsWith(".xlsx") ? file.name : `${file.name}.xlsx`;
    zip.file(name, await buildWorkbook(file.sheets));
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

/** Export one array of flat objects to an .xlsx file (single sheet). */
export async function exportToExcel<T extends object>(
  rows: T[],
  fileName: string,
  sheetName = "Sheet1",
): Promise<void> {
  await exportWorkbook([{ name: sheetName, rows }], fileName);
}
