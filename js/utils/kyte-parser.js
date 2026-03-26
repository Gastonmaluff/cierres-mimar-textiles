import {
  buildAliasCandidates,
  normalizeKey,
  parseFlexibleDate,
  parseMoney,
  slugify,
  sumBy,
} from "./normalizers.js";

const FIELD_CANDIDATES = {
  dateTime: ["fecha hora", "data hora", "date time", "fecha", "data"],
  description: [
    "descripcion de productos",
    "descripcion de items",
    "descripcion de item",
    "descripcion",
    "detalle de productos",
    "detalle de venta",
    "detalle",
    "descricion de items",
    "itens",
    "items",
    "productos",
    "produto",
    "producto",
    "product",
  ],
  quantity: ["cantidad", "quantidade", "qty", "qtd"],
  subtotal: ["subtotal", "sub total"],
  discount: ["descuento", "desconto", "discount"],
  shipping: ["envio", "entrega", "shipping", "frete"],
  total: ["total", "valor total"],
  paymentMethod: ["forma de pago", "forma de pagamento", "payment", "metodo de pago"],
  customer: ["cliente", "customer"],
  seller: ["vendedor", "seller", "atendente"],
  observation: ["observacion", "observacao", "observation", "nota", "nota interna"],
};

const DESCRIPTION_HEADER_BLOCKLIST = [
  "id",
  "indice",
  "index",
  "contador",
  "count",
  "codigo",
  "code",
  "sku",
  "numero",
  "nro",
  "item id",
  "order id",
];

function getFieldValue(record, fieldName) {
  for (const [header, rawValue] of Object.entries(record)) {
    const normalizedHeader = normalizeKey(header);
    if (FIELD_CANDIDATES[fieldName].some((candidate) => normalizedHeader.includes(candidate))) {
      return rawValue;
    }
  }

  return "";
}

function isNumericLike(value) {
  const text = String(value || "").trim();
  return Boolean(text) && /^[\d\s.,\-]+$/.test(text);
}

function hasUsefulLetters(value) {
  return /[a-z]/i.test(String(value || ""));
}

function isMeaningfulDescription(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  if (isNumericLike(text)) {
    return false;
  }

  if (!hasUsefulLetters(text)) {
    return false;
  }

  return normalizeKey(text).length >= 3;
}

function scoreDescriptionHeader(header, values) {
  const normalizedHeader = normalizeKey(header);
  if (!normalizedHeader || normalizedHeader.startsWith("__")) {
    return Number.NEGATIVE_INFINITY;
  }

  let score = 0;

  if (FIELD_CANDIDATES.description.some((candidate) => normalizedHeader === candidate)) {
    score += 120;
  }

  FIELD_CANDIDATES.description.forEach((candidate) => {
    if (normalizedHeader.includes(candidate)) {
      score += 35;
    }
  });

  if (DESCRIPTION_HEADER_BLOCKLIST.some((blocked) => normalizedHeader === blocked)) {
    score -= 140;
  }

  if (DESCRIPTION_HEADER_BLOCKLIST.some((blocked) => normalizedHeader.includes(blocked))) {
    score -= 70;
  }

  const nonEmptyValues = values.map((value) => String(value || "").trim()).filter(Boolean);
  const meaningfulValues = nonEmptyValues.filter(isMeaningfulDescription);
  const numericValues = nonEmptyValues.filter(isNumericLike);
  const quantityPatternValues = nonEmptyValues.filter((value) =>
    /(\d+(?:[.,]\d+)?)\s*x\s+[^\d]|[^\d].*?\s*x\s*(\d+(?:[.,]\d+)?)/i.test(value),
  );

  score += meaningfulValues.length * 8;
  score += quantityPatternValues.length * 12;
  score -= numericValues.length * 14;

  if (nonEmptyValues.length > 0) {
    score += (meaningfulValues.length / nonEmptyValues.length) * 30;
    score -= (numericValues.length / nonEmptyValues.length) * 40;
  }

  return score;
}

