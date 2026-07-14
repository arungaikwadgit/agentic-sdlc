/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
import type { DomainDefinition, DomainId } from '@/types/domain.types';

/**
 * Neutral fallback used whenever a domain lookup misses — e.g. the master
 * data catalog failed to load (App.tsx's initializeMasterDataCatalog, which
 * can mutate DOMAINS at runtime from the backend), or a project's `domain`
 * field holds a value that isn't one of the known DomainIds. Prevents the
 * `Cannot read properties of undefined (reading 'bgColor')` crash seen when
 * components do `DOMAINS[project.domain].bgColor` directly.
 */
const FALLBACK_DOMAIN: DomainDefinition = {
  id: 'saas',
  label: 'Unknown',
  color: '#64748b',
  bgColor: '#e2e8f0',
  context: 'Domain context unavailable — the master data catalog may not have loaded.',
};

function normalizeDomainDefinition(domain: DomainDefinition | undefined, requestedId?: string | null): DomainDefinition {
  const fallbackLabel = requestedId ? `Unknown (${requestedId})` : FALLBACK_DOMAIN.label;
  return {
    id: (domain?.id ?? FALLBACK_DOMAIN.id) as DomainId,
    label: domain?.label || fallbackLabel,
    color: domain?.color || FALLBACK_DOMAIN.color,
    bgColor: domain?.bgColor || FALLBACK_DOMAIN.bgColor,
    context: domain?.context || FALLBACK_DOMAIN.context,
  };
}

/** Safe lookup - never returns undefined or an incomplete visual definition. */
export function getDomain(id: string | undefined | null): DomainDefinition {
  const domain = id ? DOMAINS[id as DomainId] : undefined;
  return normalizeDomainDefinition(domain, id);
}

