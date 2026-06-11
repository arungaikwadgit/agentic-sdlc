export type DomainId =
  | 'fintech'
  | 'healthcare'
  | 'ecommerce'
  | 'saas'
  | 'edtech'
  | 'insurtech'
  | 'legaltech'
  | 'retail'
  | 'manufacturing'
  | 'govtech';

export interface DomainDefinition {
  id: DomainId;
  label: string;
  color: string;
  bgColor: string;
  /** Domain-specific context injected into every agent prompt */
  context: string;
}
