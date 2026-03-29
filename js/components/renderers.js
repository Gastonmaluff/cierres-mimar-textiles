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

function buildTraceReferenceLabel(trace) {
  if (trace.sourceRowNumber) {
    return `Fila ${trace.sourceRowNumber}`;
  }

  if (trace.saleId) {
    return trace.saleId;
  }

  return "Venta sin referencia";
}

function renderTraceTooltipContent(traceEntries) {
  if (!traceEntries?.length) {
    return `<p>Sin detalle de cliente disponible</p>`;
  }

  const previewItems = traceEntries
    .slice(0, 6)
    .map(
      (trace) => `
        <li>
          <strong>${escapeHtml(trace.customer || "Sin cliente")}</strong>
          <span>${escapeHtml(buildTraceReferenceLabel(trace))} · ${escapeHtml(
            formatDate(trace.dateTime),
          )}</span>
          <span>Vendedor: ${escapeHtml(trace.seller || "Sin vendedor")}</span>
        </li>
      `,
    )
    .join("");

  const extraCount = Math.max(0, traceEntries.length - 6);

  return `
    <div class="provider-trace-tooltip-content">
      <p class="tooltip-title">
        ${traceEntries.length === 1 ? "Origen del producto" : `Pedidos asociados: ${traceEntries.length}`}
      </p>
      <ul class="provider-trace-list">${previewItems}</ul>
      ${extraCount ? `<p class="tooltip-more">+${extraCount} pedido(s) mas</p>` : ""}
    </div>
  `;
}

function renderExpandedTraceRows(traceEntries) {
  if (!traceEntries?.length) {
    return `
      <tr>
        <td colspan="8" class="empty-state">Sin detalle de cliente disponible.</td>
      </tr>
    `;
  }

  return traceEntries
    .map(
      (trace) => `
        <tr>
          <td data-label="Cliente">${escapeHtml(trace.customer || "Sin cliente")}</td>
          <td data-label="Pedido / venta">${escapeHtml(buildTraceReferenceLabel(trace))}</td>
          <td data-label="Fecha">${escapeHtml(formatDate(trace.dateTime))}</td>
          <td data-label="Vendedor">${escapeHtml(trace.seller || "Sin vendedor")}</td>
          <td data-label="Cantidad">${formatNumber(trace.quantity)}</td>
          <td data-label="Venta asociada">${formatCurrency(trace.adjustedRevenue)}</td>
          <td data-label="Costo real">${formatCurrency(trace.totalCost)}</td>
          <td data-label="Utilidad">${formatCurrency(trace.totalProfit)}</td>
        </tr>
      `,
    )
    .join("");
}

function createProductOptions(products) {
  return products
    .map(
      (product) =>
        `<option value="${escapeHtml(product.id)}">${escapeHtml(product.baseName)}</option>`,
    )
    .join("");
}

function tokenizeKey(value) {
  return String(value || "")
    .split(" ")
    .filter((token) => token.length >= 3);
}

function extractMeasureKey(value) {
  const match = String(value || "").match(
    /(\d+(?:[.,]\d+)?\s*x\s*\d+(?:[.,]\d+)?\s*[a-z]*)|(\bqueen\b|\bking\b|\bsoltero\b|\bmatrimonial\b)/i,
  );

  return match ? match[0].toLowerCase().replace(/\s+/g, " ").trim() : "";
}

function buildSimilarSuggestionMap(groups) {
  const suggestionMap = new Map();

  groups.forEach((group, index) => {
    const currentTokens = tokenizeKey(group.normalizedKey);
    const currentMeasure = extractMeasureKey(group.primaryLabel || group.normalizedKey);

    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = groups[candidateIndex];
      const candidateTokens = tokenizeKey(candidate.normalizedKey);
      const candidateMeasure = extractMeasureKey(candidate.primaryLabel || candidate.normalizedKey);
      const sharedTokens = currentTokens.filter((token) => candidateTokens.includes(token));
      const hasMeasureMatch = currentMeasure && candidateMeasure && currentMeasure === candidateMeasure;

      if (hasMeasureMatch || sharedTokens.length >= 2) {
        suggestionMap.set(group.normalizedKey, {
          key: candidate.normalizedKey,
          label: candidate.primaryLabel,
          reason: hasMeasureMatch ? `misma medida: ${currentMeasure}` : "nombre parecido",
        });
        break;
      }
    }
  });

  return suggestionMap;
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
    ["Facturacion total", formatCurrency(safeMetrics.totalRevenue), "Ingresos reales del cierre"],
    ["Costo real total", formatCurrency(safeMetrics.totalCost), "Basado en tu tabla maestra"],
    ["Utilidad real total", formatCurrency(safeMetrics.totalProfit), "Venta menos costo y ajustes"],
    ["Total Gaston", formatCurrency(safeMetrics.totalGaston), "Segun reglas por producto"],
    ["Total Maria", formatCurrency(safeMetrics.totalMaria), "Segun reglas por producto"],
    ["Total proveedores", formatCurrency(safeMetrics.totalProviders), "Total a pagar a proveedores"],
  ];

  return cards
    .map(
      ([label, value, helper]) => {
        const valueLength = String(value || "").length;
        const valueClass =
          valueLength >= 18
            ? "value card-value white-nowrap value-xs"
            : valueLength >= 14
              ? "value card-value white-nowrap value-sm"
              : "value card-value white-nowrap";

        return `
        <article class="metric-card card">
          <p class="label">${label}</p>
          <p class="${valueClass}">${value}</p>
          <p class="helper">${helper}</p>
        </article>
      `;
      },
    )
    .join("");
}

