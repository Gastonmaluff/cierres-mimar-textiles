import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";
import { firebaseCollections } from "../config/firebase-config.js";
import { normalizeKey, slugify } from "../utils/normalizers.js";
import { getDb } from "./firebase-service.js";

function sanitizeForFirestore(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForFirestore(item));
  }

  if (
    value &&
    typeof value === "object" &&
    Object.prototype.toString.call(value) === "[object Object]" &&
    value.constructor === Object
  ) {
    return Object.entries(value).reduce((result, [key, currentValue]) => {
      if (currentValue === undefined) {
        return result;
      }

      result[key] = sanitizeForFirestore(currentValue);
      return result;
    }, {});
  }

  return value;
}

export async function loadMasterData() {
  const db = getDb();

  const [productsSnap, aliasesSnap, closuresSnap] = await Promise.all([
    getDocs(query(collection(db, firebaseCollections.products), orderBy("baseName"))),
    getDocs(collection(db, firebaseCollections.productAliases)),
    getDocs(query(collection(db, firebaseCollections.closures), orderBy("closureDate", "desc"))),
  ]);

  return {
    products: productsSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    aliases: aliasesSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
    closures: closuresSnap.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })),
  };
}

export async function saveProduct(product) {
  const db = getDb();
  const productRef = product.id
    ? doc(db, firebaseCollections.products, product.id)
    : doc(collection(db, firebaseCollections.products));

  await setDoc(
    productRef,
    sanitizeForFirestore({
      ...product,
      normalizedName: normalizeKey(product.baseName),
      updatedAt: serverTimestamp(),
      createdAt: product.createdAt || serverTimestamp(),
    }),
    { merge: true },
  );

  return { id: productRef.id, ...product };
}

export async function saveAlias({ alias, normalizedAlias, productId }) {
  const db = getDb();
  const cleanNormalizedAlias = normalizedAlias || normalizeKey(alias);
  const aliasId = slugify(`${cleanNormalizedAlias}-${productId}`);
  const aliasRef = doc(db, firebaseCollections.productAliases, aliasId);

  await setDoc(
    aliasRef,
    sanitizeForFirestore({
      alias,
      normalizedAlias: cleanNormalizedAlias,
      productId,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    }),
    { merge: true },
  );

  return { id: aliasId, alias, normalizedAlias: cleanNormalizedAlias, productId };
}

export async function seedSampleMasterData(products, aliases) {
  await Promise.all(products.map((product) => saveProduct(product)));
  await Promise.all(aliases.map((alias) => saveAlias(alias)));
}

export async function saveClosure(closure) {
  const db = getDb();
  const closureRef = closure.id
    ? doc(db, firebaseCollections.closures, closure.id)
    : doc(collection(db, firebaseCollections.closures));

  await setDoc(
    closureRef,
    sanitizeForFirestore({
      closureDate: closure.closureDate,
      closureName: closure.closureName,
      sourceFileName: closure.sourceFileName,
      metrics: closure.metrics,
      providerSummary: closure.providerSummary,
      partnerSummary: closure.partnerSummary,
      unmappedProducts: closure.unmappedProducts,
      sales: closure.sales,
      rawSales: closure.rawSales || [],
      manualAdjustments: closure.manualAdjustments || [],
      exportPayload: closure.exportPayload || null,
      updatedAt: serverTimestamp(),
      createdAt: closure.createdAt || serverTimestamp(),
    }),
    { merge: true },
  );

  await Promise.all(
    (closure.manualAdjustments || []).map((adjustment) =>
      setDoc(
        doc(
          db,
          firebaseCollections.manualAdjustments,
          `${closureRef.id}-${adjustment.id || slugify(adjustment.label || "ajuste")}`,
        ),
        {
          closureId: closureRef.id,
          ...sanitizeForFirestore(adjustment),
          createdAt: serverTimestamp(),
        },
        { merge: true },
      ),
    ),
  );

  return closureRef.id;
}
