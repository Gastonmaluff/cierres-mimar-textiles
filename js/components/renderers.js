import { formatCurrency, formatDate, formatDateTime, formatNumber } from "../utils/formatters.js";
import { titleCase } from "../utils/normalizers.js";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function createProductOptions(products) {
  return products
    .map(
      (product) =>
        `<option value="${escapeHtml(product.id)}">${escapeHtml(product.baseName)}</option>`,
    )
    .join("");
}

export function renderDashboard(metrics) {
  const safeMetrics = metrics || {
    totalRevenue: 0,
    totalCost: 0,
    totalProfit: 0,
    totalGaston: 0,
    totalMaria: 0,
    totalProviders: 0,
  };

  const cards = [
    ["Facturación total", formatCurrency(safeMetrics.totalRevenue), "Ingresos reales del cierre"],
    ["Costo real total", formatCurrency(safeMetrics.totalCost), "Basado en tu tabla maestra"],
    ["Utilidad real total", formatCurrency(safeMetrics.totalProfit), "Venta menos costo y ajustes"],
    ["Total Gastón", formatCurrency(safeMetrics.totalGaston), "Según reglas por producto"],
    ["Total María", formatCurrency(safeMetrics.totalMaria), "Según reglas por producto"],
    ["Total proveedores", formatCurrency(safeMetrics.totalProviders), "Total a pagar a proveedores"],
  ];

  return cards
    .map(
      ([label, value, helper]) => `
        <article class="metric-card">
          <p class="label">${label}</p>
          <p class="value">${value}</p>
          <p class="helper">${helper}</p>
        </article>
      `,
    )
    .join("");
}

