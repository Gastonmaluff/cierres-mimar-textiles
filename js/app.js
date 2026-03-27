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

const APP_VERSION = "2026-03-26e";
const FIRESTORE_STEP_TIMEOUT_MS = 15000;

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
  productCreationStatus: {},
  unmappedFormDrafts: {},
  productEditState: {},
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

function formatErrorMessage(error) {
  if (!error) {
    return "Error desconocido.";
  }

  const rawMessage = error.message || String(error);
  if (
    /database\s+\(default\)\s+does\s+not\s+exist/i.test(rawMessage) ||
    /cloud firestore database/i.test(rawMessage)
  ) {
    return "La base Cloud Firestore (default) no existe en este proyecto Firebase. Creala en la consola de Firebase antes de usar la app.";
  }

  const code = error.code ? `[${error.code}] ` : "";
  return `${code}${rawMessage}`;
}

function withTimeout(promise, timeoutMs, stepLabel) {
  let timeoutId;

  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      reject(
        new Error(
          `${stepLabel} no respondio dentro de ${Math.round(timeoutMs / 1000)} segundos.`,
        ),
      );
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }
  });
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
    state.productCreationStatus,
    state.unmappedFormDrafts,
  );
  elements.productsCatalogContainer.innerHTML = renderProductsCatalog(
    state.products,
    state.aliases,
    state.productEditState,
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

  console.info("[master-data] Recargando colecciones:", {
    productsCollection: "products",
    aliasesCollection: "product_aliases",
  });
  const data = await loadMasterData();
  state.products = data.products;
  state.aliases = data.aliases;
  state.closures = data.closures;
  console.info("[master-data] Datos recargados:", {
    products: state.products.length,
    aliases: state.aliases.length,
    closures: state.closures.length,
  });
}

function setRowStatus(normalizedKey, status) {
  if (!normalizedKey) {
    return;
  }

  if (!status) {
    const nextStatus = { ...state.productCreationStatus };
    delete nextStatus[normalizedKey];
    state.productCreationStatus = nextStatus;
    return;
  }

  state.productCreationStatus = {
    ...state.productCreationStatus,
    [normalizedKey]: status,
  };
}

function setRowDraft(normalizedKey, draft) {
  if (!normalizedKey) {
    return;
  }

  state.unmappedFormDrafts = {
    ...state.unmappedFormDrafts,
    [normalizedKey]: {
      ...(state.unmappedFormDrafts[normalizedKey] || {}),
      ...draft,
    },
  };
}

function clearRowDraft(normalizedKey) {
  if (!normalizedKey) {
    return;
  }

  const nextDrafts = { ...state.unmappedFormDrafts };
  delete nextDrafts[normalizedKey];
  state.unmappedFormDrafts = nextDrafts;
}

function readConfigFromRow(row) {
  return {
    baseName: row.querySelector(".create-base-name")?.value?.trim() || "",
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

function clearRowValidation(row) {
  row.querySelectorAll(".input-error").forEach((input) => {
    input.classList.remove("input-error");
  });
}

function markInvalidInput(row, selector) {
  row.querySelector(selector)?.classList.add("input-error");
}

function upsertById(list, item) {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) {
    return [...list, item];
  }

  const nextList = [...list];
  nextList[index] = item;
  return nextList;
}

function setProductEditState(productId, patch) {
  if (!productId) {
    return;
  }

  if (!patch) {
    const nextState = { ...state.productEditState };
    delete nextState[productId];
    state.productEditState = nextState;
    return;
  }

  state.productEditState = {
    ...state.productEditState,
    [productId]: {
      ...(state.productEditState[productId] || {}),
      ...patch,
    },
  };
}

function buildProductEditDraft(product) {
  return {
    baseName: product.baseName || "",
    provider: product.provider || "",
    realUnitCost: product.realUnitCost ?? "",
    allocationType: product.allocationType || "profit_percentage",
    mariaShareValue: product.mariaShareValue ?? "",
    gastonShareValue: product.gastonShareValue ?? "",
    isActive: product.isActive !== false,
  };
}

function startProductEdit(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    setMessage("No encontre el producto para editar.", "error");
    return;
  }

  setProductEditState(productId, {
    isEditing: true,
    isSaving: false,
    message: "",
    messageType: "info",
    fieldErrors: {},
    draft: buildProductEditDraft(product),
  });
  renderAll();
}

