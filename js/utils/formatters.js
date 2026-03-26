const currencyFormatter = new Intl.NumberFormat("es-PY", {
  style: "currency",
  currency: "PYG",
  maximumFractionDigits: 0,
});

const percentFormatter = new Intl.NumberFormat("es-PY", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatCurrency(value) {
  return currencyFormatter.format(Number(value) || 0);
}

export function formatNumber(value) {
  return new Intl.NumberFormat("es-PY").format(Number(value) || 0);
}

export function formatPercent(value) {
  return `${percentFormatter.format(Number(value) || 0)}%`;
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-PY", { dateStyle: "medium" }).format(date);
}

export function formatDateTime(value) {
  if (!value) {
    return "-";
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("es-PY", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatAllocationRule(product) {
  if (!product) {
    return "Sin configuración";
  }

  const labels = {
    profit_percentage: "sobre utilidad",
    sale_percentage: "sobre venta",
    fixed_amount: "monto fijo por unidad",
  };

  const suffix =
    product.allocationType === "fixed_amount"
      ? formatCurrency(product.mariaShareValue || 0)
      : formatPercent(product.mariaShareValue || 0);

  return `${labels[product.allocationType] || product.allocationType} · María ${suffix}`;
}
