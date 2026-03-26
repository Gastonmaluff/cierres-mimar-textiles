# Cierres Mimar Textiles

App web estática para recalcular el cierre financiero real del negocio a partir de un CSV exportado desde Kyte.

## Qué hace

- Permite subir un CSV exportado desde Kyte.
- Ignora por completo el costo y la ganancia del CSV.
- Recalcula costo real, utilidad real, reparto para Gastón y María, y pagos por proveedor usando una tabla maestra propia.
- Detecta productos sin mapear y permite vincularlos o crearlos desde la interfaz.
- Guarda productos, alias, ajustes y cierres en Firebase Firestore.
- Deja armado un payload listo para una futura exportación a PDF o Excel.

## Dónde pegar la configuración de Firebase

La configuración del proyecto está en:

`js/config/firebase-config.js`

Ahí ya quedaron cargados los valores que compartiste. Si más adelante querés cambiarlos, reemplazalos en ese archivo.

## Colecciones usadas en Firestore

- `products`
- `product_aliases`
- `closures`
- `manual_adjustments`

## Estructura principal

- `index.html`: layout principal de la app.
- `styles.css`: diseño responsive mobile-first.
- `js/app.js`: flujo principal y eventos.
- `js/utils/csv-parser.js`: parser robusto de CSV.
- `js/utils/kyte-parser.js`: separación y normalización de ventas e ítems.
- `js/utils/closure-engine.js`: cálculo real de cierres, costos, utilidad y reparto.
- `js/services/data-service.js`: persistencia en Firestore.
- `data/example-kyte-sales.csv`: archivo de ejemplo.

## Cómo usar

1. Abrí la app en GitHub Pages o en cualquier servidor estático.
2. Si querés una prueba rápida, tocá `Cargar datos de ejemplo` y después `Cargar CSV de ejemplo`.
3. Si subís tu CSV real, tocá `Procesar CSV`.
4. Revisá los productos sin mapear y completá proveedor, costo y reglas si hace falta.
5. Si necesitás correcciones puntuales, agregá ajustes manuales por venta o ítem.
6. Tocá `Guardar cierre` para persistirlo en Firestore.
7. En `Maestro de productos` podés revisar rápidamente proveedor, costo, reparto y cantidad de alias guardados.

## Prueba local

Como usa módulos ES y `fetch`, conviene abrirla con un servidor estático en vez de hacer doble clic sobre `index.html`.

Opciones simples:

1. Usar la extensión `Live Server` en VS Code.
2. Usar cualquier servidor estático local que apunte a esta carpeta.

## Despliegue en GitHub Pages

Como la app es estática, podés subir estos archivos a un repositorio y publicar la rama principal con GitHub Pages.

Pasos simples:

1. Crear un repositorio en GitHub.
2. Subir todo el contenido de esta carpeta.
3. En GitHub, ir a `Settings > Pages`.
4. Elegir `Deploy from a branch`.
5. Seleccionar la rama y la carpeta raíz.

## Reglas sugeridas para Firestore

Para pruebas iniciales, necesitás permitir lectura y escritura desde la app. Más adelante conviene agregar autenticación y endurecer reglas.

Ejemplo básico de prueba:

```txt
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

## Nota importante

La app calcula el reparto por producto según:

- `profit_percentage`: porcentaje sobre utilidad del ítem.
- `sale_percentage`: porcentaje sobre venta del ítem.
- `fixed_amount`: monto fijo por unidad vendida.

El pago a proveedores se basa en el costo real unitario configurado para cada producto.
