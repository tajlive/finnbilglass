/** Explicit supplier statements, scoped to SKU and Eurocode together.
 * Never apply these facts to every item sharing the Eurocode.
 */
export const supplierSkuEvidence = [
  {
    sku: '3151GNCM', eurocode: '5179AGACIMW5V', ldw: false,
    source: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-febr-13-sensorakuldwautostoppgn/',
    checkedAt: '2026-10-28',
    reason: 'Supplier directs vehicles without LDW to 3151GNCM.',
  },
  {
    sku: '3151GNCM2', eurocode: '5179AGACIMW5V', ldw: true,
    source: 'https://auto-glass.no/produkt/mazda-cx5-5d-suv-febr-13-sensorakuldwautostoppgn/',
    checkedAt: '2026-10-28',
    reason: 'Product title and warning identify the LDW variant.',
  },
] as const;

export function supplierLdw(sku: string, eurocode: string | null): boolean | undefined {
  return supplierSkuEvidence.find(row => row.sku === sku && row.eurocode === eurocode)?.ldw;
}
