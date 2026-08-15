import { describe, expect, it } from "vitest";

import { cell, mapHeaders, parseCsv, toCsv } from "@/lib/domain/csv";

describe("parseCsv", () => {
  it("reads headers and rows", () => {
    const parsed = parseCsv("A,B,C\n1,2,3\n4,5,6");
    expect(parsed.headers).toEqual(["A", "B", "C"]);
    expect(parsed.rows).toEqual([
      ["1", "2", "3"],
      ["4", "5", "6"],
    ]);
  });

  it("strips the BOM Google Sheets writes", () => {
    // Left in place, the first header reads "﻿Client ID", matches
    // nothing, and EVERY column silently fails to map.
    const parsed = parseCsv("﻿Client ID,Client Name\nCL-0001,Acme");
    expect(parsed.headers[0]).toBe("Client ID");
  });

  it("handles CRLF, LF, and a lone CR", () => {
    for (const [name, newline] of [
      ["CRLF", "\r\n"],
      ["LF", "\n"],
      ["CR", "\r"],
    ] as const) {
      const parsed = parseCsv(`A,B${newline}1,2${newline}3,4`);
      expect(parsed.rows, name).toEqual([
        ["1", "2"],
        ["3", "4"],
      ]);
    }
  });

  it("keeps a comma inside a quoted field", () => {
    // Real legacy sample data: 'Multi-location retailer, 4 storefronts.'
    const parsed = parseCsv('A,B\n"Multi-location retailer, 4 storefronts.",x');
    expect(parsed.rows[0]).toEqual([
      "Multi-location retailer, 4 storefronts.",
      "x",
    ]);
  });

  it("unescapes a doubled quote", () => {
    const parsed = parseCsv('A\n"She said ""yes"""');
    expect(parsed.rows[0]?.[0]).toBe('She said "yes"');
  });

  it("keeps a newline inside a quoted field", () => {
    const parsed = parseCsv('A,B\n"line one\nline two",x');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.[0]).toBe("line one\nline two");
  });

  it("reports the ORIGINAL line number even after a multi-line field", () => {
    // What the operator has to go and look at. A row index would be wrong
    // here by exactly the number of embedded newlines above it.
    const parsed = parseCsv('A\n"one\ntwo"\nthree');
    expect(parsed.lineNumbers).toEqual([2, 4]);
  });

  it("skips blank lines without counting them as rows", () => {
    const parsed = parseCsv("A,B\n1,2\n\n3,4\n");
    expect(parsed.rows).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("pads a short row to the header width", () => {
    // So a caller indexing by header position can never read past the end.
    const parsed = parseCsv("A,B,C\n1,2");
    expect(parsed.rows[0]).toEqual(["1", "2", ""]);
  });

  it("keeps the extra cells of a long row", () => {
    const parsed = parseCsv("A,B\n1,2,3");
    expect(parsed.rows[0]).toEqual(["1", "2", "3"]);
  });

  it("handles a final row with no trailing newline", () => {
    expect(parseCsv("A\n1").rows).toEqual([["1"]]);
  });

  it("returns nothing for an empty file", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [], lineNumbers: [] });
    expect(parseCsv("\n\n")).toEqual({ headers: [], rows: [], lineNumbers: [] });
  });

  it("returns headers and no rows for a header-only file", () => {
    const parsed = parseCsv("A,B\n");
    expect(parsed.headers).toEqual(["A", "B"]);
    expect(parsed.rows).toEqual([]);
  });

  it("does not lose earlier rows to an unterminated quote", () => {
    // 900 good rows and one bad one is a far better outcome for a migration
    // than rejecting the file.
    const parsed = parseCsv('A\n1\n2\n"unterminated');
    expect(parsed.rows.slice(0, 2)).toEqual([["1"], ["2"]]);
    expect(parsed.rows).toHaveLength(3);
  });

  it("trims header whitespace but not cell whitespace", () => {
    const parsed = parseCsv("  A  ,B\n  x  ,y");
    expect(parsed.headers).toEqual(["A", "B"]);
    // Cells are trimmed at read time by `cell`, not here — the raw value is
    // preserved so a caller that needs it can have it.
    expect(parsed.rows[0]?.[0]).toBe("  x  ");
  });

  it("treats a bare quote inside an unquoted field as literal", () => {
    const parsed = parseCsv('A\n5" pipe');
    expect(parsed.rows[0]?.[0]).toBe('5" pipe');
  });
});