function cancelProductEdit(productId) {
  setProductEditState(productId, null);
  renderAll();
}

function persistProductEditDraftFromRow(row) {
  const productId = row.dataset.productId;
  if (!productId) {
    return;
  }

  setProductEditState(productId, {
    draft: {
      baseName: row.querySelector(".product-base-name")?.value?.trim() || "",
      provider: row.querySelector(".product-provider")?.value?.trim() || "",
      realUnitCost: row.querySelector(".product-cost")?.value?.trim() || "",
      allocationType: row.querySelector(".product-allocation-type")?.value || "profit_percentage",
      mariaShareValue: row.querySelector(".product-maria-share")?.value?.trim() || "",
      gastonShareValue: row.querySelector(".product-gaston-share")?.value?.trim() || "",
      isActive: row.querySelector(".product-is-active")?.value !== "false",
    },
  });
}

function validateProductEditDraft(productId) {
  const editState = state.productEditState[productId];
  const draft = editState?.draft;
  const fieldErrors = {};
  const errors = [];
  const normalizedDraft = {
    baseName: String(draft?.baseName || "").trim(),
    provider: String(draft?.provider || "").trim(),
    realUnitCost: parseMoney(draft?.realUnitCost),
    allocationType: draft?.allocationType || "profit_percentage",
    mariaShareValue: parseMoney(draft?.mariaShareValue),
    gastonShareValue: parseMoney(draft?.gastonShareValue),
    isActive: draft?.isActive !== false,
  };

  if (!normalizedDraft.baseName) {
    fieldErrors.baseName = true;
    errors.push("Falta el nombre base.");
  }

  if (!normalizedDraft.provider) {
    fieldErrors.provider = true;
    errors.push("Falta el proveedor.");
  }

  if (!Number.isFinite(normalizedDraft.realUnitCost) || normalizedDraft.realUnitCost <= 0) {
    fieldErrors.realUnitCost = true;
    errors.push("El costo real unitario debe ser mayor a cero.");
  }

  if (!["profit_percentage", "sale_percentage", "fixed_amount"].includes(normalizedDraft.allocationType)) {
    fieldErrors.allocationType = true;
    errors.push("El tipo de reparto no es valido.");
  }

  if (!Number.isFinite(normalizedDraft.mariaShareValue) || normalizedDraft.mariaShareValue < 0) {
    fieldErrors.mariaShareValue = true;
    errors.push("El valor de Maria no es valido.");
  }

  if (!Number.isFinite(normalizedDraft.gastonShareValue) || normalizedDraft.gastonShareValue < 0) {
    fieldErrors.gastonShareValue = true;
    errors.push("El valor de Gaston no es valido.");
  }

  console.info("[product-edit] Resultado de validacion por campo", {
    productId,
    normalizedDraft,
    fieldErrors,
    errors,
  });

  return {
    isValid: errors.length === 0,
    errors,
    fieldErrors,
    normalizedDraft,
  };
}

async function saveProductEdit(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  const editState = state.productEditState[productId];
  if (!product || !editState?.draft) {
    setMessage("No encontre los datos del producto para actualizar.", "error");
    return;
  }

  console.info("CLICK editar producto");
  console.info("[product-edit] Estado actual del formulario", {
    productId,
    draft: editState.draft,
  });

  const { isValid, errors, fieldErrors, normalizedDraft } = validateProductEditDraft(productId);
  if (!isValid) {
    setProductEditState(productId, {
      fieldErrors,
      message: errors.join(" "),
      messageType: "error",
      isSaving: false,
    });
    renderAll();
    setMessage(errors.join(" "), "error");
    return;
  }

  const payload = {
    id: product.id,
    baseName: normalizedDraft.baseName,
    provider: normalizedDraft.provider,
    realUnitCost: normalizedDraft.realUnitCost,
    allocationType: normalizedDraft.allocationType,
    mariaShareValue: normalizedDraft.mariaShareValue,
    gastonShareValue: normalizedDraft.gastonShareValue,
    isActive: normalizedDraft.isActive,
  };

  console.info("[product-edit] Datos a guardar", {
    payload,
    targetCollection: "products",
  });

  setProductEditState(productId, {
    fieldErrors: {},
    message: "Guardando...",
    messageType: "info",
    isSaving: true,
  });
  renderAll();

  try {
    const savedProduct = await withTimeout(
      saveProduct(payload),
      FIRESTORE_STEP_TIMEOUT_MS,
      "La actualizacion del producto en products",
    );

    console.info("[product-edit] Producto actualizado en Firestore", savedProduct);

    state.products = upsertById(state.products, { ...payload, ...savedProduct });
    renderAll();

    await withTimeout(
      refreshMasterData(),
      FIRESTORE_STEP_TIMEOUT_MS,
      "La recarga de products despues de editar",
    );
    recomputeClosure();
    setProductEditState(productId, null);
    renderAll();
    setMessage("Producto actualizado correctamente", "info");
  } catch (error) {
    console.error("[product-edit] Error exacto al actualizar", error);
    setProductEditState(productId, {
      fieldErrors,
      message: `Error al actualizar producto: ${formatErrorMessage(error)}`,
      messageType: "error",
      isSaving: false,
    });
    renderAll();
    setMessage(`Error al actualizar producto: ${formatErrorMessage(error)}`, "error");
  }
}