export function renderProviderSummary(rows) {
  if (!rows?.length) {
    return "No hay productos mapeados todavia, asi que el resumen por proveedor sigue vacio.";
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
          <td data-label="Acciones">
            <button class="tiny-button" type="button" data-action="open-provider-detail" data-provider="${escapeHtml(
              row.provider,
            )}">
              Desglosar
            </button>
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
            <th>Proveedor</th>
            <th>Cantidad</th>
            <th>Venta asociada</th>
            <th>Costo real</th>
            <th>Utilidad</th>
            <th>A pagar</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

export function renderProviderDetailModal(detail) {
  if (!detail) {
    return "";
  }

  const body = detail.items.length
    ? detail.items
        .map(
          (item) => {
            const isExpanded = item.productKey === detail.expandedProductKey;

            return `
              <tr class="${isExpanded ? "is-expanded" : ""}">
                <td data-label="Producto">
                  <div class="provider-product-cell">
                    <button
                      class="product-trace-trigger"
                      type="button"
                      data-action="toggle-provider-trace"
                      data-product-key="${escapeHtml(item.productKey)}"
                      aria-expanded="${isExpanded ? "true" : "false"}"
                    >
                      <strong>${escapeHtml(item.productName)}</strong>
                      <span class="product-trace-hint">${isExpanded ? "Ocultar origen" : "Ver origen"}</span>
                    </button>
                    <div class="product-trace-tooltip" role="tooltip">
                      ${renderTraceTooltipContent(item.traceEntries)}
                    </div>
                  </div>
                </td>
                <td data-label="Cantidad">${formatNumber(item.quantity)}</td>
                <td data-label="Venta asociada">${formatCurrency(item.totalRevenue)}</td>
                <td data-label="Costo real">${formatCurrency(item.totalCost)}</td>
                <td data-label="Utilidad">${formatCurrency(item.totalProfit)}</td>
              </tr>
              ${
                isExpanded
                  ? `
                    <tr class="trace-expanded-row">
                      <td colspan="5">
                        <div class="trace-expanded-panel">
                          <div class="trace-expanded-header">
                            <strong>Origen del producto</strong>
                            <span>${item.traceEntries.length} pedido(s) asociado(s)</span>
                          </div>
                          <div class="table-wrap trace-expanded-table">
                            <table>
                              <thead>
                                <tr>
                                  <th>Cliente</th>
                                  <th>Pedido / venta</th>
                                  <th>Fecha</th>
                                  <th>Vendedor</th>
                                  <th>Cantidad</th>
                                  <th>Venta asociada</th>
                                  <th>Costo real</th>
                                  <th>Utilidad</th>
                                </tr>
                              </thead>
                              <tbody>${renderExpandedTraceRows(item.traceEntries)}</tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  `
                  : ""
              }
            `;
          },
        )
        .join("")
    : `
        <tr>
          <td colspan="5" class="empty-state">No hay items para este proveedor en el cierre actual.</td>
        </tr>
      `;

  return `
    <div class="modal-overlay" data-action="close-provider-detail">
      <div class="modal-dialog provider-modal" role="dialog" aria-modal="true" aria-labelledby="providerDetailTitle">
        <div class="modal-header">
          <div>
            <h3 id="providerDetailTitle">Detalle de proveedor: ${escapeHtml(detail.provider)}</h3>
            <p>Desglose armado con los items del cierre actual.</p>
          </div>
          <div class="inline-actions">
            <button class="tiny-button" type="button" data-action="copy-provider-detail">
              Copiar detalle
            </button>
            <button class="tiny-button" type="button" data-action="close-provider-detail">
              Cerrar
            </button>
          </div>
        </div>

        <div class="table-wrap modal-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Cantidad</th>
                <th>Venta asociada</th>
                <th>Costo real</th>
                <th>Utilidad</th>
              </tr>
            </thead>
            <tbody>${body}</tbody>
          </table>
        </div>

        <div class="modal-summary-grid">
          <div class="summary-pill">
            <p class="muted">Total ventas</p>
            <strong>${formatCurrency(detail.summary.totalRevenue)}</strong>
          </div>
          <div class="summary-pill">
            <p class="muted">Total costo</p>
            <strong>${formatCurrency(detail.summary.totalCost)}</strong>
          </div>
          <div class="summary-pill">
            <p class="muted">Total utilidad</p>
            <strong>${formatCurrency(detail.summary.totalProfit)}</strong>
          </div>
          <div class="summary-pill">
            <p class="muted">Total a pagar</p>
            <strong>${formatCurrency(detail.summary.totalPayable)}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderPartnerSummary(rows) {
  if (!rows?.length) {
    return "Todavia no hay repartos calculados.";
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
            <th>Base de calculo</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderAllocationOptions(selectedValue = "profit_percentage") {
  const options = [
    { value: "profit_percentage", label: "Reparto sobre utilidad" },
    { value: "sale_percentage", label: "Reparto sobre venta" },
    { value: "fixed_amount", label: "Monto fijo por unidad" },
  ];

  return options
    .map(
      (option) =>
        `<option value="${option.value}" ${selectedValue === option.value ? "selected" : ""}>${option.label}</option>`,
    )
    .join("");
}

export function renderUnmappedProducts(
  groups,
  products,
  copiedConfig,
  productCreationStatus = {},
  formDrafts = {},
) {
  if (!groups?.length) {
    return '<span class="tag success">Todo el cierre quedo mapeado automaticamente.</span>';
  }

  const productOptions = createProductOptions(products);
  const similarSuggestionMap = buildSimilarSuggestionMap(groups);
  const body = groups
    .map((group, index) => {
      const encodedKey = encodeURIComponent(group.normalizedKey);
      const suggestion = similarSuggestionMap.get(group.normalizedKey);
      const rowStatus = productCreationStatus[group.normalizedKey] || null;
      const draft = formDrafts[group.normalizedKey] || {};

      return `
        <tr data-unmapped-row data-unmapped-key="${encodedKey}" data-row-index="${index}">
          <td data-label="Producto detectado">
            <strong>${escapeHtml(group.primaryLabel)}</strong><br />
            <span class="muted">${escapeHtml(group.rawLabels.join(" · "))}</span>
          </td>
          <td data-label="Apariciones">${formatNumber(group.occurrences)}</td>
          <td data-label="Cantidad">${formatNumber(group.quantity)}</td>
          <td data-label="Ventas">${formatNumber(group.salesCount)}</td>
          <td data-label="Acciones">
            <div class="inline-form compact-form">
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
                  draft.baseName || titleCase(group.primaryLabel),
                )}" placeholder="Nombre base" />
                <input class="create-provider" type="text" value="${escapeHtml(
                  draft.provider || "",
                )}" placeholder="Proveedor" />
                <input class="create-cost" type="number" step="0.01" value="${escapeHtml(
                  draft.cost ?? "",
                )}" placeholder="Costo real unitario" />
                <select class="create-allocation-type">
                  ${renderAllocationOptions(draft.allocationType || "profit_percentage")}
                </select>
                <input class="create-maria-share" type="number" step="0.01" value="${escapeHtml(
                  draft.mariaShareValue ?? "",
                )}" placeholder="Valor Maria" />
                <input class="create-gaston-share" type="number" step="0.01" value="${escapeHtml(
                  draft.gastonShareValue ?? "",
                )}" placeholder="Valor Gaston" />
              </div>
              <div class="inline-actions compact-actions">
                <button class="tiny-button" type="button" data-action="copy-config">
                  Copiar config.
                </button>
                <button class="tiny-button ${copiedConfig ? "is-available" : ""}" type="button" data-action="paste-config" data-paste-button ${
                  copiedConfig ? "" : "disabled"
                }>
                  Pegar config.
                </button>
                <button class="tiny-button" type="button" data-action="use-previous" ${
                  index === 0 ? "disabled" : ""
                }>
                  Fila anterior
                </button>
                ${
                  suggestion
                    ? `<button class="tiny-button" type="button" data-action="apply-similar" data-similar-key="${escapeHtml(
                        encodeURIComponent(suggestion.key),
                      )}">
                        Similar
                      </button>`
                    : ""
                }
                <button class="tiny-button" type="button" data-action="create-product" ${
                  rowStatus?.isSaving ? "disabled" : ""
                }>
                  ${rowStatus?.isSaving ? "Guardando..." : "Crear producto"}
                </button>
              </div>
              <div class="inline-meta">
                ${
                  copiedConfig
                    ? `<span class="tag success" data-config-status>Config copiada: ${escapeHtml(
                        copiedConfig.provider || "sin proveedor",
                      )} · ${formatCurrency(copiedConfig.cost || 0)}</span>`
                    : '<span class="tag" data-config-status>Sin config copiada</span>'
                }
                ${
                  suggestion
                    ? `<span class="tag">Sugerencia: ${escapeHtml(suggestion.label)} · ${escapeHtml(
                        suggestion.reason,
                      )}</span>`
                    : ""
                }
              </div>
              ${
                rowStatus?.message
                  ? `<div class="row-status ${escapeHtml(rowStatus.type || "info")}" data-row-status>${escapeHtml(
                      rowStatus.message,
                    )}</div>`
                  : `<div class="row-status hidden" data-row-status></div>`
              }
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

