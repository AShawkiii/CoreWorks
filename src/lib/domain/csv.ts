/**
 * CSV codec — pure, no I/O.
 *
 * Written rather than pulled in, for three reasons that all matter to a
 * migration whose input is "whatever Google Sheets produced":
 *
 *  - **A BOM must be stripped.** Sheets prefixes its CSV export with U+FEFF.
 *    Left in place, the first header reads `﻿Client ID` and never matches
 *    the legacy contract, so *every* column silently fails to map.
 *  - **Quoting has to round-trip exactly.** Legacy free-text carries commas,
 *    quotes, and newlines — `'Multi-location retailer, 4 storefronts.'` is
 *    real sample data. Export must re-quote what import accepted.
 *  - **Line endings vary.** Sheets emits CRLF; a file that has been through an
 *    editor may be LF or even CR. All three parse.
 *
 * RFC 4180 with the conventional relaxations: bare quotes inside an unquoted
 * field are literal, and a final newline is optional.
 */

/** Byte-order mark. Sheets writes one; nothing downstream wants it. */
const BOM = "﻿";

export interface ParsedCsv {
  /** The first non-empty row, trimmed per cell. */
  headers: string[];
  /**
   * Data rows, each already aligned to `headers.length` — short rows are
   * padded with empty strings and long rows keep their extra cells, so a
   * caller indexing by header position can never read past the end.
   */
  rows: string[][];
  /**
   * 1-based line number of each row in the ORIGINAL file, so an error can name
   * the line the user has to go and look at. A quoted field containing
   * newlines makes this diverge from the row index, which is exactly why it is
   * tracked rather than computed.
   */
  lineNumbers: number[];
}

/**
 * Parses CSV text.
 *
 * Never throws on malformed input: an unterminated quote consumes to end of
 * file, which yields a bad final field rather than losing the rows before it.
 * Rejecting the whole file for one stray quote would be worse for a migration
 * than importing 900 good rows and reporting the last one.
 */
export function parseCsv(text: string): ParsedCsv {
  const input = text.startsWith(BOM) ? text.slice(BOM.length) : text;

  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let line = 1;
  let recordStartLine = 1;
  let sawAnyChar = false;

  const endField = () => {
    cells.push(field);
    field = "";
  };

  const endRecord = () => {
    endField();
    // A row of one empty cell is a blank line, not a record.
    if (!(cells.length === 1 && cells[0] === "")) {
      records.push({ cells, line: recordStartLine });
    }
    cells = [];
    recordStartLine = line;
    sawAnyChar = false;
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i] as string;

    if (!sawAnyChar && char !== "\r" && char !== "\n") {
      recordStartLine = line;
      sawAnyChar = true;
    }

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      endField();
      continue;
    }

    if (char === "\r") {
      // CRLF or a lone CR both terminate the record.
      if (input[i + 1] === "\n") i += 1;
      line += 1;
      endRecord();
      continue;
    }

    if (char === "\n") {
      line += 1;
      endRecord();
      continue;
    }

    field += char;
  }

  // A file with no trailing newline still has a final record.
  if (field !== "" || cells.length > 0) endRecord();

  const first = records.shift();
  if (!first) return { headers: [], rows: [], lineNumbers: [] };

  const headers = first.cells.map((cell) => cell.trim());
  const width = headers.length;

  return {
    headers,
    rows: records.map(({ cells: row }) =>
      row.length >= width
        ? row
        : [...row, ...Array<string>(width - row.length).fill("")],
    ),
    lineNumbers: records.map(({ line: at }) => at),
  };
}

/**
 * Quotes a value only when it must be.
 *
 * Leading or trailing whitespace is quoted too: a value of `" 5"` is
 * meaningfully different from `"5"` to whatever reads it next, and an
 * unquoted version would be indistinguishable after a round trip through a
 * parser that trims.
 */
function quote(value: string): string {
  const needsQuoting =
    value.includes(",") ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim();

  return needsQuoting ? `"${value.replaceAll('"', '""')}"` : value;
}

export interface CsvWriteOptions {
  /**
   * Prefix a BOM. Default true: Excel reads a BOM-less UTF-8 CSV as the local
   * 8-bit codepage and mangles every non-ASCII character, and client names in
   * this data set legitimately contain them.
   */
  bom?: boolean;
}

/** Serialises rows, CRLF-terminated as RFC 4180 specifies. */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  options: CsvWriteOptions = {},
): string {
  const lines = [
    headers.map(quote).join(","),
    ...rows.map((row) => row.map(quote).join(",")),
  ];

  return (options.bom === false ? "" : BOM) + lines.join("\r\n") + "\r\n";
}

/**
 * Maps a parsed file's headers onto an expected header list.
 *
 * Matching is on the **exact legacy header string** (migration-plan §3.2), so
 * an unmodified Sheets export needs no hand-editing. Comparison is
 * case-insensitive and whitespace-trimmed, because those are the differences a
 * spreadsheet introduces by accident and never the ones that carry meaning.
 *
 * Returns the column index for each expected header, or -1 when absent — the
 * caller decides whether a missing column is fatal, since several legacy
 * columns are derived and deliberately not imported.
 */
export function mapHeaders(
  actual: readonly string[],
  expected: readonly string[],
): Record<string, number> {
  const normalise = (value: string) => value.trim().toLowerCase();

  const index = new Map<string, number>();
  actual.forEach((header, position) => {
    const key = normalise(header);
    // First occurrence wins: a duplicated column in the export is a mistake,
    // and silently preferring the later one would hide it.
    if (!index.has(key)) index.set(key, position);
  });

  return Object.fromEntries(
    expected.map((header) => [header, index.get(normalise(header)) ?? -1]),
  );
}

/** Reads one cell by header, trimmed. Absent column or short row → "". */
export function cell(
  row: readonly string[],
  columns: Record<string, number>,
  header: string,
): string {
  const at = columns[header];
  if (at === undefined || at < 0) return "";
  return (row[at] ?? "").trim();
}