function validateProductDraft(row) {
  clearRowValidation(row);

  const baseNameRaw = row.querySelector(".create-base-name")?.value?.trim() || "";
  const providerRaw = row.querySelector(".create-provider")?.value?.trim() || "";
  const costRaw = row.querySelector(".create-cost")?.value?.trim() || "";
  const allocationType = row.querySelector(".create-allocation-type")?.value || "";
  const mariaRaw = row.querySelector(".create-maria-share")?.value?.trim() || "";
  const gastonRaw = row.querySelector(".create-gaston-share")?.value?.trim() || "";

  const draft = {
    baseName: baseNameRaw,
    provider: providerRaw,
    realUnitCost: parseMoney(costRaw),
    allocationType,
    mariaShareValue: parseMoney(mariaRaw),
    gastonShareValue: parseMoney(gastonRaw),
  };

  const errors = [];

  if (!baseNameRaw) {
    errors.push("Falta el nombre base.");
    markInvalidInput(row, ".create-base-name");
  }

  if (!providerRaw) {
    errors.push("Falta el proveedor.");
    markInvalidInput(row, ".create-provider");
  }

  if (!costRaw || !Number.isFinite(draft.realUnitCost) || draft.realUnitCost <= 0) {
    errors.push("El costo real unitario debe ser un numero mayor a cero.");
    markInvalidInput(row, ".create-cost");
  }

  if (!["profit_percentage", "sale_percentage", "fixed_amount"].includes(allocationType)) {
    errors.push("El tipo de reparto no es valido.");
    markInvalidInput(row, ".create-allocation-type");
  }

  if (mariaRaw === "" || !Number.isFinite(draft.mariaShareValue) || draft.mariaShareValue < 0) {
    errors.push("El valor de Maria debe ser un numero valido.");
    markInvalidInput(row, ".create-maria-share");
  }

  if (gastonRaw === "" || !Number.isFinite(draft.gastonShareValue) || draft.gastonShareValue < 0) {
    errors.push("El valor de Gaston debe ser un numero valido.");
    markInvalidInput(row, ".create-gaston-share");
  }

  console.info("[create-product] Resultado de validacion por campo", {
    baseName: { value: baseNameRaw, isValid: Boolean(baseNameRaw) },
    provider: { value: providerRaw, isValid: Boolean(providerRaw) },
    realUnitCost: {
      raw: costRaw,
      parsed: draft.realUnitCost,
      isValid: Boolean(costRaw) && Number.isFinite(draft.realUnitCost) && draft.realUnitCost > 0,
    },
    allocationType: {
      value: allocationType,
      isValid: ["profit_percentage", "sale_percentage", "fixed_amount"].includes(allocationType),
    },
    mariaShareValue: {
      raw: mariaRaw,
      parsed: draft.mariaShareValue,
      isValid:
        mariaRaw !== "" && Number.isFinite(draft.mariaShareValue) && draft.mariaShareValue >= 0,
    },
    gastonShareValue: {
      raw: gastonRaw,
      parsed: draft.gastonShareValue,
      isValid:
        gastonRaw !== "" && Number.isFinite(draft.gastonShareValue) && draft.gastonShareValue >= 0,
    },
    errors,
  });

  return {
    isValid: errors.length === 0,
    errors,
    draft,
  };
}

