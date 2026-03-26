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
    "descripcion de items",
    "descripcion de item",
    "descripcion",
    "descricion de items",
    "itens",
    "items",
    "item",
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

function getFieldValue(record, fieldName) {
  for (const [header, rawValue] of Object.entries(record)) {
    const normalizedHeader = normalizeKey(header);
    if (FIELD_CANDIDATES[fieldName].some((candidate) => normalizedHeader.includes(candidate))) {
      return rawValue;
    }
  }

  return "";
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

      if ((trimmed.match(/,/g) || []).length && (trimmed.match(/\bx\s*\d+|\d+\s*x\b/gi) || []).length > 1) {
        return trimmed.split(",").map((item) => item.trim());
      }

      return [trimmed];
    })
    .map((segment) => segment.trim())
    .filter(Boolean);
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
  if (!text) {
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
  const normalizedName = normalizeKey(name);

  return {
    id: `sale-${saleIndex}-item-${itemIndex}-${slugify(name || text || "item")}`,
    rawDescription: text,
    name,
    normalizedName,
    quantity: quantity || 1,
    quantityWasExplicit: explicitQuantity,
    detectedSubtotal,
    aliasCandidates: buildAliasCandidates(name || text),
  };
}

export function parseKyteSales(records) {
  return records
    .map((record, index) => {
      const description = getFieldValue(record, "description");
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
        parseMoney(getFieldValue(record, "quantity")) || sumBy(parsedItems, (item) => item.quantity) || 1;
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
        parsedItems:
          parsedItems.length > 0
            ? parsedItems
            : [
                {
                  id: `sale-${index + 1}-item-1-${slugify(description || "item")}`,
                  rawDescription: description,
                  name: description || "Ítem sin descripción",
                  normalizedName: normalizeKey(description || "item"),
                  quantity: fallbackQuantity,
                  quantityWasExplicit: false,
                  detectedSubtotal: subtotal || null,
                  aliasCandidates: buildAliasCandidates(description || "item"),
                },
              ],
        rawRecord: record,
      };
    })
    .filter((sale) => sale.description || sale.total || sale.subtotal);
}
