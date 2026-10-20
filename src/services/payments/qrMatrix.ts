import qrcode from 'qrcode-generator';

/**
 * QR modules for `text` (true = dark), using error correction level M (15%): standard for
 * payment links and readable on a scratched or dim phone screen. The smallest QR version that
 * fits is chosen automatically.
 */
export function qrMatrix(text: string): boolean[][] {
  if (text.length === 0 || text.length > 2048) {
    throw new RangeError('QR text must be 1-2048 characters');
  }
  const code = qrcode(0, 'M');
  code.addData(text, 'Byte');
  code.make();
  const size = code.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < size; row += 1) {
    const cells: boolean[] = [];
    for (let col = 0; col < size; col += 1) {
      cells.push(code.isDark(row, col));
    }
    rows.push(cells);
  }
  return rows;
}

/** One SVG path drawing every dark module, offset by the quiet zone (in module units). */
export function qrPath(
  matrix: readonly (readonly boolean[])[],
  quietZone: number,
): string {
  const parts: string[] = [];
  matrix.forEach((cells, row) => {
    cells.forEach((dark, col) => {
      if (dark) {
        parts.push(`M${col + quietZone} ${row + quietZone}h1v1h-1z`);
      }
    });
  });
  return parts.join('');
}