describe("toCsv", () => {
  it("writes a BOM and CRLF by default", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿A,B\r\n1,2\r\n");
  });

  it("can omit the BOM", () => {
    expect(toCsv(["A"], [["1"]], { bom: false })).toBe("A\r\n1\r\n");
  });

  it("quotes only what needs it", () => {
    const csv = toCsv(
      ["A", "B", "C", "D"],
      [["plain", "has,comma", 'has"quote', "has\nnewline"]],
      { bom: false },
    );
    expect(csv).toBe(
      'A,B,C,D\r\nplain,"has,comma","has""quote","has\nnewline"\r\n',
    );
  });

  it("quotes a value with leading or trailing whitespace", () => {
    // " 5" and "5" are different values; unquoted they survive a round trip
    // through a trimming parser as the same one.
    expect(toCsv(["A"], [[" 5"]], { bom: false })).toBe('A\r\n" 5"\r\n');
  });

  it("writes a headers-only file when there are no rows", () => {
    expect(toCsv(["A", "B"], [], { bom: false })).toBe("A,B\r\n");
  });
});

describe("round trip", () => {
  const awkward = [
    ["Multi-location retailer, 4 storefronts.", 'He said "no"'],
    ["line one\nline two", "  padded  "],
    ["", "trailing,"],
    ['"', ","],
  ];

  it("survives every awkward value", () => {
    const csv = toCsv(["A", "B"], awkward);
    const parsed = parseCsv(csv);

    expect(parsed.headers).toEqual(["A", "B"]);
    expect(parsed.rows).toEqual(awkward);
  });

  it("survives a value that is only whitespace", () => {
    const csv = toCsv(["A"], [["   "]]);
    expect(parseCsv(csv).rows[0]?.[0]).toBe("   ");
  });
});

describe("mapHeaders", () => {
  const expected = ["Client ID", "Client Name", "Notes"];

  it("maps on the exact legacy header string", () => {
    const columns = mapHeaders(["Client ID", "Client Name", "Notes"], expected);
    expect(columns).toEqual({
      "Client ID": 0,
      "Client Name": 1,
      Notes: 2,
    });
  });

  it("tolerates case and whitespace — what a spreadsheet changes by accident", () => {
    const columns = mapHeaders(["  client id ", "CLIENT NAME", "notes"], expected);
    expect(columns["Client ID"]).toBe(0);
    expect(columns["Client Name"]).toBe(1);
    expect(columns.Notes).toBe(2);
  });

  it("reports an absent column as -1 rather than guessing", () => {
    const columns = mapHeaders(["Client ID"], expected);
    expect(columns["Client ID"]).toBe(0);
    expect(columns["Client Name"]).toBe(-1);
  });

  it("finds columns in any order", () => {
    const columns = mapHeaders(["Notes", "Client Name", "Client ID"], expected);
    expect(columns["Client ID"]).toBe(2);
    expect(columns.Notes).toBe(0);
  });

  it("ignores columns the contract does not name", () => {
    const columns = mapHeaders(
      ["Extra", "Client ID", "Another"],
      ["Client ID"],
    );
    expect(columns).toEqual({ "Client ID": 1 });
  });

  it("keeps the FIRST of a duplicated column", () => {
    // A duplicate is an export mistake; silently preferring the later one
    // would hide it.
    const columns = mapHeaders(["Notes", "Notes"], ["Notes"]);
    expect(columns.Notes).toBe(0);
  });
});

describe("cell", () => {
  const columns = { A: 0, B: 1, Missing: -1 };

  it("reads by header and trims", () => {
    expect(cell(["  x  ", "y"], columns, "A")).toBe("x");
    expect(cell(["x", "y"], columns, "B")).toBe("y");
  });

  it("returns empty for an absent column or a short row", () => {
    expect(cell(["x"], columns, "Missing")).toBe("");
    expect(cell(["x"], columns, "B")).toBe("");
    expect(cell(["x"], columns, "Nope")).toBe("");
  });
});