export const DOMAINS: Record<DomainId, DomainDefinition> = {
  fintech: {
    id: 'fintech',
    label: 'FinTech',
    color: '#1d4ed8',
    bgColor: '#dbeafe',
    context: `Domain: Financial Technology. Key concerns: PCI-DSS compliance, AML/KYC requirements,
real-time payment processing, fraud detection, regulatory reporting (SOX, GDPR),
high availability (99.99%), audit trails, data encryption at rest and in transit,
open banking APIs (PSD2), core banking integration, risk management frameworks.`,
  },
  healthcare: {
    id: 'healthcare',
    label: 'Healthcare',
    color: '#047857',
    bgColor: '#d1fae5',
    context: `Domain: Healthcare Technology. Key concerns: HIPAA compliance, HL7/FHIR standards,
EHR/EMR integration, PHI data handling, clinical workflows, FDA regulations for medical devices,
patient safety, interoperability between care systems, audit logging, role-based access for
clinicians, telemedicine features, billing (ICD-10, CPT codes).`,
  },
  ecommerce: {
    id: 'ecommerce',
    label: 'E-Commerce',
    color: '#b45309',
    bgColor: '#fef3c7',
    context: `Domain: E-Commerce. Key concerns: high traffic scalability, cart abandonment flows,
payment gateway integration (Stripe, PayPal), inventory management, order fulfillment pipelines,
product catalog search (Elasticsearch), recommendation engines, A/B testing, SEO,
multi-currency/multi-region, GDPR cookie consent, returns & refunds workflows.`,
  },
  saas: {
    id: 'saas',
    label: 'SaaS',
    color: '#6d28d9',
    bgColor: '#ede9fe',
    context: `Domain: Software as a Service. Key concerns: multi-tenancy, subscription billing
(Stripe Billing, usage-based pricing), tenant isolation, feature flags per tier, onboarding flows,
SSO/SAML integration, self-service admin portals, usage analytics, churn prediction,
99.9% SLA, zero-downtime deployments, API rate limiting per tenant.`,
  },
  edtech: {
    id: 'edtech',
    label: 'EdTech',
    color: '#0e7490',
    bgColor: '#cffafe',
    context: `Domain: Education Technology. Key concerns: FERPA compliance (student data privacy),
LMS integration (Canvas, Moodle, Blackboard), SCORM/xAPI content standards, adaptive learning
algorithms, accessibility (WCAG 2.1 AA), gamification, progress tracking, cohort-based
collaboration, video streaming, assignment submission workflows, plagiarism detection APIs.`,
  },
  insurtech: {
    id: 'insurtech',
    label: 'InsurTech',
    color: '#9f1239',
    bgColor: '#ffe4e6',
    context: `Domain: Insurance Technology. Key concerns: actuarial data modeling, policy lifecycle
management (quote-bind-issue), claims processing automation, underwriting rules engines,
regulatory compliance (state insurance laws), reinsurance data exchange, fraud detection,
document OCR for claims, integration with legacy policy admin systems, ACORD standards.`,
  },
  legaltech: {
    id: 'legaltech',
    label: 'LegalTech',
    color: '#374151',
    bgColor: '#f3f4f6',
    context: `Domain: Legal Technology. Key concerns: attorney-client privilege, e-discovery workflows,
contract lifecycle management, e-signature integration (DocuSign), matter management,
conflict-of-interest checking, billing (LEDES format), court filing integrations,
document version control with audit trails, ABA ethical rules compliance, data residency.`,
  },
  retail: {
    id: 'retail',
    label: 'Retail',
    color: '#c2410c',
    bgColor: '#ffedd5',
    context: `Domain: Retail. Key concerns: omnichannel inventory sync (online + in-store),
POS system integration, loyalty program management, demand forecasting, supply chain visibility,
last-mile delivery tracking, shrinkage prevention, seasonal scaling, price optimization,
customer 360 profiles, in-store mobile app features, BOPIS (buy online pick up in store).`,
  },
  manufacturing: {
    id: 'manufacturing',
    label: 'Manufacturing',
    color: '#1e3a5f',
    bgColor: '#e0f0ff',
    context: `Domain: Manufacturing / Industry 4.0. Key concerns: IoT sensor data ingestion,
predictive maintenance, MES/ERP integration (SAP), OEE tracking, quality management (ISO 9001),
production scheduling, supply chain traceability, digital twin modeling,
SCADA integration, safety compliance (OSHA), cold-chain monitoring, batch record management.`,
  },
  govtech: {
    id: 'govtech',
    label: 'GovTech',
    color: '#1e40af',
    bgColor: '#e0e7ff',
    context: `Domain: Government Technology. Key concerns: FedRAMP / StateRAMP authorization,
Section 508 accessibility, FIPS 140-2 cryptography, ATO (Authority to Operate) process,
citizen-facing portal UX, identity proofing (NIST 800-63), open data mandates,
legacy mainframe modernization, procurement compliance (FAR/DFARS), multi-agency data sharing,
disaster recovery (RPO/RTO requirements), FISMA compliance.`,
  },
  logistics: {
    id: 'logistics',
    label: 'Logistics & Supply Chain',
    color: '#4d7c0f',
    bgColor: '#ecfccb',
    context: `Domain: Logistics & Supply Chain. Key concerns: real-time shipment tracking (GPS/IoT
telemetry), warehouse management systems (WMS), route optimization, fleet management,
EDI integration (ASNs, purchase orders), customs/compliance documentation, last-mile delivery
coordination, freight rate management, carrier API integration (FedEx, UPS, freight brokers),
demand forecasting, cold-chain monitoring for perishables, multi-modal shipment visibility.`,
  },
  energy: {
    id: 'energy',
    label: 'Energy & Clean Tech',
    color: '#ca8a04',
    bgColor: '#fef9c3',
    context: `Domain: Energy & Clean Tech. Key concerns: smart grid / SCADA integration, IoT sensor
telemetry for solar and wind assets, energy trading and settlement, demand response programs,
NERC CIP compliance (grid cybersecurity), carbon accounting and ESG reporting, EV charging
network management, battery storage optimization, utility billing systems, real-time load
forecasting, renewable energy certificate (REC) tracking.`,
  },
  construction: {
    id: 'construction',
    label: 'Construction & PropTech',
    color: '#92400e',
    bgColor: '#fde68a',
    context: `Domain: Construction & PropTech. Key concerns: project scheduling and Gantt-based
timelines, BIM (Building Information Modeling) integration, on-site progress reporting and
photo documentation, subcontractor/vendor management, punch list and RFI workflows, safety
compliance (OSHA), procurement and change order tracking, mobile field data capture,
integration with estimating/takeoff software, permit and inspection tracking.`,
  },
  biotech: {
    id: 'biotech',
    label: 'Biotech & Life Sciences',
    color: '#0d9488',
    bgColor: '#ccfbf1',
    context: `Domain: Biotech & Life Sciences. Key concerns: FDA 21 CFR Part 11 compliance
(electronic records/signatures), GxP validation (GLP/GMP/GCP), clinical trial data management
(CDISC standards), laboratory information management systems (LIMS), sample chain-of-custody
tracking, electronic lab notebooks (ELN), bioinformatics pipeline integration, adverse event
reporting, IRB/regulatory submission workflows, data integrity audit trails.`,
  },
  telecom: {
    id: 'telecom',
    label: 'Telecommunications',
    color: '#4338ca',
    bgColor: '#e0e0ff',
    context: `Domain: Telecommunications. Key concerns: OSS/BSS integration (order-to-cash,
provisioning), network inventory and topology management, real-time billing and mediation
(CDR processing), SLA monitoring, number portability, 5G/network slicing configuration,
customer self-service portals, fraud detection, regulatory compliance (FCC/CPNI),
carrier interconnect settlement, outage/incident management.`,
  },
};