export function renderProviderSummary(rows) {
  if (!rows?.length) {
    return "No hay productos mapeados todavía, así que el resumen por proveedor sigue vacío.";
  }

  const body = rows
    .map(
      (row) => `
        <tr>
          <td data-label="Proveedor"><strong>${escapeHtml(row.provider)}</strong></td>
          <td data-label="Cantidad">${formatNumber(row.totalQuantity)}</td>
          <td data-label="Venta">${formatCurrency(row.totalRevenue)}</td>
          <td data-label="Costo">${formatCurrency(row.totalCost)}</td>
          <td data-label="Utilidad">${formatCurrency(row.totalProfit)}</td>
          <td data-label="A pagar">${formatCurrency(row.payable)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Proveedor</th>
            <th>Cantidad</th>
            <th>Venta asociada</th>
            <th>Costo real</th>
            <th>Utilidad</th>
            <th>A pagar</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderPartnerSummary(rows) {
  if (!rows?.length) {
    return "Todavía no hay repartos calculados.";
  }

  const body = rows
    .map(
      (row) => `
        <tr>
          <td data-label="Socio"><strong>${escapeHtml(row.partner)}</strong></td>
          <td data-label="Base">${escapeHtml(row.basis)}</td>
          <td data-label="Total">${formatCurrency(row.total)}</td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Socio</th>
            <th>Base de cálculo</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderUnmappedProducts(groups, products) {
  if (!groups?.length) {
    return '<span class="tag success">Todo el cierre quedó mapeado automáticamente.</span>';
  }

  const productOptions = createProductOptions(products);
  const body = groups
    .map((group) => {
      const encodedKey = encodeURIComponent(group.normalizedKey);
      return `
        <tr data-unmapped-row data-unmapped-key="${encodedKey}">
          <td data-label="Producto detectado">
            <strong>${escapeHtml(group.primaryLabel)}</strong><br />
            <span class="muted">${escapeHtml(group.rawLabels.join(" · "))}</span>
          </td>
          <td data-label="Apariciones">${formatNumber(group.occurrences)}</td>
          <td data-label="Cantidad">${formatNumber(group.quantity)}</td>
          <td data-label="Ventas">${formatNumber(group.salesCount)}</td>
          <td data-label="Acciones">
            <div class="inline-form">
              <select class="map-existing-product">
                <option value="">Vincular con producto existente</option>
                ${productOptions}
              </select>
              <div class="inline-actions">
                <button class="tiny-button" type="button" data-action="link-alias">
                  Guardar alias
                </button>
              </div>
              <div class="inline-form two-columns">
                <input class="create-base-name" type="text" value="${escapeHtml(
                  titleCase(group.primaryLabel),
                )}" placeholder="Nombre base" />
                <input class="create-provider" type="text" placeholder="Proveedor" />
                <input class="create-cost" type="number" step="0.01" placeholder="Costo real unitario" />
                <select class="create-allocation-type">
                  <option value="profit_percentage">Reparto sobre utilidad</option>
                  <option value="sale_percentage">Reparto sobre venta</option>
                  <option value="fixed_amount">Monto fijo por unidad</option>
                </select>
                <input class="create-maria-share" type="number" step="0.01" placeholder="Valor María" />
                <input class="create-gaston-share" type="number" step="0.01" placeholder="Valor Gastón" />
              </div>
              <div class="inline-actions">
                <button class="tiny-button" type="button" data-action="create-product">
                  Crear producto y vincular
                </button>
              </div>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Producto detectado</th>
            <th>Apariciones</th>
            <th>Cantidad</th>
            <th>Ventas</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderProductsCatalog(products, aliases) {
  if (!products?.length) {
    return "Todavía no hay productos cargados en Firestore.";
  }

  const aliasCountByProduct = new Map();
  (aliases || []).forEach((alias) => {
    aliasCountByProduct.set(
      alias.productId,
      (aliasCountByProduct.get(alias.productId) || 0) + 1,
    );
  });

  const body = products
    .map(
      (product) => `
        <tr>
          <td data-label="Producto"><strong>${escapeHtml(product.baseName)}</strong></td>
          <td data-label="Proveedor">${escapeHtml(product.provider || "-")}</td>
          <td data-label="Costo">${formatCurrency(product.realUnitCost)}</td>
          <td data-label="Reparto">${escapeHtml(product.allocationType || "-")}</td>
          <td data-label="María">${formatNumber(product.mariaShareValue)}</td>
          <td data-label="Gastón">${formatNumber(product.gastonShareValue)}</td>
          <td data-label="Alias">${formatNumber(aliasCountByProduct.get(product.id) || 0)}</td>
          <td data-label="Estado">
            <span class="tag ${product.isActive === false ? "warning" : "success"}">
              ${product.isActive === false ? "Inactivo" : "Activo"}
            </span>
          </td>
        </tr>
      `,
    )
    .join("");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Producto</th>
            <th>Proveedor</th>
            <th>Costo real</th>
            <th>Tipo de reparto</th>
            <th>María</th>
            <th>Gastón</th>
            <th>Alias</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderAdjustments(adjustments, targetLookup) {
  if (!adjustments?.length) {
    return "No hay ajustes manuales cargados.";
  }

  return `
    <div class="history-list">
      ${adjustments
        .map((adjustment) => {
          const targetLabel = targetLookup.get(adjustment.targetId) || adjustment.targetId;
          return `
            <div class="history-item">
              <div>
                <strong>${escapeHtml(adjustment.label || "Ajuste manual")}</strong>
                <div class="muted">${escapeHtml(targetLabel)}</div>
                <div class="muted">
                  Ingreso ${formatCurrency(adjustment.revenueDelta)} · Costo ${formatCurrency(
                    adjustment.costDelta,
                  )}
                </div>
              </div>
              <button class="tiny-button" type="button" data-action="remove-adjustment" data-adjustment-id="${escapeHtml(
                adjustment.id,
              )}">
                Quitar
              </button>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

export function renderSalesDetails(sales) {
  if (!sales?.length) {
    return "El detalle por venta se mostrará una vez procesado el archivo.";
  }

  return `
    <div class="sale-list">
      ${sales
        .map(
          (sale) => `
            <article class="sale-card">
              <div class="sale-card-header">
                <div>
                  <h4>${escapeHtml(sale.customer || "Cliente sin nombre")}</h4>
                  <div class="muted">
                    ${formatDateTime(sale.dateTime)} · ${escapeHtml(
                      sale.paymentMethod || "Sin forma de pago",
                    )} · fila ${formatNumber(sale.sourceRowNumber)}
                  </div>
                  <div class="muted">
                    Vendedor ${escapeHtml(sale.seller || "Sin vendedor")} · Obs. ${escapeHtml(
                      sale.observation || "Sin observación",
                    )}
                  </div>
                  <div class="muted">${escapeHtml(sale.description || "Sin descripción")}</div>
                </div>
                <div class="summary-grid">
                  <div class="summary-pill">
                    <p class="muted">Venta real</p>
                    <p><strong>${formatCurrency(sale.adjustedRevenue)}</strong></p>
                  </div>
                  <div class="summary-pill">
                    <p class="muted">Costo real</p>
                    <p><strong>${formatCurrency(sale.adjustedCost)}</strong></p>
                  </div>
                  <div class="summary-pill">
                    <p class="muted">Utilidad</p>
                    <p><strong>${formatCurrency(sale.adjustedProfit)}</strong></p>
                  </div>
                </div>
              </div>
              ${
                sale.saleAdjustments?.length
                  ? `<div class="tag warning">Ajustes de venta: ${escapeHtml(
                      sale.saleAdjustments.map((item) => item.label).join(", "),
                    )}</div>`
                  : ""
              }
              <div class="item-list">
                ${sale.parsedItems
                  .map(
                    (item) => `
                      <div class="item-row ${item.productId ? "" : "unmapped"}">
                        <strong>${escapeHtml(item.name)}</strong>
                        <div class="muted">
                          Cantidad ${formatNumber(item.quantity)} · ${
                            item.productId
                              ? `${escapeHtml(item.productBaseName)} · ${escapeHtml(
                                  item.provider || "Sin proveedor",
                                )}`
                              : "Sin mapear"
                          }
                        </div>
                        <div class="muted">
                          Ingreso ${formatCurrency(item.adjustedRevenue)} · Costo ${formatCurrency(
                            item.adjustedCost,
                          )} · Utilidad ${formatCurrency(item.profit)}
                        </div>
                        <div class="muted">
                          María ${formatCurrency(item.mariaShare)} · Gastón ${formatCurrency(
                            item.gastonShare,
                          )} · Proveedor ${formatCurrency(item.providerPayable)}
                        </div>
                        ${
                          item.productId
                            ? `<div class="muted">Reparto: ${escapeHtml(item.allocationType || "sin definir")}</div>`
                            : '<span class="tag warning">Requiere mapeo manual</span>'
                        }
                      </div>
                    `,
                  )
                  .join("")}
              </div>
            </article>
          `,
        )
        .join("")}
    </div>
  `;
}

export function renderClosureHistory(closures) {
  if (!closures?.length) {
    return "No hay cierres guardados todavía.";
  }

  return `
    <div class="history-list">
      ${closures
        .map(
          (closure) => `
            <div class="history-item">
              <div>
                <strong>${escapeHtml(closure.closureName || "Cierre guardado")}</strong>
                <div class="muted">
                  ${formatDate(closure.closureDate)} · ${escapeHtml(closure.sourceFileName || "Sin archivo")}
                </div>
                <div class="muted">
                  Facturación ${formatCurrency(closure.metrics?.totalRevenue)} · Utilidad ${formatCurrency(
                    closure.metrics?.totalProfit,
                  )}
                </div>
              </div>
              <button class="tiny-button" type="button" data-action="load-closure" data-closure-id="${escapeHtml(
                closure.id,
              )}">
                Abrir cierre
              </button>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

export function renderExportPreview(payload) {
  if (!payload) {
    return "Procesá un cierre para ver el payload listo para exportación.";
  }

  return `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
}
