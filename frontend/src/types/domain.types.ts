/**
 * © 2026 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
// The listed literals are the built-in defaults and exist for editor
// autocomplete; `(string & {})` keeps the type open so admin-added custom
// domains (see AppSettingsModal's Domains tab + backend master_domains
// table) don't require a code change/type widening to be valid.
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
  | 'govtech'
  | 'logistics'
  | 'energy'
  | 'construction'
  | 'biotech'
  | 'telecom'
  | (string & {});

export interface DomainDefinition {
  id: DomainId;
  label: string;
  color: string;
  bgColor: string;
  /** Domain-specific context injected into every agent prompt */
  context: string;
}
