export function buildExportPayload(closure) {
  if (!closure) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    supportedFormats: ["pdf", "excel"],
    closure: {
      id: closure.id,
      name: closure.closureName,
      date: closure.closureDate,
      sourceFileName: closure.sourceFileName,
    },
    summary: closure.metrics,
    providerSummary: closure.providerSummary,
    partnerSummary: closure.partnerSummary,
    adjustments: closure.manualAdjustments,
    sales: closure.sales.map((sale) => ({
      saleId: sale.id,
      sourceRowNumber: sale.sourceRowNumber,
      dateTime: sale.dateTime,
      customer: sale.customer,
      seller: sale.seller,
      paymentMethod: sale.paymentMethod,
      observation: sale.observation,
      adjustedRevenue: sale.adjustedRevenue,
      adjustedCost: sale.adjustedCost,
      adjustedProfit: sale.adjustedProfit,
      items: sale.parsedItems.map((item) => ({
        itemId: item.id,
        name: item.name,
        quantity: item.quantity,
        productBaseName: item.productBaseName,
        provider: item.provider,
        adjustedRevenue: item.adjustedRevenue,
        adjustedCost: item.adjustedCost,
        providerPayable: item.providerPayable,
        mariaShare: item.mariaShare,
        gastonShare: item.gastonShare,
      })),
    })),
  };
}
