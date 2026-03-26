export const sampleProducts = [
  {
    id: "cierre-metalico-dorado-18-cm",
    baseName: "Cierre metálico dorado 18 cm",
    provider: "Proveedor Central",
    realUnitCost: 18000,
    allocationType: "profit_percentage",
    mariaShareValue: 40,
    gastonShareValue: 60,
    isActive: true,
  },
  {
    id: "cierre-invisible-negro-40-cm",
    baseName: "Cierre invisible negro 40 cm",
    provider: "Textil del Sur",
    realUnitCost: 12000,
    allocationType: "profit_percentage",
    mariaShareValue: 35,
    gastonShareValue: 65,
    isActive: true,
  },
  {
    id: "boton-nacar-20-mm",
    baseName: "Botón nácar 20 mm",
    provider: "Accesorios Marlu",
    realUnitCost: 8000,
    allocationType: "fixed_amount",
    mariaShareValue: 2500,
    gastonShareValue: 2500,
    isActive: true,
  },
  {
    id: "cierre-separable-blanco-65-cm",
    baseName: "Cierre separable blanco 65 cm",
    provider: "Proveedor Central",
    realUnitCost: 26000,
    allocationType: "sale_percentage",
    mariaShareValue: 18,
    gastonShareValue: 12,
    isActive: true,
  },
];

export const sampleAliases = [
  {
    id: "alias-cierre-metalico-dorado-18-cm",
    alias: "cierre metalico dorado 18 cm",
    normalizedAlias: "cierre metalico dorado 18 cm",
    productId: "cierre-metalico-dorado-18-cm",
  },
  {
    id: "alias-cierre-invisible-negro-40-cm",
    alias: "cierre invisible negro 40cm",
    normalizedAlias: "cierre invisible negro 40 cm",
    productId: "cierre-invisible-negro-40-cm",
  },
  {
    id: "alias-boton-nacar-20-mm",
    alias: "boton nacar 20mm",
    normalizedAlias: "boton nacar 20 mm",
    productId: "boton-nacar-20-mm",
  },
  {
    id: "alias-cierre-separable-blanco-65-cm",
    alias: "cierre separable blanco 65 cm",
    normalizedAlias: "cierre separable blanco 65 cm",
    productId: "cierre-separable-blanco-65-cm",
  },
];