function persistDraftFromRow(row) {
  const normalizedKey = decodeURIComponent(row.dataset.unmappedKey || "");
  if (!normalizedKey) {
    return;
  }

  setRowDraft(normalizedKey, {
    baseName: row.querySelector(".create-base-name")?.value?.trim() || "",
    provider: row.querySelector(".create-provider")?.value?.trim() || "",
    cost: row.querySelector(".create-cost")?.value?.trim() || "",
    allocationType: row.querySelector(".create-allocation-type")?.value || "profit_percentage",
    mariaShareValue: row.querySelector(".create-maria-share")?.value?.trim() || "",
    gastonShareValue: row.querySelector(".create-gaston-share")?.value?.trim() || "",
  });
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

function copyProductConfiguration(productId) {
  const product = state.products.find((entry) => entry.id === productId);
  if (!product) {
    setMessage("No encontre el producto para copiar la configuracion.", "error");
    return;
  }

  state.copiedConfig = {
    provider: product.provider || "",
    cost: Number(product.realUnitCost) || 0,
    allocationType: product.allocationType || "profit_percentage",
    mariaShareValue: Number(product.mariaShareValue) || 0,
    gastonShareValue: Number(product.gastonShareValue) || 0,
    sourceLabel: `maestro: ${product.baseName || "producto"}`,
  };
  syncCopiedConfigUi();
  setMessage("Configuracion copiada desde el maestro.", "info");
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

  persistDraftFromRow(row);
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
  state.productCreationStatus = {};
  state.unmappedFormDrafts = {};
  state.productEditState = {};
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

  persistDraftFromRow(row);
  console.info("[create-product] Click en crear producto", {
    normalizedKey,
    group,
  });
  console.info("CLICK crear producto");
  console.info("[create-product] Datos de la fila", row.dataset);
  console.info("[create-product] Estado actual del formulario", {
    baseName: row.querySelector(".create-base-name")?.value?.trim() || "",
    provider: row.querySelector(".create-provider")?.value?.trim() || "",
    cost: row.querySelector(".create-cost")?.value?.trim() || "",
    allocationType: row.querySelector(".create-allocation-type")?.value || "",
    mariaShareValue: row.querySelector(".create-maria-share")?.value?.trim() || "",
    gastonShareValue: row.querySelector(".create-gaston-share")?.value?.trim() || "",
  });

  if (!group) {
    console.error("[create-product] No se encontro el grupo sin mapear para la fila actual.");
    setRowStatus(normalizedKey, {
      type: "error",
      message: "No se encontro la fila para crear el producto.",
      isSaving: false,
    });
    renderAll();
    setMessage("No encontre el producto sin mapear seleccionado.", "error");
    return;
  }

  const { isValid, errors, draft } = validateProductDraft(row);
  if (!isValid) {
    console.error("[create-product] Validacion fallida", { errors, draft });
    setRowStatus(normalizedKey, {
      type: "error",
      message: errors.join(" "),
      isSaving: false,
    });
    renderAll();
    setMessage(errors.join(" "), "error");
    return;
  }

  const productId = slugify(draft.baseName);
  const productPayload = {
    id: productId,
    baseName: draft.baseName,
    provider: draft.provider,
    realUnitCost: draft.realUnitCost,
    allocationType: draft.allocationType,
    mariaShareValue: draft.mariaShareValue,
    gastonShareValue: draft.gastonShareValue,
    isActive: true,
  };

  const aliasPayloads = [
    ...group.rawLabels.map((label) => ({
      alias: label,
      normalizedAlias: normalizeKey(label),
      productId,
    })),
    {
      alias: group.primaryLabel,
      normalizedAlias: normalizedKey,
      productId,
    },
  ];

  console.info("[create-product] Datos a guardar", {
    productPayload,
    aliasPayloads,
    targetCollections: {
      product: "products",
      aliases: "product_aliases",
    },
  });

  setRowStatus(normalizedKey, {
    type: "info",
    message: "Guardando...",
    isSaving: true,
  });
  renderAll();

  try {
    console.info("[create-product] Paso 1/3: guardando en products");
    const savedProduct = await withTimeout(
      saveProduct(productPayload),
      FIRESTORE_STEP_TIMEOUT_MS,
      "La escritura en products",
    );
    const savedAliases = [];

    for (const aliasPayload of aliasPayloads) {
      console.info("[create-product] Paso 2/3: guardando alias", aliasPayload);
      const savedAlias = await withTimeout(
        saveAlias(aliasPayload),
        FIRESTORE_STEP_TIMEOUT_MS,
        "La escritura en product_aliases",
      );
      savedAliases.push(savedAlias);
    }

    console.info("[create-product] Guardado en Firestore confirmado", {
      savedProduct,
      savedAliases,
    });

    state.products = upsertById(state.products, { ...productPayload, ...savedProduct });
    savedAliases.forEach((alias) => {
      state.aliases = upsertById(state.aliases, alias);
    });

    recomputeClosure();
    renderAll();

    try {
      console.info("[create-product] Paso 3/3: recargando products desde Firestore");
      await withTimeout(
        refreshMasterData(),
        FIRESTORE_STEP_TIMEOUT_MS,
        "La recarga de products desde Firestore",
      );
      recomputeClosure();
    } catch (refreshError) {
      console.error("[create-product] El producto se guardo, pero fallo la recarga desde Firestore", refreshError);
      setRowStatus(normalizedKey, {
        type: "warning",
        message: `Guardado parcial. No pude recargar Firestore: ${formatErrorMessage(refreshError)}`,
        isSaving: false,
      });
      renderAll();
      setMessage(
        `Producto creado correctamente, pero no pude recargar desde Firestore: ${formatErrorMessage(refreshError)}`,
        "warning",
      );
      return;
    }

    clearRowDraft(normalizedKey);
    setRowStatus(normalizedKey, null);
    setMessage("Producto creado correctamente.", "info");
  } catch (error) {
    console.error("[create-product] Error exacto al guardar", error);
    setRowStatus(normalizedKey, {
      type: "error",
      message: `Error al crear producto: ${formatErrorMessage(error)}`,
      isSaving: false,
    });
    renderAll();
    setMessage(`Error al crear producto: ${formatErrorMessage(error)}`, "error");
  }
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

function handleUnmappedFieldEdit(event) {
  const target = event.target.closest(
    ".create-base-name, .create-provider, .create-cost, .create-allocation-type, .create-maria-share, .create-gaston-share",
  );
  if (!target) {
    return;
  }

  const row = target.closest("[data-unmapped-row]");
  if (!row) {
    return;
  }

  target.classList.remove("input-error");
  persistDraftFromRow(row);
}

function handleProductsCatalogClick(event) {
  const button = event.target.closest("[data-action][data-product-id]");
  if (!button) {
    return;
  }

  const productId = button.dataset.productId;
  const action = button.dataset.action;

  if (action === "edit-product") {
    startProductEdit(productId);
    return;
  }

  if (action === "copy-product-config") {
    copyProductConfiguration(productId);
    return;
  }

  if (action === "cancel-product-edit") {
    cancelProductEdit(productId);
    return;
  }

  if (action === "save-product-edit") {
    saveProductEdit(productId).catch((error) => {
      console.error("[product-edit] Error inesperado", error);
      setMessage(`Error al actualizar producto: ${formatErrorMessage(error)}`, "error");
    });
  }
}

function handleProductsCatalogFieldEdit(event) {
  const target = event.target.closest(
    ".product-base-name, .product-provider, .product-cost, .product-allocation-type, .product-maria-share, .product-gaston-share, .product-is-active",
  );
  if (!target) {
    return;
  }

  const row = target.closest("[data-product-row]");
  if (!row) {
    return;
  }

  target.classList.remove("input-error");
  persistProductEditDraftFromRow(row);

  if (
    target.matches(".product-allocation-type") ||
    target.matches(".product-is-active")
  ) {
    renderAll();
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
  console.info(`[app] Version cargada: ${APP_VERSION}`);
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
  elements.unmappedProductsContainer.addEventListener("input", handleUnmappedFieldEdit);
  elements.unmappedProductsContainer.addEventListener("change", handleUnmappedFieldEdit);
  elements.productsCatalogContainer.addEventListener("click", handleProductsCatalogClick);
  elements.productsCatalogContainer.addEventListener("input", handleProductsCatalogFieldEdit);
  elements.productsCatalogContainer.addEventListener("change", handleProductsCatalogFieldEdit);
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
    setFirebaseStatus("Firestore no disponible", "danger");
    setMessage(formatErrorMessage(error), "error");
    console.error("[firebase] Error de inicializacion o lectura inicial", error);
  }

  renderAll();
  updateAdjustmentTargets();
}

init();