function getSplitValueLabels(allocationType) {
  if (allocationType === "fixed_amount") {
    return {
      maria: "Maria (Gs por unidad)",
      gaston: "Gaston (Gs por unidad)",
    };
  }

  return {
    maria: "Maria (%)",
    gaston: "Gaston (%)",
  };
}

function getSplitWarnings(draft) {
  if (!draft || draft.allocationType === "fixed_amount") {
    return [];
  }

  const maria = Number(draft.mariaShareValue) || 0;
  const gaston = Number(draft.gastonShareValue) || 0;
  const warnings = [];

  if (maria > 100) {
    warnings.push("Maria supera 100%.");
  }

  if (gaston > 100) {
    warnings.push("Gaston supera 100%.");
  }

  if (maria + gaston > 100) {
    warnings.push("La suma de Maria y Gaston supera 100%.");
  }

  return warnings;
}

function renderSplitTypeOptions(selectedValue) {
  const options = [
    { value: "profit_percentage", label: "Reparto sobre utilidad" },
    { value: "sale_percentage", label: "Reparto sobre venta" },
    { value: "fixed_amount", label: "Monto fijo por unidad" },
  ];

  return options
    .map(
      (option) =>
        `<option value="${option.value}" ${selectedValue === option.value ? "selected" : ""}>${option.label}</option>`,
    )
    .join("");
}

