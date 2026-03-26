import { renderAdjustments, renderClosureHistory, renderDashboard, renderExportPreview, renderPartnerSummary, renderProductsCatalog, renderProviderSummary, renderSalesDetails, renderUnmappedProducts } from "./components/renderers.js";
import { loadMasterData, saveAlias, saveClosure, saveProduct, seedSampleMasterData } from "./services/data-service.js";
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
}

function updateAdjustmentTargets() {
  const targets = buildAdjustmentTargets(state.currentClosure);
  const scope = elements.adjustmentScopeInput.value;
  const availableTargets = scope === "item" ? targets.itemTargets : targets.saleTargets;

  elements.adjustmentTargetInput.innerHTML = availableTargets.length
    ? availableTargets
        .map(
          (target) =>
            `<option value="${target.id}">${target.label.replace(/</g, "&lt;")}</option>`,
        )
        .join("")
    : '<option value="">Procesá un cierre primero</option>';
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
    setMessage("CSV procesado correctamente y todo quedó mapeado.", "info");
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

async function processCsvText(text, fileName) {
  const records = parseCsv(text);
  const parsedSales = parseKyteSales(records);

  if (!parsedSales.length) {
    setMessage("No pude detectar ventas válidas en ese CSV.", "error");
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
    setMessage("Elegí un archivo CSV antes de procesarlo.", "warning");
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
    setMessage("Firebase no está disponible, así que no puedo cargar datos de ejemplo.", "error");
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
    setMessage("Elegí un producto existente para guardar el alias.", "warning");
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
    setMessage("No encontré el producto sin mapear seleccionado.", "error");
    return;
  }

  const baseName = row.querySelector(".create-base-name")?.value?.trim();
  const provider = row.querySelector(".create-provider")?.value?.trim();
  const cost = parseMoney(row.querySelector(".create-cost")?.value);
  const allocationType = row.querySelector(".create-allocation-type")?.value;
  const mariaShareValue = parseMoney(row.querySelector(".create-maria-share")?.value);
  const gastonShareValue = parseMoney(row.querySelector(".create-gaston-share")?.value);

  if (!baseName || !provider || !cost) {
    setMessage("Completá nombre base, proveedor y costo real antes de crear el producto.", "warning");
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
  setMessage("Producto creado y vinculado para próximos cierres.", "info");
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
  if (!state.firebaseReady) {
    setMessage("Firebase no está listo. Igual podés procesar el CSV, pero no guardar cambios.", "warning");
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
    setMessage("Procesá un cierre antes de agregar ajustes.", "warning");
    return;
  }

  const targetId = elements.adjustmentTargetInput.value;
  if (!targetId) {
    setMessage("Elegí una venta o un ítem para aplicar el ajuste.", "warning");
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
    setMessage("No encontré el cierre seleccionado.", "error");
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
      "La app igual puede procesar CSV, pero Firestore no respondió. Revisá reglas y conexión.",
      "warning",
    );
  }

  renderAll();
  updateAdjustmentTargets();
}

init();
