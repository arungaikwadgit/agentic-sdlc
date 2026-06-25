/**
 * © 2025 Arun Gaikwad. All rights reserved.
 * Proprietary and Confidential — Unauthorized use prohibited.
 */
/**
 * Built-in domain knowledge templates.
 * These are editable briefs shown in the project-creation wizard.
 * They supplement (and are prepended to) the concise domain context strings in domains.ts.
 */
import type { DomainId } from '@/types/domain.types';

export const DOMAIN_KNOWLEDGE_TEMPLATES: Record<DomainId, string> = {
  fintech: `# Domain Knowledge: Financial Technology

## Project-Specific Context
> _Edit this section to describe your project's specific financial use case, target market, and regulatory environment._

## Key Regulatory Requirements
- **PCI-DSS**: All card data must be tokenized; no PAN stored in plaintext.
- **AML / KYC**: Customer identity verification required at onboarding. Ongoing transaction monitoring.
- **GDPR / CCPA**: Explicit consent for data processing; right-to-erasure workflows required.
- **SOX**: Audit trails for all financial transactions; immutable logs.
- **Open Banking (PSD2)**: Strong Customer Authentication (SCA) for EU customers.

## Architecture Considerations
- Event-sourced ledger for immutable financial records.
- Separate write (commands) and read (queries) models (CQRS).
- Idempotent payment APIs to prevent double charges.
- Fraud scoring service as a sidecar to transaction processing.

## Integration Landscape
- Core banking / payment rails: Stripe, Plaid, Dwolla, or direct ACH/SEPA.
- Identity verification: Jumio, Onfido, or Socure.
- Sanctions screening: Dow Jones Watchlist, OFAC.

## Non-Functional Requirements
- 99.99% uptime SLA for payment critical paths.
- P99 transaction latency < 200ms.
- RPO: 0 (synchronous replication); RTO: < 15 minutes.
`,

  healthcare: `# Domain Knowledge: Healthcare Technology

## Project-Specific Context
> _Edit this section to describe your EHR, patient portal, or clinical workflow system._

## Key Regulatory Requirements
- **HIPAA**: PHI must be encrypted at rest and in transit. BAA required with all vendors.
- **HITECH**: Breach notification within 60 days; civil penalties for willful neglect.
- **HL7 FHIR R4**: Standard API format for clinical data exchange.
- **FDA 21 CFR Part 11**: Electronic records and signatures for regulated systems.

## Architecture Considerations
- Audit logging for every PHI access (who, what, when, from where).
- Role-based access: patient, clinician, admin, billing — strict data isolation.
- SMART on FHIR for third-party app authorization.
- De-identification pipelines for analytics (Safe Harbor or Expert Determination).

## Integration Landscape
- EHR systems: Epic, Cerner, Allscripts (via HL7 v2 or FHIR).
- Scheduling: Kyruus, Zocdoc.
- Telehealth: Twilio Video, Zoom for Healthcare.
- Lab results: HL7 ORU^R01 messages.

## Non-Functional Requirements
- 99.9% availability; planned maintenance windows outside business hours.
- PHI data residency: US-only regions.
- Session timeout after 15 minutes of inactivity.
`,

  ecommerce: `# Domain Knowledge: E-Commerce

## Project-Specific Context
> _Edit this section with your product catalog scope, target GMV, and geography._

## Key Considerations
- **Search & Discovery**: Elasticsearch / Algolia with faceted filters and typo tolerance.
- **Cart & Checkout**: Optimistic UI, inventory reservation with TTL, idempotent order creation.
- **Payments**: Stripe or Adyen; support for saved cards, wallets (Apple Pay, Google Pay).
- **Fraud Prevention**: Velocity checks, device fingerprinting, 3DS2 for high-risk transactions.

## Architecture Considerations
- Product catalog: separate read-optimized store (Elasticsearch) from write store (PostgreSQL).
- Order state machine: PENDING → CONFIRMED → FULFILLING → SHIPPED → DELIVERED → (RETURNED).
- Event-driven inventory updates via Kafka to avoid overselling.
- CDN for product images and static assets.

## Integration Landscape
- Payments: Stripe, Adyen, PayPal.
- Shipping: ShipStation, EasyPost, FedEx/UPS APIs.
- Tax: TaxJar, Avalara.
- Reviews: Yotpo, Bazaarvoice.

## Non-Functional Requirements
- Handle 10× traffic spikes during sales events (auto-scaling).
- P95 page load < 2s; Core Web Vitals passing.
- GDPR cookie consent banner; CCPA opt-out for CA users.
`,

  saas: `# Domain Knowledge: Software as a Service

## Project-Specific Context
> _Edit this section with your target customer segment, pricing tiers, and key differentiators._

## Key Considerations
- **Multi-tenancy**: Tenant data isolation — shared schema with row-level security, or separate schemas.
- **Billing**: Stripe Billing / Recurly for subscription lifecycle, usage-based metering, proration.
- **Onboarding**: Self-serve signup, email verification, guided setup wizard, empty-state UX.
- **Feature Flags**: LaunchDarkly or in-house flags tied to subscription tier.

## Architecture Considerations
- Tenant context propagated via JWT claim or subdomain routing.
- Background jobs queue (Bull / Sidekiq) for async operations (report generation, exports).
- Webhook delivery system with retry and signature verification.
- Admin portal (super-admin) for tenant management and impersonation.

## Integration Landscape
- Auth: Auth0, Okta (SSO/SAML for enterprise tier).
- Analytics: Mixpanel, Amplitude, or Segment.
- Support: Intercom, Zendesk.
- Email: SendGrid, Postmark.

## Non-Functional Requirements
- 99.9% SLA; < 1h scheduled maintenance.
- Data export on account cancellation (GDPR portability).
- SOC 2 Type II readiness from day one.
`,

  edtech: `# Domain Knowledge: Education Technology

## Project-Specific Context
> _Edit this section to describe your target audience (K-12, higher ed, corporate L&D) and content types._

## Key Regulatory Requirements
- **FERPA**: Student educational records are protected; schools must consent to disclosure.
- **COPPA**: Parental consent required for users under 13.
- **WCAG 2.1 AA**: Accessibility is mandatory for public institutions.

## Architecture Considerations
- SCORM 1.2 / SCORM 2004 / xAPI (Tin Can) content packaging for LMS interoperability.
- LTI 1.3 + Advantage for LMS tool integrations (Canvas, Moodle, Blackboard).
- Adaptive learning engine: learner model + knowledge graph + recommendation algorithm.
- Video delivery: HLS streaming with adaptive bitrate; caption/transcript generation.

## Integration Landscape
- LMS: Canvas LMS API, Moodle Web Services, Blackboard REST APIs.
- Video: Kaltura, Vimeo OTT, Wistia.
- Plagiarism: Turnitin iThenticate API.
- Payments: Stripe for B2C course purchases.

## Non-Functional Requirements
- Offline mode for mobile learners (progressive web app with service workers).
- P99 video start time < 3s.
- Audit log of all assessment submissions (tamper-evident).
`,

  insurtech: `# Domain Knowledge: Insurance Technology

## Project-Specific Context
> _Edit this section to describe your insurance line (P&C, life, health, specialty) and distribution model._

## Key Considerations
- **Policy Lifecycle**: Quote → Bind → Issue → Endorse → Renew / Lapse / Cancel.
- **Claims**: FNOL → Assignment → Investigation → Reserve Setting → Payment → Closure.
- **Underwriting Rules Engine**: Drools or custom DSL for risk scoring and eligibility.
- **Regulatory**: State-by-state filing requirements (SERFF); rate and form approvals.

## Architecture Considerations
- Policy Admin System (PAS) as the system of record; all other services consume events.
- Document generation: PDF policies, EOBs, claims letters (templating engine).
- Fraud detection: graph analytics on claimant networks, device fingerprinting.
- ACORD XML / JSON standards for data exchange with reinsurers and partners.

## Integration Landscape
- Payment: ISO 20022 or ACH for claims disbursement.
- Credit / MVR / CLUE: LexisNexis, TransUnion for underwriting data.
- E-signature: DocuSign or Adobe Sign for policy delivery.
- Reinsurance: ACORD standard messaging.

## Non-Functional Requirements
- Audit trail for every underwriting decision and claims action.
- Data retention: 7–10 years for policy and claims records.
- 99.5% availability; batch processing windows for overnight rating jobs.
`,

  legaltech: `# Domain Knowledge: Legal Technology

## Project-Specific Context
> _Edit this section to describe your legal practice area focus and target firm size._

## Key Considerations
- **Attorney-Client Privilege**: Strict access controls; data must not be discoverable by opposing counsel.
- **Matter Management**: Intake → Open → Active → Closed; conflict-of-interest check at intake.
- **Billing**: LEDES 1998B / LEDES 2000 format for e-billing; UTBMS task codes.
- **E-Discovery**: Legal hold, collection, processing, review, production workflow.

## Architecture Considerations
- Document versioning with full audit trail (who edited what, when).
- Contract clause extraction using NLP / LLM with human-in-the-loop review.
- Role-based access: originating attorney, billing attorney, paralegal, client portal.
- Integration with court e-filing systems (PACER, state CM/ECF).

## Integration Landscape
- E-signature: DocuSign CLM, Adobe Sign.
- Court filing: File & ServeXpress, Tyler Technologies Odyssey.
- Accounting: QuickBooks, Aderant, Elite.
- E-discovery: Relativity, Nuix.

## Non-Functional Requirements
- Data residency: jurisdiction-specific (EU data stays in EU).
- Immutable audit logs; tamper-evident storage.
- Encryption at rest using customer-managed keys (CMEK) for enterprise clients.
`,

  retail: `# Domain Knowledge: Retail

## Project-Specific Context
> _Edit this section to describe your retail format (specialty, grocery, fashion), channel mix, and geography._

## Key Considerations
- **Omnichannel**: Unified inventory view across stores, DCs, and e-commerce.
- **POS Integration**: Real-time inventory deduction; support for offline mode during connectivity loss.
- **Promotions Engine**: Stacking rules, loyalty points, coupon validation, price override approvals.
- **Last-Mile**: Carrier integrations, BOPIS (Buy Online Pick Up In Store), ship-from-store.

## Architecture Considerations
- Inventory: event-sourced with eventual consistency across channels; reservations with TTL.
- Product catalog: master data management (MDM) system as golden record.
- Order Management System (OMS) decoupled from POS and e-commerce storefronts.
- Customer Data Platform (CDP) for 360-degree customer profiles.

## Integration Landscape
- ERP: SAP S/4HANA, Oracle Retail, Microsoft Dynamics.
- Loyalty: Loyalty Lion, Yotpo Loyalty, or custom.
- Shipping: ShipBob, ShipStation, FedEx Ship Manager.
- Payments: Adyen for unified commerce (in-store + online).

## Non-Functional Requirements
- PCI-DSS compliance for all card-present and card-not-present flows.
- 10× traffic capacity for peak events (Black Friday, holiday season).
- POS offline mode: queue transactions locally, sync on reconnect.
`,

  manufacturing: `# Domain Knowledge: Manufacturing / Industry 4.0

## Project-Specific Context
> _Edit this section to describe your manufacturing process type (discrete, process, mixed-mode) and industry vertical._

## Key Considerations
- **MES / ERP Integration**: SAP PP/QM modules, Rockwell FactoryTalk, Siemens OPCENTER.
- **IoT Ingestion**: MQTT or OPC-UA from PLCs and SCADA systems; time-series storage (InfluxDB, TimescaleDB).
- **Quality Management**: ISO 9001 / IATF 16949; non-conformance reporting (NCR) workflows.
- **Predictive Maintenance**: Sensor data → anomaly detection → work-order creation.

## Architecture Considerations
- Edge computing for low-latency control loop decisions; cloud for analytics and reporting.
- Digital twin: synchronize physical asset state to a virtual model.
- Batch/lot traceability: ingredient genealogy upstream, distribution traceability downstream.
- OEE (Overall Equipment Effectiveness) = Availability × Performance × Quality.

## Integration Landscape
- ERP: SAP S/4HANA, Oracle Manufacturing Cloud.
- SCADA / PLC: Siemens S7, Allen-Bradley; OPC-UA gateway.
- Shipping / WMS: Manhattan Associates, Blue Yonder.
- Regulatory: FDA 21 CFR Part 11 for pharmaceutical; AS9100 for aerospace.

## Non-Functional Requirements
- Edge nodes: 99.99% uptime; must operate in air-gapped mode.
- Data historian: retain 5 years of sensor data at 1-second granularity.
- Cybersecurity: IEC 62443 for OT/IT network segmentation.
`,

  govtech: `# Domain Knowledge: Government Technology

## Project-Specific Context
> _Edit this section to describe your government level (federal, state, municipal), agency type, and citizen service._

## Key Regulatory Requirements
- **FedRAMP**: Cloud services require ATO; Low / Moderate / High impact levels.
- **Section 508**: All citizen-facing interfaces must meet WCAG 2.1 AA.
- **FISMA**: Annual security assessments; continuous monitoring (CDM program).
- **NIST 800-63**: Digital identity proofing and authentication levels (IAL, AAL).

## Architecture Considerations
- Zero Trust architecture: never trust, always verify; micro-segmentation.
- FIPS 140-2 validated cryptographic modules only.
- Separation of duties: no single user can approve their own transactions.
- Government cloud regions: AWS GovCloud, Azure Government, or on-premise data centers.

## Integration Landscape
- Identity: Login.gov, MAX.gov, or state equivalent for citizen authentication.
- Payment: Pay.gov for federal; state treasury systems for state agencies.
- Notification: Notify.gov or custom GSA-approved email/SMS gateway.
- Data: data.gov open data publishing; FOIA request management.

## Non-Functional Requirements
- RPO: 1 hour; RTO: 4 hours for Moderate impact systems.
- Audit log retention: 3–7 years depending on record schedule.
- Penetration testing annually; quarterly vulnerability scanning.
`,
};