export function renderProductsCatalog(products, aliases, productEditState = {}) {
  if (!products?.length) {
    return "Todavia no hay productos cargados en Firestore.";
  }

  const aliasCountByProduct = new Map();
  (aliases || []).forEach((alias) => {
    aliasCountByProduct.set(
      alias.productId,
      (aliasCountByProduct.get(alias.productId) || 0) + 1,
    );
  });

  const body = products
    .map((product) => {
      const editState = productEditState[product.id] || null;
      const isEditing = Boolean(editState?.isEditing);
      const draft = editState?.draft || {
        baseName: product.baseName,
        provider: product.provider,
        realUnitCost: product.realUnitCost,
        allocationType: product.allocationType,
        mariaShareValue: product.mariaShareValue,
        gastonShareValue: product.gastonShareValue,
        isActive: product.isActive !== false,
      };
      const labels = getSplitValueLabels(draft.allocationType);
      const warnings = getSplitWarnings(draft);
      const rowMessage = editState?.message || "";

      if (!isEditing) {
        return `
          <tr data-product-row data-product-id="${escapeHtml(product.id)}">
            <td data-label="Producto"><strong>${escapeHtml(product.baseName)}</strong></td>
            <td data-label="Proveedor">${escapeHtml(product.provider || "-")}</td>
            <td data-label="Costo">${formatCurrency(product.realUnitCost)}</td>
            <td data-label="Reparto">${escapeHtml(product.allocationType || "-")}</td>
            <td data-label="Maria">${formatNumber(product.mariaShareValue)}</td>
            <td data-label="Gaston">${formatNumber(product.gastonShareValue)}</td>
            <td data-label="Alias">${formatNumber(aliasCountByProduct.get(product.id) || 0)}</td>
            <td data-label="Estado">
              <span class="tag ${product.isActive === false ? "warning" : "success"}">
                ${product.isActive === false ? "Inactivo" : "Activo"}
              </span>
            </td>
            <td data-label="Acciones">
              <div class="inline-actions">
                <button class="tiny-button" type="button" data-action="edit-product" data-product-id="${escapeHtml(
                  product.id,
                )}">
                  Editar
                </button>
                <button class="tiny-button" type="button" data-action="copy-product-config" data-product-id="${escapeHtml(
                  product.id,
                )}">
                  Copiar config.
                </button>
              </div>
            </td>
          </tr>
        `;
      }

      return `
        <tr data-product-row data-product-id="${escapeHtml(product.id)}" class="editing-row">
          <td data-label="Producto">
            <label class="inline-label">Nombre base</label>
            <input class="catalog-input product-base-name ${editState?.fieldErrors?.baseName ? "input-error" : ""}" type="text" value="${escapeHtml(
              draft.baseName || "",
            )}" />
          </td>
          <td data-label="Proveedor">
            <label class="inline-label">Proveedor</label>
            <input class="catalog-input product-provider ${editState?.fieldErrors?.provider ? "input-error" : ""}" type="text" value="${escapeHtml(
              draft.provider || "",
            )}" />
          </td>
          <td data-label="Costo">
            <label class="inline-label">Costo real unitario</label>
            <input class="catalog-input product-cost ${editState?.fieldErrors?.realUnitCost ? "input-error" : ""}" type="number" step="0.01" value="${escapeHtml(
              draft.realUnitCost ?? "",
            )}" />
          </td>
          <td data-label="Reparto">
            <label class="inline-label">Tipo de reparto</label>
            <select class="catalog-input product-allocation-type ${editState?.fieldErrors?.allocationType ? "input-error" : ""}">
              ${renderSplitTypeOptions(draft.allocationType)}
            </select>
          </td>
          <td data-label="Maria">
            <label class="inline-label">${escapeHtml(labels.maria)}</label>
            <input class="catalog-input product-maria-share ${editState?.fieldErrors?.mariaShareValue ? "input-error" : ""}" type="number" step="0.01" value="${escapeHtml(
              draft.mariaShareValue ?? "",
            )}" />
          </td>
          <td data-label="Gaston">
            <label class="inline-label">${escapeHtml(labels.gaston)}</label>
            <input class="catalog-input product-gaston-share ${editState?.fieldErrors?.gastonShareValue ? "input-error" : ""}" type="number" step="0.01" value="${escapeHtml(
              draft.gastonShareValue ?? "",
            )}" />
          </td>
          <td data-label="Alias">
            <label class="inline-label">Alias</label>
            <div class="muted">${formatNumber(aliasCountByProduct.get(product.id) || 0)}</div>
          </td>
          <td data-label="Estado">
            <label class="inline-label">Activo</label>
            <select class="catalog-input product-is-active">
              <option value="true" ${draft.isActive !== false ? "selected" : ""}>Activo</option>
              <option value="false" ${draft.isActive === false ? "selected" : ""}>Inactivo</option>
            </select>
          </td>
          <td data-label="Acciones">
            <div class="inline-form catalog-actions">
              <div class="inline-actions">
                <button class="tiny-button" type="button" data-action="save-product-edit" data-product-id="${escapeHtml(
                  product.id,
                )}" ${editState?.isSaving ? "disabled" : ""}>
                  ${editState?.isSaving ? "Guardando..." : "Guardar cambios"}
                </button>
                <button class="tiny-button" type="button" data-action="cancel-product-edit" data-product-id="${escapeHtml(
                  product.id,
                )}" ${editState?.isSaving ? "disabled" : ""}>
                  Cancelar
                </button>
              </div>
              ${
                warnings.length
                  ? `<div class="row-status warning">${escapeHtml(warnings.join(" "))}</div>`
                  : ""
              }
              ${
                rowMessage
                  ? `<div class="row-status ${escapeHtml(editState?.messageType || "info")}">${escapeHtml(
                      rowMessage,
                    )}</div>`
                  : ""
              }
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
            <th>Producto</th>
            <th>Proveedor</th>
            <th>Costo real</th>
            <th>Tipo de reparto</th>
            <th>Maria</th>
            <th>Gaston</th>
            <th>Alias</th>
            <th>Estado</th>
            <th>Acciones</th>
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
    return "El detalle por venta se mostrara una vez procesado el archivo.";
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
                      sale.observation || "Sin observacion",
                    )}
                  </div>
                  <div class="muted">${escapeHtml(sale.description || "Sin descripcion")}</div>
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
                          Maria ${formatCurrency(item.mariaShare)} · Gaston ${formatCurrency(
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
    return "No hay cierres guardados todavia.";
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
                  Facturacion ${formatCurrency(closure.metrics?.totalRevenue)} · Utilidad ${formatCurrency(
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
    return "Procesa un cierre para ver el payload listo para exportacion.";
  }

  return `<pre>${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
}
