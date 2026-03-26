function detectDelimiter(text) {
  const sampleLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!sampleLine) {
    return ",";
  }

  const candidates = [",", ";", "\t"];
  let bestDelimiter = ",";
  let bestCount = 0;

  for (const delimiter of candidates) {
    const count = sampleLine.split(delimiter).length;
    if (count > bestCount) {
      bestDelimiter = delimiter;
      bestCount = count;
    }
  }

  return bestDelimiter;
}

export function parseCsv(text) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (!source.trim()) {
    return [];
  }

  const delimiter = detectDelimiter(source);
  const rows = [];
  let currentRow = [];
  let currentField = "";
  let inQuotes = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];

    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && character === delimiter) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (!inQuotes && character === "\n") {
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = "";
      continue;
    }

    if (character !== "\r") {
      currentField += character;
    }
  }

  currentRow.push(currentField);
  rows.push(currentRow);

  const [headerRow, ...dataRows] = rows.filter((row) => row.some((field) => String(field || "").trim()));
  if (!headerRow) {
    return [];
  }

  const headers = headerRow.map((header) => String(header || "").trim());

  return dataRows.map((row, rowIndex) => {
    const record = { __rowNumber: rowIndex + 2 };
    headers.forEach((header, headerIndex) => {
      record[header] = String(row[headerIndex] || "").trim();
    });
    return record;
  });
}
