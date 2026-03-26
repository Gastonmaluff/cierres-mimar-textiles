export function normalizeKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([0-9])([a-zA-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])([0-9])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function slugify(value) {
  return normalizeKey(value).replace(/\s+/g, "-");
}

export function titleCase(value) {
  return String(value || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function parseMoney(value) {
  if (value === null || value === undefined || value === "") {
    return 0;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  let text = String(value).trim();
  if (!text) {
    return 0;
  }

  const isNegative = text.includes("(") || text.startsWith("-");
  text = text.replace(/[^\d,.-]/g, "");

  if (!text) {
    return 0;
  }

  if (text.includes(",") && text.includes(".")) {
    if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
      text = text.replace(/\./g, "").replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(",")) {
    const parts = text.split(",");
    text =
      parts[parts.length - 1].length <= 2
        ? `${parts.slice(0, -1).join("")}.${parts[parts.length - 1]}`
        : parts.join("");
  } else if (text.includes(".")) {
    const parts = text.split(".");
    text =
      parts[parts.length - 1].length <= 2
        ? `${parts.slice(0, -1).join("")}.${parts[parts.length - 1]}`
        : parts.join("");
  }

  const parsed = Number(text);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return isNegative ? -Math.abs(parsed) : parsed;
}

export function parseNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseFlexibleDate(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  const normalized = text.replace(/\./g, "/").replace(/\s+/g, " ");
  const dateTimeMatch = normalized.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );

  if (dateTimeMatch) {
    const [, day, month, year, hours = "0", minutes = "0", seconds = "0"] = dateTimeMatch;
    const fullYear = year.length === 2 ? `20${year}` : year;
    const date = new Date(
      Number(fullYear),
      Number(month) - 1,
      Number(day),
      Number(hours),
      Number(minutes),
      Number(seconds),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const isoDate = new Date(text);
  return Number.isNaN(isoDate.getTime()) ? null : isoDate;
}

export function buildAliasCandidates(value) {
  const base = normalizeKey(value);
  const stripped = normalizeKey(
    base
      .replace(/\b(pack|promo|combo)\b/g, " ")
      .replace(/\b\d+(?:[.,]\d+)?\s*(x|unid|unidad|unidades|u)\b/g, " ")
      .replace(/\b(x)\s*\d+(?:[.,]\d+)?\b/g, " ")
      .replace(/\bgs\b/g, " "),
  );

  const withoutDecorators = normalizeKey(
    stripped
      .replace(/\bcolor\b/g, " ")
      .replace(/\bmedida\b/g, " ")
      .replace(/\bref\b/g, " "),
  );

  return [...new Set([base, stripped, withoutDecorators].filter(Boolean))];
}

export function sumBy(items, selector) {
  return items.reduce((total, item) => total + (Number(selector(item)) || 0), 0);
}

export function safeArray(value) {
  return Array.isArray(value) ? value : [];
}
