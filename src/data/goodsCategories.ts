export interface GoodsCategory {
  readonly id: string;
  readonly key: string;
  readonly defaultLabel: string;
}

export const GOODS_CATEGORIES: readonly GoodsCategory[] = [
  { id: 'general_goods', key: 'logistics.typeGeneralGoods', defaultLabel: 'General Goods' },
  { id: 'electronics', key: 'logistics.typeElectronics', defaultLabel: 'Electronics' },
  { id: 'furniture', key: 'logistics.typeFurniture', defaultLabel: 'Furniture' },
  { id: 'household_items', key: 'logistics.typeHouseholdItems', defaultLabel: 'Household Items' },
  { id: 'clothing_textiles', key: 'logistics.typeClothingTextiles', defaultLabel: 'Clothing & Textiles' },
  { id: 'food_groceries', key: 'logistics.typeFoodGroceries', defaultLabel: 'Food & Groceries' },
  { id: 'construction_materials', key: 'logistics.typeConstructionMaterials', defaultLabel: 'Construction Materials' },
  { id: 'machinery_equipment', key: 'logistics.typeMachineryEquipment', defaultLabel: 'Machinery & Equipment' },
  { id: 'agricultural_goods', key: 'logistics.typeAgriculturalGoods', defaultLabel: 'Agricultural Goods' },
  { id: 'fragile_items', key: 'logistics.typeFragileItems', defaultLabel: 'Fragile Items' },
  { id: 'documents_parcels', key: 'logistics.typeDocumentsParcels', defaultLabel: 'Documents & Parcels' },
  { id: 'other', key: 'logistics.typeOther', defaultLabel: 'Other' },
];

/**
 * Resolves a category by id, translation key, or english label.
 * Also handles legacy aliases gracefully.
 */
export const findGoodsCategory = (idOrKeyOrLabel?: string): GoodsCategory | undefined => {
  if (!idOrKeyOrLabel) return undefined;
  const trimmed = idOrKeyOrLabel.trim();
  const normalized = trimmed.toLowerCase();

  // Legacy aliases
  if (normalized === 'logistics.typeclothing' || normalized === 'clothing' || normalized === 'clothing/apparel') {
    return GOODS_CATEGORIES.find((c) => c.id === 'clothing_textiles');
  }
  if (normalized === 'logistics.typedocuments' || normalized === 'documents') {
    return GOODS_CATEGORIES.find((c) => c.id === 'documents_parcels');
  }

  return GOODS_CATEGORIES.find(
    (cat) =>
      cat.id.toLowerCase() === normalized ||
      cat.key.toLowerCase() === normalized ||
      cat.defaultLabel.toLowerCase() === normalized
  );
};
