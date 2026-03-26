import {
  buildAliasCandidates,
  normalizeKey,
  safeArray,
  slugify,
  sumBy,
} from "./normalizers.js";

function buildProductIndex(products, aliases) {
  const productMap = new Map();
  const productNameMap = new Map();
  const aliasMap = new Map();

  safeArray(products).forEach((product) => {
    const normalizedName = normalizeKey(product.baseName);
    const normalizedProduct = {
      ...product,
      normalizedName,
      realUnitCost: Number(product.realUnitCost) || 0,
      mariaShareValue: Number(product.mariaShareValue) || 0,
      gastonShareValue: Number(product.gastonShareValue) || 0,
    };

    productMap.set(product.id, normalizedProduct);
    productNameMap.set(normalizedName, normalizedProduct);
  });

  safeArray(aliases).forEach((alias) => {
    const normalizedAlias = alias.normalizedAlias || normalizeKey(alias.alias);
    aliasMap.set(normalizedAlias, {
      ...alias,
      normalizedAlias,
      product: productMap.get(alias.productId),
    });
  });

  return { productMap, productNameMap, aliasMap };
}

function resolveProduct(item, productIndex) {
  const candidates = [
    item.normalizedName,
    ...buildAliasCandidates(item.name),
    ...safeArray(item.aliasCandidates),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const aliasMatch = productIndex.aliasMap.get(candidate);
    if (aliasMatch?.product) {
      return { product: aliasMatch.product, matchType: "alias", matchedKey: candidate };
    }

    const productMatch = productIndex.productNameMap.get(candidate);
    if (productMatch) {
      return { product: productMatch, matchType: "product_name", matchedKey: candidate };
    }
  }

  const heuristicMatches = [...productIndex.productMap.values()].filter((product) =>
    candidates.some(
      (candidate) =>
        candidate.length >= 8 &&
        (candidate.includes(product.normalizedName) || product.normalizedName.includes(candidate)),
    ),
  );

  if (heuristicMatches.length === 1) {
    return {
      product: heuristicMatches[0],
      matchType: "heuristic",
      matchedKey: heuristicMatches[0].normalizedName,
    };
  }

  return { product: null, matchType: "unmapped", matchedKey: item.normalizedName };
}

function determineWeights(items) {
  const explicitSubtotalTotal = items.reduce(
    (total, item) => total + (Number(item.detectedSubtotal) || 0),
    0,
  );

  if (explicitSubtotalTotal > 0) {
    return items.map((item) => (Number(item.detectedSubtotal) || 0) / explicitSubtotalTotal);
  }

  const quantityTotal = items.reduce((total, item) => total + (Number(item.quantity) || 0), 0);
  if (quantityTotal > 0) {
    return items.map((item) => (Number(item.quantity) || 0) / quantityTotal);
  }

  return items.map(() => 1 / (items.length || 1));
}

function calculatePartnerShare(product, partnerKey, adjustedRevenue, adjustedCost, profit, quantity) {
  if (!product) {
    return 0;
  }

  const value = Number(product[partnerKey]) || 0;
  switch (product.allocationType) {
    case "sale_percentage":
      return adjustedRevenue * (value / 100);
    case "fixed_amount":
      return value * (Number(quantity) || 0);
    case "profit_percentage":
    default:
      return profit * (value / 100);
  }
}

function collectUnmapped(unmappedMap, item, saleId) {
  const key = item.normalizedName || normalizeKey(item.name);
  if (!unmappedMap.has(key)) {
    unmappedMap.set(key, {
      normalizedKey: key,
      primaryLabel: item.name,
      rawLabels: new Set([item.name]),
      occurrences: 0,
      quantity: 0,
      sales: new Set(),
    });
  }

  const group = unmappedMap.get(key);
  group.occurrences += 1;
  group.quantity += Number(item.quantity) || 0;
  group.rawLabels.add(item.name);
  group.sales.add(saleId);
}