function detectDescriptionColumn(records) {
  const sampleRecords = records.slice(0, 12);
  const headers = Object.keys(sampleRecords[0] || {}).filter((header) => !header.startsWith("__"));
  const scoredHeaders = headers
    .map((header) => ({
      header,
      score: scoreDescriptionHeader(
        header,
        sampleRecords.map((record) => record[header]),
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredHeaders[0];
  if (!bestMatch || bestMatch.score < 20) {
    console.warn("[kyte-parser] No se detecto una columna confiable para descripcion.", scoredHeaders);
    return null;
  }

  console.info(
    `[kyte-parser] Columna de descripcion detectada: "${bestMatch.header}" (score ${bestMatch.score.toFixed(
      1,
    )})`,
  );

  return bestMatch.header;
}

function normalizeDescription(description) {
  return String(description || "")
    .replace(/\r/g, "\n")
    .replace(/\u2022/g, "\n")
    .replace(/\s+\|\s+/g, "\n")
    .replace(/\s+\/\s+/g, "\n")
    .replace(/\s+\+\s+/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function splitDescriptionIntoSegments(description) {
  const normalized = normalizeDescription(description);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n|;+/)
    .flatMap((segment) => {
      const trimmed = segment.trim();

      if ((trimmed.match(/\b\d+(?:[.,]\d+)?\s*x\b/gi) || []).length > 1) {
        return [...trimmed.matchAll(/(\d+(?:[.,]\d+)?)\s*x\s*(.*?)(?=(?:\s+\d+(?:[.,]\d+)?\s*x\s+)|$)/gi)]
          .map((match) => `${match[1]}x ${match[2]}`.trim())
          .filter(Boolean);
      }

      if (
        (trimmed.match(/,/g) || []).length &&
        (trimmed.match(/\bx\s*\d+|\d+\s*x\b/gi) || []).length > 1
      ) {
        return trimmed.split(",").map((item) => item.trim());
      }

      if ((trimmed.match(/,/g) || []).length) {
        const commaParts = trimmed
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

        if (commaParts.length > 1 && commaParts.every(isMeaningfulDescription)) {
          return commaParts;
        }
      }

      return [trimmed];
    })
    .map((segment) => segment.trim())
    .filter(isMeaningfulDescription);
}

function extractDetectedSubtotal(segment) {
  const subtotalMatch =
    segment.match(/(?:gs\.?\s*|=|@)\s*(\d{1,3}(?:[.\s]\d{3})+|\d{4,})(?!\s*(?:cm|mm))/i) ||
    segment.match(/\b(\d{1,3}(?:[.\s]\d{3})+|\d{4,})\s*(?:gs|guaranies)?\b/i);

  return subtotalMatch ? parseMoney(subtotalMatch[1]) : null;
}

function cleanItemName(segment) {
  return segment
    .replace(/(?:gs\.?\s*|=|@)\s*\d{1,3}(?:[.\s]\d{3})+|\d{4,}\s*(?:gs|guaranies)?/gi, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\-,:]+|[\-,:]+$/g, "")
    .trim();
}

function parseItemSegment(segment, fallbackQuantity = 1, saleIndex = 0, itemIndex = 0) {
  const text = String(segment || "").trim();
  if (!isMeaningfulDescription(text)) {
    return null;
  }

  let quantity = fallbackQuantity || 1;
  let explicitQuantity = false;
  let working = text;

  const packMatch = working.match(/^pack\s*(\d+(?:[.,]\d+)?)\s*x?\s+(.+)$/i);
  if (packMatch) {
    quantity = parseMoney(packMatch[1]);
    working = packMatch[2];
    explicitQuantity = true;
  }

  if (!explicitQuantity) {
    const quantityAtStart = working.match(/^(\d+(?:[.,]\d+)?)\s*x\s*(.+)$/i);
    const quantityAtEnd = working.match(/^(.+?)\s*x\s*(\d+(?:[.,]\d+)?)$/i);
    const quantityInParentheses = working.match(/^(.+?)\s*\((\d+(?:[.,]\d+)?)\)\s*$/i);

    if (quantityAtStart) {
      quantity = parseMoney(quantityAtStart[1]);
      working = quantityAtStart[2];
      explicitQuantity = true;
    } else if (quantityAtEnd) {
      quantity = parseMoney(quantityAtEnd[2]);
      working = quantityAtEnd[1];
      explicitQuantity = true;
    } else if (quantityInParentheses) {
      quantity = parseMoney(quantityInParentheses[2]);
      working = quantityInParentheses[1];
      explicitQuantity = true;
    }
  }

  const detectedSubtotal = extractDetectedSubtotal(working);
  const name = cleanItemName(working);

  if (!isMeaningfulDescription(name)) {
    return null;
  }

  return {
    id: `sale-${saleIndex}-item-${itemIndex}-${slugify(name || text || "item")}`,
    rawDescription: text,
    name,
    normalizedName: normalizeKey(name),
    quantity: quantity || 1,
    quantityWasExplicit: explicitQuantity,
    detectedSubtotal,
    aliasCandidates: buildAliasCandidates(name || text),
  };
}

export function parseKyteSales(records) {
  const descriptionHeader = detectDescriptionColumn(records);

  return records
    .map((record, index) => {
      const description = descriptionHeader
        ? String(record[descriptionHeader] || "").trim()
        : getFieldValue(record, "description");

      console.info(
        `[kyte-parser] Fila ${record.__rowNumber || index + 2}: texto extraido de "${
          descriptionHeader || "fallback"
        }" =>`,
        description,
      );

      const fallbackQuantity = parseMoney(getFieldValue(record, "quantity")) || 1;
      const subtotal = parseMoney(getFieldValue(record, "subtotal"));
      const discount = parseMoney(getFieldValue(record, "discount"));
      const shipping = parseMoney(getFieldValue(record, "shipping"));
      const total =
        parseMoney(getFieldValue(record, "total")) || subtotal - discount + shipping;
      const segments = splitDescriptionIntoSegments(description);
      const parsedItems = segments
        .map((segment, itemIndex) =>
          parseItemSegment(
            segment,
            segments.length === 1 ? fallbackQuantity : 1,
            index + 1,
            itemIndex + 1,
          ),
        )
        .filter(Boolean);
      const dateTime = parseFlexibleDate(getFieldValue(record, "dateTime"));
      const totalQuantity =
        parseMoney(getFieldValue(record, "quantity")) ||
        sumBy(parsedItems, (item) => item.quantity) ||
        1;
      const saleId = `sale-${index + 1}-${slugify(
        `${dateTime?.toISOString() || index}-${description}-${getFieldValue(record, "customer")}`,
      )}`;

      return {
        id: saleId,
        sourceRowNumber: record.__rowNumber || index + 2,
        dateTime: dateTime ? dateTime.toISOString() : "",
        description,
        quantity: totalQuantity,
        subtotal,
        discount,
        shipping,
        total,
        paymentMethod: getFieldValue(record, "paymentMethod"),
        customer: getFieldValue(record, "customer"),
        seller: getFieldValue(record, "seller"),
        observation: getFieldValue(record, "observation"),
        parsedItems: parsedItems.length > 0 ? parsedItems : [],
        rawRecord: record,
      };
    })
    .filter(
      (sale) =>
        (isMeaningfulDescription(sale.description) && sale.parsedItems.length > 0) ||
        sale.total ||
        sale.subtotal,
    );
}
