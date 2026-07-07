export interface SheetSpec {
  name: string;
  rows: object[];
}

/**
 * Export several sheets of flat objects to one .xlsx file and trigger a
 * download. Column headers are taken from the keys of each sheet's first row.
 */
export async function exportWorkbook(sheets: SheetSpec[], fileName: string): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  for (const { name, rows } of sheets) {
    const sheet = workbook.addWorksheet(name);
    if (rows.length > 0) {
      const keys = Object.keys(rows[0]);
      sheet.columns = keys.map((key) => ({ header: key, key, width: 20 }));
      sheet.addRows(rows);
      sheet.getRow(1).font = { bold: true };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}

/** Export one array of flat objects to an .xlsx file (single sheet). */
export async function exportToExcel<T extends object>(
  rows: T[],
  fileName: string,
  sheetName = "Sheet1",
): Promise<void> {
  await exportWorkbook([{ name: sheetName, rows }], fileName);
}
