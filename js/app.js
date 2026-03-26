import {
  renderAdjustments,
  renderClosureHistory,
  renderDashboard,
  renderExportPreview,
  renderPartnerSummary,
  renderProductsCatalog,
  renderProviderSummary,
  renderSalesDetails,
  renderUnmappedProducts,
} from "./components/renderers.js";
import {
  loadMasterData,
  saveAlias,
  saveClosure,
  saveProduct,
  seedSampleMasterData,
} from "./services/data-service.js";
import { buildExportPayload } from "./services/export-service.js";
import { initializeFirebase } from "./services/firebase-service.js";
import { sampleAliases, sampleProducts } from "./sample-data.js";
import { buildAdjustmentTargets, buildClosure } from "./utils/closure-engine.js";
import { parseCsv } from "./utils/csv-parser.js";
import { parseKyteSales } from "./utils/kyte-parser.js";
import { normalizeKey, parseMoney, slugify } from "./utils/normalizers.js";

const state = {
  firebaseReady: false,
  products: [],
  aliases: [],
  closures: [],
  rawSales: [],
  manualAdjustments: [],
  currentClosure: null,
  sourceFileName: "",
  copiedConfig: null,
};

const elements = {
  csvInput: document.querySelector("#csvInput"),
  closureDateInput: document.querySelector("#closureDateInput"),
  closureNameInput: document.querySelector("#closureNameInput"),
  processButton: document.querySelector("#processButton"),
  saveClosureButton: document.querySelector("#saveClosureButton"),
  loadSampleButton: document.querySelector("#loadSampleButton"),
  seedDataButton: document.querySelector("#seedDataButton"),
  firebaseStatus: document.querySelector("#firebaseStatus"),
  appMessage: document.querySelector("#appMessage"),
  dashboardSection: document.querySelector("#dashboardSection"),
  providerSummaryContainer: document.querySelector("#providerSummaryContainer"),
  partnerSummaryContainer: document.querySelector("#partnerSummaryContainer"),
  unmappedProductsContainer: document.querySelector("#unmappedProductsContainer"),
  productsCatalogContainer: document.querySelector("#productsCatalogContainer"),
  salesDetailContainer: document.querySelector("#salesDetailContainer"),
  closureHistoryContainer: document.querySelector("#closureHistoryContainer"),
  exportPreviewContainer: document.querySelector("#exportPreviewContainer"),
  adjustmentForm: document.querySelector("#adjustmentForm"),
  adjustmentScopeInput: document.querySelector("#adjustmentScopeInput"),
  adjustmentTargetInput: document.querySelector("#adjustmentTargetInput"),
  adjustmentLabelInput: document.querySelector("#adjustmentLabelInput"),
  adjustmentRevenueInput: document.querySelector("#adjustmentRevenueInput"),
  adjustmentCostInput: document.querySelector("#adjustmentCostInput"),
  adjustmentNotesInput: document.querySelector("#adjustmentNotesInput"),
  adjustmentsListContainer: document.querySelector("#adjustmentsListContainer"),
};

function setMessage(text, type = "info") {
  elements.appMessage.className = `message-banner ${type}`;
  elements.appMessage.textContent = text;
}

function setFirebaseStatus(text, type = "") {
  elements.firebaseStatus.textContent = text;
  elements.firebaseStatus.className = `status-pill${type ? ` ${type}` : ""}`;
}

