import {
  buildAliasCandidates,
  normalizeKey,
  parseFlexibleDate,
  parseMoney,
  parseParaguayanMoney,
  slugify,
  sumBy,
} from "./normalizers.js";

const FIELD_CANDIDATES = {
  dateTime: ["fecha hora", "data hora", "date time", "fecha", "data"],
  description: [
    "descri items",
    "descri item",
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
  "total de items",
  "total items",
  "cantidad de items",
];

const FIELD_HEADER_BLOCKLIST = {
  dateTime: ["descri items", "subtotal", "total", "cliente", "vendedor"],
  quantity: ["total de items", "total items", "cantidad de items", "subtotal", "total"],
  subtotal: ["total de items", "total items", "cantidad", "descri items", "ganancia"],
  discount: ["total de items", "total items", "cantidad", "descri items", "ganancia"],
  shipping: ["total de items", "total items", "cantidad", "descri items", "ganancia"],
  total: [
    "total de items",
    "total items",
    "cantidad de items",
    "cantidad",
    "subtotal",
    "descri items",
    "ganancia",
  ],
  paymentMethod: ["descri items", "subtotal", "total"],
  customer: ["descri items", "subtotal", "total"],
  seller: ["descri items", "subtotal", "total"],
  observation: ["descri items", "subtotal", "total"],
};

function getFieldValue(record, fieldName) {
  for (const [header, rawValue] of Object.entries(record)) {
    const normalizedHeader = normalizeKey(header);
    if (FIELD_CANDIDATES[fieldName].some((candidate) => normalizedHeader.includes(candidate))) {
      return rawValue;
    }
  }

  return "";
}

function isMoneyLike(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  return /^-?\d{1,3}(?:[.\s]\d{3})+(?:,\d+)?$/.test(text) || /^\d{4,}$/.test(text);
}

function isQuantityLike(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  return /^\d+$/.test(text);
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

function scoreFieldHeader(fieldName, header, values) {
  const normalizedHeader = normalizeKey(header);
  if (!normalizedHeader || normalizedHeader.startsWith("__")) {
    return Number.NEGATIVE_INFINITY;
  }

  const candidates = FIELD_CANDIDATES[fieldName] || [];
  const blocklist = FIELD_HEADER_BLOCKLIST[fieldName] || [];
  let score = 0;

  if (candidates.includes(normalizedHeader)) {
    score += 220;
  }

  candidates.forEach((candidate) => {
    if (normalizedHeader.startsWith(candidate)) {
      score += 90;
    } else if (normalizedHeader.includes(candidate)) {
      score += 30;
    }
  });

  if (blocklist.includes(normalizedHeader)) {
    score -= 220;
  }

  blocklist.forEach((blocked) => {
    if (normalizedHeader.includes(blocked)) {
      score -= 90;
    }
  });

  const nonEmptyValues = values.map((value) => String(value || "").trim()).filter(Boolean);
  const moneyLikeValues = nonEmptyValues.filter(isMoneyLike);
  const quantityLikeValues = nonEmptyValues.filter(isQuantityLike);
  const textLikeValues = nonEmptyValues.filter((value) => !isNumericLike(value));

  if (["subtotal", "discount", "shipping", "total"].includes(fieldName)) {
    score += moneyLikeValues.length * 10;
    score -= quantityLikeValues.length * 4;
    if (fieldName === "total" && normalizedHeader === "total") {
      score += 200;
    }
    if (fieldName === "subtotal" && normalizedHeader === "subtotal") {
      score += 200;
    }
  }

  if (fieldName === "quantity") {
    score += quantityLikeValues.length * 8;
    score -= moneyLikeValues.length * 6;
  }

  if (["customer", "seller", "paymentMethod", "observation"].includes(fieldName)) {
    score += textLikeValues.length * 4;
    score -= moneyLikeValues.length * 4;
  }

  return score;
}

function detectFieldColumn(records, fieldName) {
  const sampleRecords = records.slice(0, 12);
  const headers = Object.keys(sampleRecords[0] || {}).filter((header) => !header.startsWith("__"));
  const scoredHeaders = headers
    .map((header) => ({
      header,
      score: scoreFieldHeader(
        fieldName,
        header,
        sampleRecords.map((record) => record[header]),
      ),
    }))
    .sort((left, right) => right.score - left.score);

  const bestMatch = scoredHeaders[0];
  if (!bestMatch || bestMatch.score < 20) {
    console.warn(`[kyte-parser] No se detecto una columna confiable para ${fieldName}.`, scoredHeaders);
    return null;
  }

  console.info(
    `[kyte-parser] Columna detectada para ${fieldName}: "${bestMatch.header}" (score ${bestMatch.score.toFixed(
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
  const quantityHeader = detectFieldColumn(records, "quantity");
  const subtotalHeader = detectFieldColumn(records, "subtotal");
  const discountHeader = detectFieldColumn(records, "discount");
  const shippingHeader = detectFieldColumn(records, "shipping");
  const totalHeader = detectFieldColumn(records, "total");
  const dateTimeHeader = detectFieldColumn(records, "dateTime");
  const paymentMethodHeader = detectFieldColumn(records, "paymentMethod");
  const customerHeader = detectFieldColumn(records, "customer");
  const sellerHeader = detectFieldColumn(records, "seller");
  const observationHeader = detectFieldColumn(records, "observation");

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

      const fallbackQuantity = parseMoney(
        quantityHeader ? record[quantityHeader] : getFieldValue(record, "quantity"),
      ) || 1;
      const subtotal = parseParaguayanMoney(
        subtotalHeader ? record[subtotalHeader] : getFieldValue(record, "subtotal"),
      );
      const discount = parseParaguayanMoney(
        discountHeader ? record[discountHeader] : getFieldValue(record, "discount"),
      );
      const shipping = parseParaguayanMoney(
        shippingHeader ? record[shippingHeader] : getFieldValue(record, "shipping"),
      );
      const totalValue = parseParaguayanMoney(
        totalHeader ? record[totalHeader] : getFieldValue(record, "total"),
      );
      const total = totalValue || subtotal - discount + shipping;
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
      const dateTime = parseFlexibleDate(
        dateTimeHeader ? record[dateTimeHeader] : getFieldValue(record, "dateTime"),
      );
      const totalQuantity =
        parseMoney(quantityHeader ? record[quantityHeader] : getFieldValue(record, "quantity")) ||
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
        paymentMethod: paymentMethodHeader
          ? record[paymentMethodHeader]
          : getFieldValue(record, "paymentMethod"),
        customer: customerHeader ? record[customerHeader] : getFieldValue(record, "customer"),
        seller: sellerHeader ? record[sellerHeader] : getFieldValue(record, "seller"),
        observation: observationHeader
          ? record[observationHeader]
          : getFieldValue(record, "observation"),
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