export function buildClosure({
  sales,
  products,
  aliases,
  manualAdjustments = [],
  closureDate,
  closureName,
  sourceFileName,
}) {
  const productIndex = buildProductIndex(products, aliases);
  const providerMap = new Map();
  const unmappedMap = new Map();
  const saleAdjustmentsMap = new Map();
  const itemAdjustmentsMap = new Map();

  safeArray(manualAdjustments).forEach((adjustment) => {
    const targetMap = adjustment.scope === "item" ? itemAdjustmentsMap : saleAdjustmentsMap;
    const bucket = targetMap.get(adjustment.targetId) || [];
    bucket.push({
      ...adjustment,
      revenueDelta: Number(adjustment.revenueDelta) || 0,
      costDelta: Number(adjustment.costDelta) || 0,
    });
    targetMap.set(adjustment.targetId, bucket);
  });

  let totalRevenue = 0;
  let totalCost = 0;
  let totalProviders = 0;
  let totalMaria = 0;
  let totalGaston = 0;
  let totalMappedItems = 0;
  let totalUnmappedItems = 0;

  const detailedSales = safeArray(sales).map((sale) => {
    const saleAdjustments = saleAdjustmentsMap.get(sale.id) || [];
    const saleRevenueAdjustment = sumBy(saleAdjustments, (item) => item.revenueDelta);
    const saleCostAdjustment = sumBy(saleAdjustments, (item) => item.costDelta);
    const weights = determineWeights(sale.parsedItems || []);

    const parsedItems = safeArray(sale.parsedItems).map((item, index) => {
      const resolution = resolveProduct(item, productIndex);
      const product = resolution.product;
      const weight = weights[index] || 0;
      const itemAdjustments = itemAdjustmentsMap.get(item.id) || [];
      const itemRevenueAdjustment = sumBy(itemAdjustments, (entry) => entry.revenueDelta);
      const itemCostAdjustment = sumBy(itemAdjustments, (entry) => entry.costDelta);
      const adjustedRevenue =
        (Number(sale.total) || 0) * weight +
        saleRevenueAdjustment * weight +
        itemRevenueAdjustment;
      const baseCost = product ? product.realUnitCost * (Number(item.quantity) || 0) : 0;
      const adjustedCost =
        baseCost + saleCostAdjustment * weight + itemCostAdjustment;
      const providerPayable = baseCost + itemCostAdjustment;
      const profit = adjustedRevenue - adjustedCost;
      const mariaShare = calculatePartnerShare(
        product,
        "mariaShareValue",
        adjustedRevenue,
        adjustedCost,
        profit,
        item.quantity,
      );
      const gastonShare = calculatePartnerShare(
        product,
        "gastonShareValue",
        adjustedRevenue,
        adjustedCost,
        profit,
        item.quantity,
      );

      if (product) {
        totalMappedItems += 1;
        const providerKey = product.provider || "Sin proveedor";
        const current = providerMap.get(providerKey) || {
          provider: providerKey,
          totalRevenue: 0,
          totalCost: 0,
          totalProfit: 0,
          totalQuantity: 0,
          payable: 0,
        };

        current.totalRevenue += adjustedRevenue;
        current.totalCost += providerPayable;
        current.totalProfit += profit;
        current.totalQuantity += Number(item.quantity) || 0;
        current.payable += providerPayable;
        providerMap.set(providerKey, current);
      } else {
        totalUnmappedItems += 1;
        collectUnmapped(unmappedMap, item, sale.id);
      }

      totalMaria += mariaShare;
      totalGaston += gastonShare;

      return {
        ...item,
        productId: product?.id || null,
        productBaseName: product?.baseName || "",
        provider: product?.provider || "",
        realUnitCost: product?.realUnitCost || 0,
        allocationType: product?.allocationType || "",
        matchType: resolution.matchType,
        adjustedRevenue,
        adjustedCost,
        providerPayable,
        profit,
        mariaShare,
        gastonShare,
        itemAdjustments,
      };
    });

    const adjustedRevenue = sumBy(parsedItems, (item) => item.adjustedRevenue);
    const adjustedCost = sumBy(parsedItems, (item) => item.adjustedCost);
    const adjustedProfit = adjustedRevenue - adjustedCost;

    totalRevenue += adjustedRevenue;
    totalCost += adjustedCost;
    totalProviders += sumBy(parsedItems, (item) => item.providerPayable);

    return {
      ...sale,
      parsedItems,
      saleAdjustments,
      adjustedRevenue,
      adjustedCost,
      adjustedProfit,
    };
  });

  const providerSummary = [...providerMap.values()].sort((a, b) =>
    a.provider.localeCompare(b.provider, "es"),
  );
  const partnerSummary = [
    { partner: "Gastón", total: totalGaston, basis: "según reglas por producto" },
    { partner: "María", total: totalMaria, basis: "según reglas por producto" },
  ];
  const unmappedProducts = [...unmappedMap.values()]
    .map((group) => ({
      normalizedKey: group.normalizedKey,
      primaryLabel: group.primaryLabel,
      rawLabels: [...group.rawLabels],
      occurrences: group.occurrences,
      quantity: group.quantity,
      salesCount: group.sales.size,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    id: `closure-${slugify(`${closureDate || new Date().toISOString()}-${closureName || sourceFileName || "csv"}`)}`,
    closureDate: closureDate || new Date().toISOString().slice(0, 10),
    closureName: closureName || "Cierre sin nombre",
    sourceFileName: sourceFileName || "archivo.csv",
    metrics: {
      totalRevenue,
      totalCost,
      totalProfit: totalRevenue - totalCost,
      totalMaria,
      totalGaston,
      totalProviders,
      totalMappedItems,
      totalUnmappedItems,
    },
    providerSummary,
    partnerSummary,
    unmappedProducts,
    sales: detailedSales,
    manualAdjustments: safeArray(manualAdjustments),
  };
}

export function buildAdjustmentTargets(closure) {
  if (!closure) {
    return { saleTargets: [], itemTargets: [] };
  }

  return {
    saleTargets: closure.sales.map((sale) => ({
      id: sale.id,
      label: `${sale.customer || "Sin cliente"} · fila ${sale.sourceRowNumber} · ${sale.description || "Venta"}`,
    })),
    itemTargets: closure.sales.flatMap((sale) =>
      sale.parsedItems.map((item) => ({
        id: item.id,
        label: `${item.name} · fila ${sale.sourceRowNumber} · ${sale.customer || "Sin cliente"}`,
      })),
    ),
  };
}
