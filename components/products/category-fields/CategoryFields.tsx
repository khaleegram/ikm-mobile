// Wrapper component that renders category-specific fields based on selected category
import { ProductCategory } from '@/types';
import { ElectronicsFields } from './ElectronicsFields';
import { FashionFields } from './FashionFields';
import { FragranceFields } from './FragranceFields';
import { HairCareFields } from './HairCareFields';
import { IslamicFields } from './IslamicFields';
import { MaterialsFields } from './MaterialsFields';
import { SkincareFields } from './SkincareFields';
import { SnacksFields } from './SnacksFields';

interface CategoryFieldsProps {
  category: ProductCategory | null;
  formData: Record<string, any>;
  onChange: (field: string, value: any) => void;
  errors?: Record<string, string>;
  readOnly?: boolean; // If true, display values as text instead of inputs
}

export function CategoryFields({ category, formData, onChange, errors, readOnly = false }: CategoryFieldsProps) {
  if (!category) {
    return null;
  }

  const commonProps = {
    formData,
    onChange,
    errors: errors || {},
    readOnly,
  };

  switch (category) {
    case 'fragrance':
      return <FragranceFields {...commonProps} />;
    case 'fashion':
      return <FashionFields {...commonProps} />;
    case 'snacks':
      return <SnacksFields {...commonProps} />;
    case 'materials':
      return <MaterialsFields {...commonProps} />;
    case 'skincare':
      return <SkincareFields {...commonProps} />;
    case 'haircare':
      return <HairCareFields {...commonProps} />;
    case 'islamic':
      return <IslamicFields {...commonProps} />;
    case 'electronics':
      return <ElectronicsFields {...commonProps} />;
    default:
      return null;
  }
}

