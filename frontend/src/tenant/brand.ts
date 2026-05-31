type Brand = { name: string; accent: string }

const brands: Record<string, Brand> = {
  'sample-carrier': { name: 'Sample Carrier', accent: '#60a5fa' }
}

export function getBrand(tenantId: string): Brand {
  return brands[tenantId] || { name: tenantId, accent: '#60a5fa' }
}

