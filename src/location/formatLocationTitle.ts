export type LocationAddress = {
  name?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  subregion?: string | null;
  city?: string | null;
};

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function formatLocationTitle(address: LocationAddress | null | undefined): string | null {
  if (!address) {
    return null;
  }

  const name = nonEmpty(address.name);
  if (name) {
    return name;
  }

  const street = nonEmpty(address.street);
  if (street) {
    const streetNumber = nonEmpty(address.streetNumber);
    return streetNumber ? `${streetNumber} ${street}` : street;
  }

  return (
    nonEmpty(address.district) ??
    nonEmpty(address.subregion) ??
    nonEmpty(address.city)
  );
}

export function deduplicateTitle(
  baseTitle: string,
  existingTitles: readonly string[]
): string {
  const normalized = new Set(existingTitles.map((title) => title.toLowerCase()));
  if (!normalized.has(baseTitle.toLowerCase())) {
    return baseTitle;
  }

  let suffix = 2;
  while (normalized.has(`${baseTitle} ${suffix}`.toLowerCase())) {
    suffix += 1;
  }
  return `${baseTitle} ${suffix}`;
}