function formatInlineCurrency(value) {
  return new Intl.NumberFormat("es-PY", {
    style: "currency",
    currency: "PYG",
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function buildConfigStatusLabel() {
  if (!state.copiedConfig) {
    return "Sin config copiada";
  }

  return `Config copiada: ${state.copiedConfig.provider || "sin proveedor"} · ${formatInlineCurrency(
    state.copiedConfig.cost || 0,
  )}`;
}

function syncCopiedConfigUi() {
  const pasteButtons = elements.unmappedProductsContainer.querySelectorAll("[data-paste-button]");
  pasteButtons.forEach((button) => {
    button.disabled = !state.copiedConfig;
    button.classList.toggle("is-available", Boolean(state.copiedConfig));
  });

  const labels = elements.unmappedProductsContainer.querySelectorAll("[data-config-status]");
  labels.forEach((label) => {
    label.textContent = buildConfigStatusLabel();
    label.className = `tag${state.copiedConfig ? " success" : ""}`;
  });
}

function renderAll() {
  elements.dashboardSection.innerHTML = renderDashboard(state.currentClosure?.metrics);
  elements.providerSummaryContainer.innerHTML = renderProviderSummary(
    state.currentClosure?.providerSummary,
  );
  elements.partnerSummaryContainer.innerHTML = renderPartnerSummary(
    state.currentClosure?.partnerSummary,
  );
  elements.unmappedProductsContainer.innerHTML = renderUnmappedProducts(
    state.currentClosure?.unmappedProducts,
    state.products,
    state.copiedConfig,
  );
  elements.productsCatalogContainer.innerHTML = renderProductsCatalog(
    state.products,
    state.aliases,
  );
  elements.salesDetailContainer.innerHTML = renderSalesDetails(state.currentClosure?.sales);
  elements.closureHistoryContainer.innerHTML = renderClosureHistory(state.closures);
  elements.exportPreviewContainer.innerHTML = renderExportPreview(
    state.currentClosure?.exportPayload,
  );

  const lookup = new Map();
  const targets = buildAdjustmentTargets(state.currentClosure);
  [...targets.saleTargets, ...targets.itemTargets].forEach((target) => {
    lookup.set(target.id, target.label);
  });

  elements.adjustmentsListContainer.innerHTML = renderAdjustments(
    state.manualAdjustments,
    lookup,
  );
  updateAdjustmentTargets();
  elements.saveClosureButton.disabled = !(state.firebaseReady && state.currentClosure);
  syncCopiedConfigUi();
}

function updateAdjustmentTargets() {
  const targets = buildAdjustmentTargets(state.currentClosure);
  const scope = elements.adjustmentScopeInput.value;
  const availableTargets = scope === "item" ? targets.itemTargets : targets.saleTargets;

  elements.adjustmentTargetInput.innerHTML = availableTargets.length
    ? availableTargets
        .map((target) => `<option value="${target.id}">${target.label.replace(/</g, "&lt;")}</option>`)
        .join("")
    : '<option value="">Procesa un cierre primero</option>';
}

function recomputeClosure() {
  if (!state.rawSales.length) {
    state.currentClosure = null;
    renderAll();
    return;
  }

  const closure = buildClosure({
    sales: state.rawSales,
    products: state.products,
    aliases: state.aliases,
    manualAdjustments: state.manualAdjustments,
    closureDate: elements.closureDateInput.value,
    closureName: elements.closureNameInput.value,
    sourceFileName: state.sourceFileName,
  });

  closure.rawSales = state.rawSales;
  closure.exportPayload = buildExportPayload(closure);
  state.currentClosure = closure;
  renderAll();

  if (closure.unmappedProducts.length) {
    setMessage(
      `CSV procesado. Hay ${closure.unmappedProducts.length} producto(s) sin mapear para revisar.`,
      "warning",
    );
  } else {
    setMessage("CSV procesado correctamente y todo quedo mapeado.", "info");
  }
}

async function refreshMasterData() {
  if (!state.firebaseReady) {
    return;
  }

  const data = await loadMasterData();
  state.products = data.products;
  state.aliases = data.aliases;
  state.closures = data.closures;
}

function readConfigFromRow(row) {
  return {
    provider: row.querySelector(".create-provider")?.value?.trim() || "",
    cost: parseMoney(row.querySelector(".create-cost")?.value),
    allocationType: row.querySelector(".create-allocation-type")?.value || "profit_percentage",
    mariaShareValue: parseMoney(row.querySelector(".create-maria-share")?.value),
    gastonShareValue: parseMoney(row.querySelector(".create-gaston-share")?.value),
  };
}

function rowHasReusableConfig(config) {
  return Boolean(
    config &&
      (config.provider ||
        config.cost ||
        config.mariaShareValue ||
        config.gastonShareValue ||
        config.allocationType),
  );
}

function applyConfigToRow(row, config) {
  if (!row || !config) {
    return false;
  }

  const providerInput = row.querySelector(".create-provider");
  const costInput = row.querySelector(".create-cost");
  const allocationInput = row.querySelector(".create-allocation-type");
  const mariaInput = row.querySelector(".create-maria-share");
  const gastonInput = row.querySelector(".create-gaston-share");

  if (!providerInput || !costInput || !allocationInput || !mariaInput || !gastonInput) {
    return false;
  }

  providerInput.value = config.provider || "";
  costInput.value = config.cost || config.cost === 0 ? String(config.cost) : "";
  allocationInput.value = config.allocationType || "profit_percentage";
  mariaInput.value =
    config.mariaShareValue || config.mariaShareValue === 0 ? String(config.mariaShareValue) : "";
  gastonInput.value =
    config.gastonShareValue || config.gastonShareValue === 0 ? String(config.gastonShareValue) : "";

  return true;
}

function getRowPrimaryLabel(row) {
  return row.querySelector("td strong")?.textContent?.trim() || "esta fila";
}

function copyRowConfiguration(row, sourceLabel) {
  const config = readConfigFromRow(row);
  if (!rowHasReusableConfig(config)) {
    setMessage("Completa proveedor, costo o reparto antes de copiar la configuracion.", "warning");
    return;
  }

  state.copiedConfig = {
    ...config,
    sourceLabel,
  };
  syncCopiedConfigUi();
  setMessage(`Configuracion copiada desde ${sourceLabel}.`, "info");
}

function pasteConfigurationIntoRow(row, config, successMessage) {
  if (!config) {
    setMessage("No hay una configuracion copiada disponible.", "warning");
    return;
  }

  const applied = applyConfigToRow(row, config);
  if (!applied) {
    setMessage("No pude pegar la configuracion en esa fila.", "error");
    return;
  }

  setMessage(successMessage, "info");
}

function getPreviousRow(row) {
  const currentIndex = Number(row.dataset.rowIndex);
  if (!Number.isFinite(currentIndex) || currentIndex <= 0) {
    return null;
  }

  return elements.unmappedProductsContainer.querySelector(
    `[data-unmapped-row][data-row-index="${currentIndex - 1}"]`,
  );
}

function getRowByNormalizedKey(normalizedKey) {
  return elements.unmappedProductsContainer.querySelector(
    `[data-unmapped-row][data-unmapped-key="${encodeURIComponent(normalizedKey)}"]`,
  );
}

async function processCsvText(text, fileName) {
  const records = parseCsv(text);
  const parsedSales = parseKyteSales(records);

  if (!parsedSales.length) {
    setMessage("No pude detectar ventas validas en ese CSV.", "error");
    return;
  }

  state.rawSales = parsedSales;
  state.manualAdjustments = [];
  state.sourceFileName = fileName || "archivo.csv";
  recomputeClosure();
}

async function handleProcessFile() {
  const file = elements.csvInput.files?.[0];
  if (!file) {
    setMessage("Elegi un archivo CSV antes de procesarlo.", "warning");
    return;
  }

  const text = await file.text();
  await processCsvText(text, file.name);
}

async function handleLoadSample() {
  try {
    const response = await fetch("./data/example-kyte-sales.csv");
    const text = await response.text();
    await processCsvText(text, "example-kyte-sales.csv");
  } catch (error) {
    setMessage(
      "No pude cargar el CSV de ejemplo. En GitHub Pages esto funciona sin problema.",
      "error",
    );
  }
}

async function handleSeedData() {
  if (!state.firebaseReady) {
    setMessage("Firebase no esta disponible, asi que no puedo cargar datos de ejemplo.", "error");
    return;
  }

  await seedSampleMasterData(sampleProducts, sampleAliases);
  await refreshMasterData();
  if (state.rawSales.length) {
    recomputeClosure();
  } else {
    renderAll();
  }
  setMessage("Datos de ejemplo cargados en Firestore.", "info");
}

async function handleSaveClosure() {
  if (!state.firebaseReady || !state.currentClosure) {
    setMessage("Necesito un cierre procesado y Firebase activo para guardar.", "warning");
    return;
  }

  await saveClosure(state.currentClosure);
  await refreshMasterData();
  renderAll();
  setMessage("Cierre guardado correctamente en Firebase.", "info");
}

async function linkUnmappedAlias(row) {
  const encodedKey = row.dataset.unmappedKey;
  const normalizedKey = decodeURIComponent(encodedKey);
  const group = state.currentClosure?.unmappedProducts.find(
    (item) => item.normalizedKey === normalizedKey,
  );
  const productId = row.querySelector(".map-existing-product")?.value;

  if (!group || !productId) {
    setMessage("Elegi un producto existente para guardar el alias.", "warning");
    return;
  }

  await Promise.all(
    group.rawLabels.map((label) =>
      saveAlias({
        alias: label,
        normalizedAlias: normalizeKey(label),
        productId,
      }),
    ),
  );

  await saveAlias({
    alias: group.primaryLabel,
    normalizedAlias: normalizedKey,
    productId,
  });

  await refreshMasterData();
  recomputeClosure();
  setMessage("Alias guardado para futuros cierres.", "info");
}

async function createProductFromUnmapped(row) {
  const encodedKey = row.dataset.unmappedKey;
  const normalizedKey = decodeURIComponent(encodedKey);
  const group = state.currentClosure?.unmappedProducts.find(
    (item) => item.normalizedKey === normalizedKey,
  );

  if (!group) {
    setMessage("No encontre el producto sin mapear seleccionado.", "error");
    return;
  }

  const baseName = row.querySelector(".create-base-name")?.value?.trim();
  const provider = row.querySelector(".create-provider")?.value?.trim();
  const cost = parseMoney(row.querySelector(".create-cost")?.value);
  const allocationType = row.querySelector(".create-allocation-type")?.value;
  const mariaShareValue = parseMoney(row.querySelector(".create-maria-share")?.value);
  const gastonShareValue = parseMoney(row.querySelector(".create-gaston-share")?.value);

  if (!baseName || !provider || !cost) {
    setMessage("Completa nombre base, proveedor y costo real antes de crear el producto.", "warning");
    return;
  }

  const productId = slugify(baseName);
  await saveProduct({
    id: productId,
    baseName,
    provider,
    realUnitCost: cost,
    allocationType,
    mariaShareValue,
    gastonShareValue,
    isActive: true,
  });

  await Promise.all(
    group.rawLabels.map((label) =>
      saveAlias({
        alias: label,
        normalizedAlias: normalizeKey(label),
        productId,
      }),
    ),
  );

  await saveAlias({
    alias: group.primaryLabel,
    normalizedAlias: normalizedKey,
    productId,
  });

  await refreshMasterData();
  recomputeClosure();
  setMessage("Producto creado y vinculado para proximos cierres.", "info");
}

function handleUnmappedActions(event) {
  const button = event.target.closest("[data-action]");
  if (!button) {
    return;
  }

  const row = button.closest("[data-unmapped-row]");
  if (!row) {
    return;
  }

  const action = button.dataset.action;

  if (action === "copy-config") {
    copyRowConfiguration(row, getRowPrimaryLabel(row));
    return;
  }

  if (action === "paste-config") {
    pasteConfigurationIntoRow(row, state.copiedConfig, "Configuracion pegada en la fila actual.");
    return;
  }

  if (action === "use-previous") {
    const previousRow = getPreviousRow(row);
    if (!previousRow) {
      setMessage("No hay una fila anterior disponible.", "warning");
      return;
    }

    const previousConfig = readConfigFromRow(previousRow);
    if (!rowHasReusableConfig(previousConfig)) {
      setMessage("La fila anterior todavia no tiene una configuracion reutilizable.", "warning");
      return;
    }

    pasteConfigurationIntoRow(
      row,
      previousConfig,
      "Configuracion tomada desde la fila anterior.",
    );
    return;
  }

  if (action === "apply-similar") {
    const similarKey = decodeURIComponent(button.dataset.similarKey || "");
    const sourceRow = getRowByNormalizedKey(similarKey);

    if (!sourceRow) {
      setMessage("No encontre la fila sugerida para copiar esa configuracion.", "warning");
      return;
    }

    const sourceConfig = readConfigFromRow(sourceRow);
    if (!rowHasReusableConfig(sourceConfig)) {
      setMessage("La fila sugerida todavia no tiene datos completos para reutilizar.", "warning");
      return;
    }

    pasteConfigurationIntoRow(
      row,
      sourceConfig,
      "Configuracion aplicada desde un producto similar.",
    );
    return;
  }

  if (!state.firebaseReady) {
    setMessage("Firebase no esta listo. Igual podes procesar el CSV, pero no guardar cambios.", "warning");
    return;
  }

  if (action === "link-alias") {
    linkUnmappedAlias(row).catch((error) => {
      setMessage(`No pude guardar el alias: ${error.message}`, "error");
    });
  }

  if (action === "create-product") {
    createProductFromUnmapped(row).catch((error) => {
      setMessage(`No pude crear el producto: ${error.message}`, "error");
    });
  }
}

function handleAdjustmentsSubmit(event) {
  event.preventDefault();

  if (!state.currentClosure) {
    setMessage("Procesa un cierre antes de agregar ajustes.", "warning");
    return;
  }

  const targetId = elements.adjustmentTargetInput.value;
  if (!targetId) {
    setMessage("Elegi una venta o un item para aplicar el ajuste.", "warning");
    return;
  }

  state.manualAdjustments = [
    ...state.manualAdjustments,
    {
      id: `adj-${Date.now()}`,
      scope: elements.adjustmentScopeInput.value,
      targetId,
      label: elements.adjustmentLabelInput.value.trim() || "Ajuste manual",
      revenueDelta: parseMoney(elements.adjustmentRevenueInput.value),
      costDelta: parseMoney(elements.adjustmentCostInput.value),
      notes: elements.adjustmentNotesInput.value.trim(),
    },
  ];

  elements.adjustmentLabelInput.value = "";
  elements.adjustmentRevenueInput.value = "0";
  elements.adjustmentCostInput.value = "0";
  elements.adjustmentNotesInput.value = "";
  recomputeClosure();
  setMessage("Ajuste manual agregado al cierre actual.", "info");
}

function handleAdjustmentListClick(event) {
  const button = event.target.closest('[data-action="remove-adjustment"]');
  if (!button) {
    return;
  }

  const adjustmentId = button.dataset.adjustmentId;
  state.manualAdjustments = state.manualAdjustments.filter(
    (adjustment) => adjustment.id !== adjustmentId,
  );
  recomputeClosure();
  setMessage("Ajuste eliminado del cierre actual.", "info");
}

function handleHistoryClick(event) {
  const button = event.target.closest('[data-action="load-closure"]');
  if (!button) {
    return;
  }

  const closure = state.closures.find((item) => item.id === button.dataset.closureId);
  if (!closure) {
    setMessage("No encontre el cierre seleccionado.", "error");
    return;
  }

  state.currentClosure = closure;
  state.rawSales = closure.rawSales || [];
  state.manualAdjustments = closure.manualAdjustments || [];
  state.sourceFileName = closure.sourceFileName || "";
  elements.closureDateInput.value = closure.closureDate || elements.closureDateInput.value;
  elements.closureNameInput.value = closure.closureName || "";
  renderAll();
  setMessage("Cierre guardado cargado en pantalla.", "info");
}

async function init() {
  elements.closureDateInput.value = new Date().toISOString().slice(0, 10);

  elements.processButton.addEventListener("click", () => {
    handleProcessFile().catch((error) => setMessage(error.message, "error"));
  });
  elements.loadSampleButton.addEventListener("click", () => {
    handleLoadSample().catch((error) => setMessage(error.message, "error"));
  });
  elements.seedDataButton.addEventListener("click", () => {
    handleSeedData().catch((error) => setMessage(error.message, "error"));
  });
  elements.saveClosureButton.addEventListener("click", () => {
    handleSaveClosure().catch((error) => setMessage(error.message, "error"));
  });
  elements.adjustmentForm.addEventListener("submit", handleAdjustmentsSubmit);
  elements.adjustmentScopeInput.addEventListener("change", updateAdjustmentTargets);
  elements.unmappedProductsContainer.addEventListener("click", handleUnmappedActions);
  elements.adjustmentsListContainer.addEventListener("click", handleAdjustmentListClick);
  elements.closureHistoryContainer.addEventListener("click", handleHistoryClick);
  elements.closureDateInput.addEventListener("change", () => {
    if (state.rawSales.length) {
      recomputeClosure();
    }
  });
  elements.closureNameInput.addEventListener("input", () => {
    if (state.rawSales.length) {
      recomputeClosure();
    }
  });

  try {
    await initializeFirebase();
    state.firebaseReady = true;
    setFirebaseStatus("Firebase listo");
    await refreshMasterData();
  } catch (error) {
    state.firebaseReady = false;
    setFirebaseStatus("Firebase no disponible", "warning");
    setMessage(
      "La app igual puede procesar CSV, pero Firestore no respondio. Revisa reglas y conexion.",
      "warning",
    );
  }

  renderAll();
  updateAdjustmentTargets();
}

init();
